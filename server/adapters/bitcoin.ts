import { z } from 'zod';
import {
  MAX_BLOCKS,
  MAX_TRANSACTIONS,
  snapshotSchema,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import type { ServerConfig } from '../config.js';
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

/** Volatile, bounded evidence owned by one service instance; never shared across providers. */
export function createBitcoinProvider(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): () => Promise<Snapshot> {
  const observations: BitcoinObservations = { pending: new Map() };
  return () => collectBitcoinSnapshot(config, fetcher, now, observations);
}

export async function fetchBitcoinSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): Promise<Snapshot> {
  return collectBitcoinSnapshot(config, fetcher, now, { pending: new Map() });
}

async function collectBitcoinSnapshot(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  now: () => number,
  observations: BitcoinObservations,
): Promise<Snapshot> {
  const paths = ['/v1/blocks', '/mempool/recent', '/mempool', '/v1/fees/recommended'];
  const [blocksRaw, recentRaw, mempoolRaw, feesRaw] = await Promise.all(
    paths.map((path) =>
      requestJson(`${config.bitcoinApiUrl}${path}`, fetcher === undefined ? {} : { fetcher }),
    ),
  );
  const blocks = parsePayload(bitcoinBlocksSchema, blocksRaw);
  const recent = parsePayload(bitcoinRecentSchema, recentRaw);
  const mempool = parsePayload(bitcoinMempoolSchema, mempoolRaw);
  const fees = parsePayload(bitcoinFeesSchema, feesRaw);
  const observedAt = now();
  const transactions: Tx[] = recent.slice(0, MAX_TRANSACTIONS).map((tx) => ({
    id: tx.txid.toLowerCase(),
    chain: 'bitcoin',
    feeRate: ratioToNumber(BigInt(tx.fee), BigInt(tx.vsize)),
    size: tx.vsize,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant non fourni',
  }));
  for (const [id, tracked] of observations.pending) {
    if (observedAt - tracked.lastSeenAt >= BITCOIN_TRACKED_SAMPLE_TTL_MS) {
      observations.pending.delete(id);
    }
  }
  // The recent endpoint is an arrival sample, not a complete current mempool.
  // Older samples are retained only as candidates for an explicit inclusion check.
  for (const transaction of transactions) {
    observations.pending.delete(transaction.id);
    observations.pending.set(transaction.id, { transaction, lastSeenAt: observedAt });
  }
  while (observations.pending.size > BITCOIN_TRACKED_SAMPLE_LIMIT) {
    observations.pending.delete(observations.pending.keys().next().value!);
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
      confirmed.set(id, { ...tracked.transaction, status: 'confirmed' });
      observations.pending.delete(id);
    }
    checked.confirmed = [...confirmed.values()].slice(0, MAX_TRANSACTIONS);
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
    coverage:
      'Vue du mempool du fournisseur Bitcoin : échantillon de transactions récentes. Les confirmations affichées correspondent uniquement à des transactions échantillonnées dont l’identifiant est présent dans le dernier bloc observé. Chaque nœud peut observer un mempool différent. Taille des blocs en octets virtuels.',
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
    message: `Indicateur de frais : estimation du fournisseur pour environ 30 minutes, sans garantie de confirmation.${confirmationUnavailable ? ' La vérification des confirmations du dernier bloc est temporairement indisponible ; aucune confirmation n’est déduite de la disparition d’une transaction.' : ''}`,
  });
}
