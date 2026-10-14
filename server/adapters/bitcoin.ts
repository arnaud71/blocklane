import { z } from 'zod';
import {
  MAX_BLOCKS,
  MAX_CATCHUP_BLOCKS,
  MAX_INCLUSION_BLOCKS,
  MAX_TRACKED_TRANSACTIONS,
  MAX_TRANSACTIONS,
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type Block,
  type BlockInclusions,
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
      previousblockhash: hashSchema.optional(),
    }),
  )
  .min(1)
  .max(100)
  .superRefine((blocks, context) => {
    const heights = new Set<number>();
    const hashes = new Set<string>();
    for (const [index, block] of blocks.entries()) {
      const hash = block.id.toLowerCase();
      if (heights.has(block.height) || hashes.has(hash)) {
        context.addIssue({ code: 'custom', message: 'Duplicate Bitcoin block' });
      }
      if (index > 0 && block.height >= blocks[index - 1]!.height) {
        context.addIssue({ code: 'custom', message: 'Bitcoin blocks must be newest first' });
      }
      heights.add(block.height);
      hashes.add(hash);
    }
  });
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
export const BITCOIN_TRACKED_SAMPLE_LIMIT = MAX_TRACKED_TRANSACTIONS;
export const BITCOIN_TRACKED_SAMPLE_TTL_MS = TRACKED_TRANSACTION_TTL_MS;

interface TrackedTransaction {
  transaction: Tx;
  lastSeenAt: number;
  inclusion?: { height: number; hash: string };
}

interface BitcoinObservations {
  pending: Map<string, TrackedTransaction>;
  verified: Map<number, BlockInclusions>;
  /** First failed height remains pending, including when the tip advances. */
  nextHeight?: number;
  lastTip?: { height: number; hash: string };
  /** Only the current tip retains its complete list for new observations at that tip. */
  checkedBlock?: { hash: string; transactionIds: Set<string> };
}

type BitcoinBlock = z.infer<typeof bitcoinBlocksSchema>[number];

function publicBlock(block: BitcoinBlock): Block {
  return {
    height: block.height,
    hash: block.id.toLowerCase(),
    timestamp: block.timestamp,
    txCount: block.tx_count,
    used: block.weight / 4,
    capacity: 1_000_000,
  };
}

function invalidateBitcoinBranch(observations: BitcoinObservations, height: number): void {
  for (const knownHeight of observations.verified.keys()) {
    if (knownHeight >= height) observations.verified.delete(knownHeight);
  }
  for (const tracked of observations.pending.values()) {
    if (tracked.inclusion && tracked.inclusion.height >= height) delete tracked.inclusion;
  }
  observations.nextHeight = Math.min(observations.nextHeight ?? height, height);
  delete observations.checkedBlock;
}

function rememberBitcoinInclusions(
  observations: BitcoinObservations,
  block: BitcoinBlock,
  transactionIds: Set<string>,
): void {
  const hash = block.id.toLowerCase();
  const entry = observations.verified.get(block.height);
  const matches = new Set(entry?.block.hash === hash ? entry.transactionIds : []);
  for (const [id, tracked] of observations.pending) {
    if (!transactionIds.has(id)) continue;
    tracked.inclusion = { height: block.height, hash };
    matches.add(id);
  }
  observations.verified.set(block.height, {
    block: publicBlock(block),
    transactionIds: [...matches],
  });
}

function pruneBitcoinInclusions(observations: BitcoinObservations): void {
  const entries = [...observations.verified.entries()].sort(([left], [right]) => right - left);
  let remainingIds = MAX_TRACKED_TRANSACTIONS;
  const retained = new Map<number, BlockInclusions>();
  for (const [height, entry] of entries.slice(0, MAX_INCLUSION_BLOCKS)) {
    const transactionIds = entry.transactionIds.slice(0, remainingIds);
    remainingIds -= transactionIds.length;
    retained.set(height, { block: entry.block, transactionIds });
  }
  observations.verified = retained;
}

async function collectBitcoinInclusions(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  observations: BitcoinObservations,
  blocks: BitcoinBlock[],
): Promise<{ unavailable: boolean; truncated: boolean; reorganized: boolean }> {
  const options = fetcher === undefined ? {} : { fetcher };
  const latest = blocks[0]!;
  const latestHash = latest.id.toLowerCase();
  let unavailable = false;
  let truncated = false;
  let reorganized = false;
  let changedHeight = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const verified = observations.verified.get(block.height);
    if (verified && verified.block.hash !== block.id.toLowerCase()) {
      changedHeight = Math.min(changedHeight, block.height);
    }
    const previous = observations.verified.get(block.height - 1);
    if (
      previous &&
      block.previousblockhash !== undefined &&
      previous.block.hash !== block.previousblockhash.toLowerCase()
    ) {
      changedHeight = Math.min(changedHeight, block.height - 1);
    }
  }
  if (observations.lastTip) {
    if (latest.height < observations.lastTip.height) {
      changedHeight = Math.min(changedHeight, latest.height + 1);
    } else if (
      latest.height === observations.lastTip.height &&
      latestHash !== observations.lastTip.hash
    ) {
      changedHeight = Math.min(changedHeight, latest.height);
    }
  }
  if (Number.isFinite(changedHeight)) {
    invalidateBitcoinBranch(observations, changedHeight);
    // A lower tip can precede every previously checked block. Its own txids
    // still need verification even when the invalidated branch starts above it.
    observations.nextHeight = Math.min(observations.nextHeight!, latest.height);
    reorganized = true;
  }
  observations.lastTip = { height: latest.height, hash: latestHash };
  if (observations.checkedBlock?.hash !== latestHash) delete observations.checkedBlock;
  observations.nextHeight ??= latest.height;
  if (latest.height - observations.nextHeight + 1 > MAX_CATCHUP_BLOCKS) {
    // A prolonged outage cannot trigger an unbounded historical scan.
    observations.nextHeight = latest.height - MAX_CATCHUP_BLOCKS + 1;
    truncated = true;
  }

  let firstHeight = observations.nextHeight;
  if (firstHeight > latest.height) {
    if (observations.checkedBlock) {
      rememberBitcoinInclusions(observations, latest, observations.checkedBlock.transactionIds);
    }
    pruneBitcoinInclusions(observations);
    return { unavailable, truncated, reorganized };
  }
  const byHeight = new Map(blocks.map((block) => [block.height, block]));
  if (
    Array.from({ length: latest.height - firstHeight + 1 }, (_, index) => firstHeight + index).some(
      (height) => !byHeight.has(height),
    )
  ) {
    try {
      // The official height page covers the bounded catch-up window in one request.
      const additional = parsePayload(
        bitcoinBlocksSchema,
        await requestJson(`${config.bitcoinApiUrl}/v1/blocks/${latest.height}`, options),
      );
      for (const block of additional) {
        const known = byHeight.get(block.height);
        if (known && known.id.toLowerCase() !== block.id.toLowerCase()) {
          throw new UpstreamError('invalid');
        }
      }
      let additionalChangedHeight = Number.POSITIVE_INFINITY;
      for (const block of additional) {
        const verified = observations.verified.get(block.height);
        if (verified && verified.block.hash !== block.id.toLowerCase()) {
          additionalChangedHeight = Math.min(additionalChangedHeight, block.height);
        }
        byHeight.set(block.height, block);
      }
      if (Number.isFinite(additionalChangedHeight)) {
        invalidateBitcoinBranch(observations, additionalChangedHeight);
        reorganized = true;
        firstHeight = Math.max(observations.nextHeight!, latest.height - MAX_CATCHUP_BLOCKS + 1, 0);
        if (firstHeight > observations.nextHeight!) truncated = true;
        observations.nextHeight = firstHeight;
      }
    } catch {
      unavailable = true;
    }
  }
  const heights = Array.from(
    { length: latest.height - firstHeight + 1 },
    (_, index) => firstHeight + index,
  );
  const outcomes = await Promise.all(
    heights.map(async (height) => {
      const block = byHeight.get(height);
      if (!block) return { height, verified: false };
      const known = observations.verified.get(height);
      if (
        known?.block.hash === block.id.toLowerCase() &&
        (height !== latest.height || observations.checkedBlock?.hash === latestHash)
      ) {
        return { height, verified: true };
      }
      try {
        const previousHash =
          byHeight.get(height - 1)?.id.toLowerCase() ??
          observations.verified.get(height - 1)?.block.hash;
        if (
          previousHash !== undefined &&
          block.previousblockhash !== undefined &&
          block.previousblockhash.toLowerCase() !== previousHash
        ) {
          throw new UpstreamError('invalid');
        }
        const ids = parsePayload(
          bitcoinBlockTxidsSchema,
          await requestJson(
            `${config.bitcoinApiUrl}/block/${block.id.toLowerCase()}/txids`,
            options,
          ),
        ).map((id) => id.toLowerCase());
        const transactionIds = new Set(ids);
        if (ids.length !== block.tx_count || transactionIds.size !== ids.length) {
          throw new UpstreamError('invalid');
        }
        rememberBitcoinInclusions(observations, block, transactionIds);
        if (height === latest.height) {
          observations.checkedBlock = { hash: latestHash, transactionIds };
        }
        return { height, verified: true };
      } catch {
        return { height, verified: false };
      }
    }),
  );
  // Later successful blocks can be cached, but cannot conceal an earlier failed check.
  for (const outcome of outcomes) {
    if (!outcome.verified) {
      unavailable = true;
      break;
    }
    observations.nextHeight = outcome.height + 1;
  }
  pruneBitcoinInclusions(observations);
  return { unavailable, truncated, reorganized };
}

export type BitcoinProjectionReader = (config: ServerConfig) => Promise<Tx[]>;

/** Volatile, bounded evidence owned by one service instance; never shared across providers. */
export function createBitcoinProvider(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
  readProjection?: BitcoinProjectionReader,
): () => Promise<Snapshot> {
  const observations: BitcoinObservations = { pending: new Map(), verified: new Map() };
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
    { pending: new Map(), verified: new Map() },
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
  const knownInclusions = new Map(
    [...observations.verified.values()].flatMap((entry) =>
      entry.transactionIds.map(
        (id) => [id, { height: entry.block.height, hash: entry.block.hash }] as const,
      ),
    ),
  );
  // Neither the first projected block nor the recent arrivals cover the whole mempool.
  // Older samples remain only as candidates for an explicit inclusion check.
  for (const transaction of transactions) {
    const previous = observations.pending.get(transaction.id);
    const inclusion = previous?.inclusion ?? knownInclusions.get(transaction.id);
    observations.pending.delete(transaction.id);
    observations.pending.set(transaction.id, {
      transaction,
      lastSeenAt: observedAt,
      ...(inclusion ? { inclusion } : {}),
    });
  }
  const latest = blocks[0]!;
  const latestHash = latest.id.toLowerCase();
  const inclusionResult = await collectBitcoinInclusions(config, fetcher, observations, blocks);
  const confirmationUnavailable = inclusionResult.unavailable;
  // Verify retained IDs before the new fee sample can evict them. This temporary
  // map is bounded by 2,048 retained observations plus at most 96 current arrivals.
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
    (transaction) => !observations.pending.get(transaction.id)?.inclusion,
  );
  const confirmed = [...observations.pending.values()]
    .filter((tracked) => tracked.inclusion?.hash === latestHash)
    .map((tracked) => ({
      ...tracked.transaction,
      status: 'confirmed' as const,
      blockHash: latestHash,
    }));
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
    coverage: `${hasTopFeeSample ? 'Échantillon regroupant jusqu’à 96 transactions aux meilleurs frais propres (fee/vsize) parmi le premier bloc projeté du fournisseur Bitcoin, sans inventaire exhaustif ni garantie de sélection par un mineur.' : hasRecentSample ? 'Sélection des meilleurs frais parmi les seules transactions récentes du fournisseur Bitcoin : le classement du premier bloc projeté est indisponible, ce repli ne représente pas un top global.' : 'L’échantillon de transactions en attente est temporairement indisponible ; les blocs et indicateurs du fournisseur restent disponibles.'} Suivi borné à 2 048 identifiants et 30 minutes ; inclusions vérifiées auprès du fournisseur, sans garantie de finalité. Chaque nœud peut observer un mempool différent. Tailles en octets virtuels.`,
    pendingCount: mempool.count,
    feeRate: fees.halfHourFee,
    feeUnit: 'sat/vB',
    transactions: [...pendingSample, ...confirmedSample],
    blocks: blocks.slice(0, MAX_BLOCKS).map(publicBlock),
    inclusions: [...observations.verified.values()].sort(
      (left, right) => left.block.height - right.block.height,
    ),
    message: `Indicateur de frais : estimation du fournisseur pour environ 30 minutes, sans garantie de confirmation.${hasTopFeeSample ? '' : ' Classement du premier bloc projeté indisponible ; aucun top global annoncé.'}${confirmationUnavailable ? ' Vérification des inclusions partielle : les hauteurs non vérifiées seront réessayées ; la disparition d’une transaction ne prouve rien.' : ''}${inclusionResult.truncated ? ' Interruption prolongée : rattrapage limité aux 8 derniers blocs ; les blocs plus anciens ne sont pas vérifiés.' : ''}${inclusionResult.reorganized ? ' Changement de branche détecté : les anciennes preuves concernées sont retirées, les identifiants encore conservés sont suivis à nouveau.' : ''}`,
  });
}
