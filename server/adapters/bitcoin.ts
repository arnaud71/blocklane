import { z } from 'zod';
import {
  MAX_BLOCKS,
  MAX_TRANSACTIONS,
  snapshotSchema,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import type { ServerConfig } from '../config.js';
import { fetchBitcoinTopFeeSample, TOP_FEE_SAMPLE_LIMIT } from './bitcoinTopFees.js';
import {
  parsePayload,
  ratioToNumber,
  requestJson,
  UpstreamError,
  type Fetcher,
} from '../network.js';

const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().safe();
export const bitcoinRecentSchema = z
  .array(
    z.object({
      txid: hashSchema,
      fee: safeInteger.max(2_100_000_000_000_000),
      vsize: z.number().int().positive().max(1_000_000),
    }),
  )
  .max(1_000);
export const bitcoinBlocksSchema = z
  .array(
    z.object({
      id: hashSchema,
      height: safeInteger,
      timestamp: safeInteger.max(32_503_680_000),
      tx_count: safeInteger.max(5_000_000),
      weight: z.number().int().nonnegative().max(4_000_000),
    }),
  )
  .min(1)
  .max(100);
export const bitcoinMempoolSchema = z.object({
  count: safeInteger,
  vsize: safeInteger,
  total_fee: safeInteger,
});
export const bitcoinFeesSchema = z.object({
  fastestFee: z.number().finite().nonnegative().max(100_000_000),
  halfHourFee: z.number().finite().nonnegative().max(100_000_000),
  hourFee: z.number().finite().nonnegative().max(100_000_000),
});

const bitcoinBlockTxidsSchema = z.array(hashSchema).max(30_000);
export const BITCOIN_TRACKED_SAMPLE_LIMIT = MAX_TRANSACTIONS;
export const BITCOIN_TRACKED_SAMPLE_TTL_MS = 30 * 60 * 1_000;

interface TrackedTransaction {
  transaction: Tx;
  lastSeenAt: number;
}

interface BitcoinObservations {
  pending: Map<string, TrackedTransaction>;
  checkedBlock?: { hash: string; transactionIds: Set<string>; confirmed: Tx[] };
}

export type BitcoinProjectionReader = (config: ServerConfig) => Promise<Tx[]>;

/** Volatile, bounded evidence owned by one service instance; never shared across providers. */
export function createBitcoinProvider(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
  readProjection?: BitcoinProjectionReader,
): () => Promise<Snapshot> {
  const observations: BitcoinObservations = { pending: new Map() };
  // An injected HTTP transport must not unexpectedly open a real WebSocket.
  // Provider fixtures can inject a projection reader separately.
  const projectionReader =
    readProjection ?? (fetcher === undefined ? fetchBitcoinTopFeeSample : undefined);
  return () => collectBitcoinSnapshot(config, fetcher, now, observations, projectionReader);
}

export async function fetchBitcoinSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
  readProjection?: BitcoinProjectionReader,
): Promise<Snapshot> {
  return collectBitcoinSnapshot(
    config,
    fetcher,
    now,
    { pending: new Map() },
    readProjection ?? (fetcher === undefined ? fetchBitcoinTopFeeSample : undefined),
  );
}

async function collectBitcoinSnapshot(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  now: () => number,
  observations: BitcoinObservations,
  projectionReader: BitcoinProjectionReader | undefined,
): Promise<Snapshot> {
  const paths = ['/v1/blocks', '/mempool', '/v1/fees/recommended'];
  const options = fetcher === undefined ? {} : { fetcher };
  const [[blocksRaw, mempoolRaw, feesRaw], recentResult, projectionResult] = await Promise.all([
    Promise.all(paths.map((path) => requestJson(`${config.bitcoinApiUrl}${path}`, options))),
    requestJson(`${config.bitcoinApiUrl}/mempool/recent`, options).then(
      (value) => ({ value, failed: false }),
      () => ({ value: null, failed: true }),
    ),
    (projectionReader?.(config) ?? Promise.reject(new UpstreamError('network'))).then(
      (value) => ({ value, failed: false }),
      () => ({ value: null, failed: true }),
    ),
  ]);
  const blocks = parsePayload(bitcoinBlocksSchema, blocksRaw);
  const mempool = parsePayload(bitcoinMempoolSchema, mempoolRaw);
  const fees = parsePayload(bitcoinFeesSchema, feesRaw);
  const observedAt = now();
  const recentParsed = bitcoinRecentSchema.safeParse(recentResult.value);
  const hasTopFeeSample = !projectionResult.failed && projectionResult.value !== null;
  const hasRecentSample = !recentResult.failed && recentParsed.success;
  const transactions: Tx[] = hasTopFeeSample
    ? projectionResult.value!.slice(0, TOP_FEE_SAMPLE_LIMIT)
    : hasRecentSample
      ? recentParsed
          .data!.sort((left, right) => {
            const leftValue = BigInt(left.fee) * BigInt(right.vsize);
            const rightValue = BigInt(right.fee) * BigInt(left.vsize);
            return (
              (leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0) ||
              left.txid.localeCompare(right.txid)
            );
          })
          .slice(0, TOP_FEE_SAMPLE_LIMIT)
          .map((tx) => ({
            id: tx.txid.toLowerCase(),
            chain: 'bitcoin' as const,
            feeRate: ratioToNumber(BigInt(tx.fee), BigInt(tx.vsize)),
            size: tx.vsize,
            status: 'pending' as const,
            kind: 'transfer' as const,
            value: 'Montant non fourni',
          }))
      : [];
  for (const [id, tracked] of observations.pending) {
    if (observedAt - tracked.lastSeenAt >= BITCOIN_TRACKED_SAMPLE_TTL_MS) {
      observations.pending.delete(id);
    }
  }
  const previouslyTrackedIds = new Set(observations.pending.keys());
  // Neither the first projected block nor the recent arrivals cover the whole mempool.
  // Older samples remain only as candidates for an explicit inclusion check.
  for (const transaction of transactions) {
    observations.pending.delete(transaction.id);
    observations.pending.set(transaction.id, { transaction, lastSeenAt: observedAt });
  }
  const latest = blocks[0]!;
  const latestHash = latest.id.toLowerCase();
  if (observations.checkedBlock?.hash !== latestHash) delete observations.checkedBlock;
  let confirmationUnavailable = false;
  if (!observations.checkedBlock && observations.pending.size > 0) {
    try {
      const ids = parsePayload(
        bitcoinBlockTxidsSchema,
        await requestJson(
          `${config.bitcoinApiUrl}/block/${latestHash}/txids`,
          fetcher === undefined ? {} : { fetcher },
        ),
      ).map((id) => id.toLowerCase());
      const transactionIds = new Set(ids);
      if (ids.length !== latest.tx_count || transactionIds.size !== ids.length) {
        throw new UpstreamError('invalid');
      }
      observations.checkedBlock = { hash: latestHash, transactionIds, confirmed: [] };
    } catch {
      // Confirmations are optional evidence: keep the valid core observation,
      // but never reuse confirmations from a previous block or infer new ones.
      confirmationUnavailable = true;
    }
  }
  const checked = observations.checkedBlock;
  if (checked) {
    const confirmed = new Map(
      checked.confirmed.map((transaction) => [transaction.id, transaction]),
    );
    for (const [id, tracked] of observations.pending) {
      if (!checked.transactionIds.has(id)) continue;
      confirmed.set(id, {
        ...tracked.transaction,
        status: 'confirmed',
        blockHash: checked.hash,
      });
      observations.pending.delete(id);
    }
    checked.confirmed = [...confirmed.values()].slice(0, MAX_TRANSACTIONS);
  }
  // Verify the previous sample before the new fee ranking can evict its IDs.
  // The refresh temporarily holds at most 120 retained + 96 new transactions.
  if (confirmationUnavailable) {
    // A failed optional inclusion check must not evict the IDs needed for its retry.
    // Keep their refreshed metadata when they are still sampled; fill remaining
    // watch slots with new IDs without limiting the current public fee sample.
    const retained = new Map<string, TrackedTransaction>();
    for (const id of previouslyTrackedIds) {
      const tracked = observations.pending.get(id);
      if (tracked) retained.set(id, tracked);
    }
    for (const [id, tracked] of observations.pending) {
      if (retained.size >= BITCOIN_TRACKED_SAMPLE_LIMIT) break;
      if (!retained.has(id)) retained.set(id, tracked);
    }
    observations.pending = retained;
  } else {
    while (observations.pending.size > BITCOIN_TRACKED_SAMPLE_LIMIT) {
      observations.pending.delete(observations.pending.keys().next().value!);
    }
  }
  const pending = transactions.filter(
    (transaction) => !checked?.transactionIds.has(transaction.id),
  );
  const confirmed = checked?.confirmed ?? [];
  // Reserve room for proven inclusions even when an upstream recent sample is large.
  const confirmedSample = [...confirmed]
    .sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id))
    .slice(0, MAX_TRANSACTIONS - Math.min(pending.length, 100));
  const pendingSample = pending.slice(0, MAX_TRANSACTIONS - confirmedSample.length);
  return parsePayload(snapshotSchema, {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: config.bitcoinSource,
    observedAt,
    coverage: `${hasTopFeeSample ? 'Échantillon regroupant jusqu’à 96 transactions aux meilleurs frais propres (fee/vsize) parmi le premier bloc projeté du fournisseur Bitcoin, sans inventaire exhaustif ni garantie de sélection par un mineur.' : hasRecentSample ? 'Sélection des meilleurs frais parmi les seules transactions récentes du fournisseur Bitcoin : le classement du premier bloc projeté est indisponible, ce repli ne représente pas un top global.' : 'L’échantillon de transactions en attente est temporairement indisponible ; les blocs et indicateurs du fournisseur restent disponibles.'} Les confirmations affichées sont des inclusions vérifiées dans le dernier bloc observé. Chaque nœud peut observer un mempool différent. Tailles en octets virtuels.`,
    pendingCount: mempool.count,
    feeRate: fees.halfHourFee,
    feeUnit: 'sat/vB',
    transactions: [...pendingSample, ...confirmedSample],
    blocks: blocks.slice(0, MAX_BLOCKS).map((block) => ({
      height: block.height,
      hash: block.id.toLowerCase(),
      timestamp: block.timestamp,
      txCount: block.tx_count,
      used: block.weight / 4,
      capacity: 1_000_000,
    })),
    message: `Indicateur de frais : estimation du fournisseur pour environ 30 minutes, sans garantie de confirmation.${hasTopFeeSample ? '' : ' Classement des frais du premier bloc projeté indisponible ; aucun top global n’est annoncé.'}${confirmationUnavailable ? ' La vérification des confirmations du dernier bloc est temporairement indisponible ; aucune confirmation n’est déduite de la disparition d’une transaction.' : ''}`,
  });
}
