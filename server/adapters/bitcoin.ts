import { z } from 'zod';
import {
  BITCOIN_ARRIVAL_SAMPLE_LIMIT,
  CONFIRMED_SAMPLE_LIMIT,
  MAX_BLOCKS,
  MAX_CATCHUP_BLOCKS,
  MAX_INCLUSION_BLOCKS,
  MAX_TRACKED_TRANSACTIONS,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  latestBlockValueSchema,
  snapshotSchema,
  type Block,
  type BlockInclusions,
  type LatestBlockValue,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import type { ServerConfig } from '../config.js';
import { BITCOIN_LIVE_ARRIVAL_TTL_MS, type BitcoinArrivalSample } from '../bitcoinLiveArrivals.js';
import { createBitcoinCandidateComparisonTracker } from './bitcoinCandidateComparison.js';
import { fetchBitcoinTopFeeSample } from './bitcoinTopFees.js';
import {
  BITCOIN_POOL_REFRESH_MS,
  createBitcoinPoolReader,
  type BitcoinPoolReader,
} from './bitcoinPool.js';
import {
  BITCOIN_TEMPLATE_MAX_AGE_MS,
  createBitcoinTemplateReader,
  type BitcoinTemplateReader,
  type BitcoinTemplateSample,
} from './bitcoinTemplate.js';
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
const bitcoinBlockValueStatsSchema = z.object({
  id: hashSchema,
  height: safeInteger,
  tx_count: safeInteger.max(5_000_000),
  extras: z.object({ totalOutputAmt: safeInteger }),
});
export const BITCOIN_TRACKED_SAMPLE_LIMIT = MAX_TRACKED_TRANSACTIONS;
export const BITCOIN_TRACKED_SAMPLE_TTL_MS = TRACKED_TRANSACTION_TTL_MS;
/** Reserve a bounded view of the queue outside the node's proposed first block. */
export const BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT = Math.floor(PENDING_SAMPLE_LIMIT / 5);

interface TrackedTransaction {
  transaction: Tx;
  lastSeenAt: number;
  inclusion?: { height: number; hash: string };
}

interface BitcoinObservations {
  pending: Map<string, TrackedTransaction>;
  verified: Map<number, BlockInclusions>;
  comparison: ReturnType<typeof createBitcoinCandidateComparisonTracker>;
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

function latestBitcoinBlockValue(
  rawBlock: unknown,
  latest: BitcoinBlock,
  observedAt: number,
): LatestBlockValue | null {
  // Mempool's enriched block already carries Core getblockstats.total_out.
  // It excludes coinbase, includes change, and is not net economic volume.
  const parsed = bitcoinBlockValueStatsSchema.safeParse(rawBlock);
  if (
    !parsed.success ||
    latest.tx_count < 1 ||
    parsed.data.id.toLowerCase() !== latest.id.toLowerCase() ||
    parsed.data.height !== latest.height ||
    parsed.data.tx_count !== latest.tx_count
  ) {
    return null;
  }
  return parsePayload(latestBlockValueSchema, {
    blockHash: latest.id.toLowerCase(),
    blockHeight: latest.height,
    amount: BigInt(parsed.data.extras.totalOutputAmt).toString(),
    unit: 'sat',
    method: 'bitcoin-output-sum',
    transactionCount: latest.tx_count,
    observedAt,
  });
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
  readPool?: BitcoinPoolReader,
  readTemplate?: BitcoinTemplateReader,
  readArrivals?: () => BitcoinArrivalSample | null,
): () => Promise<Snapshot> {
  const observations: BitcoinObservations = {
    pending: new Map(),
    verified: new Map(),
    comparison: createBitcoinCandidateComparisonTracker(),
  };
  // An injected HTTP transport must not unexpectedly open a real WebSocket.
  // Provider fixtures can inject a projection reader separately.
  const projectionReader =
    readProjection ?? (fetcher === undefined ? fetchBitcoinTopFeeSample : undefined);
  const poolReader =
    readPool ??
    (fetcher === undefined && readProjection === undefined
      ? createBitcoinPoolReader(config, undefined, now)
      : undefined);
  const templateReader =
    readTemplate ??
    (fetcher === undefined && readProjection === undefined && readPool === undefined
      ? createBitcoinTemplateReader(config, undefined, now)
      : undefined);
  return () =>
    collectBitcoinSnapshot(
      config,
      fetcher,
      now,
      observations,
      projectionReader,
      poolReader,
      templateReader,
      readArrivals,
    );
}

export async function fetchBitcoinSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
  readProjection?: BitcoinProjectionReader,
  readPool?: BitcoinPoolReader,
  readTemplate?: BitcoinTemplateReader,
  readArrivals?: () => BitcoinArrivalSample | null,
): Promise<Snapshot> {
  return collectBitcoinSnapshot(
    config,
    fetcher,
    now,
    {
      pending: new Map(),
      verified: new Map(),
      comparison: createBitcoinCandidateComparisonTracker(),
    },
    readProjection ?? (fetcher === undefined ? fetchBitcoinTopFeeSample : undefined),
    readPool,
    readTemplate,
    readArrivals,
  );
}

function matchingTemplate(
  sample: BitcoinTemplateSample | null,
  latest: BitcoinBlock,
  now: number,
): BitcoinTemplateSample | null {
  return sample &&
    now >= sample.observedAt &&
    now - sample.observedAt <= BITCOIN_TEMPLATE_MAX_AGE_MS &&
    sample.height === latest.height + 1 &&
    sample.previousBlockHash === latest.id.toLowerCase()
    ? sample
    : null;
}

function templateTransactions(
  template: BitcoinTemplateSample,
  pool: ReturnType<BitcoinPoolReader>,
): readonly Tx[] {
  if (!pool) return template.transactions;
  const outside = pool.transactions.filter((tx) => !template.transactionIds.has(tx.id));
  const outsideCount = Math.min(
    outside.length,
    Math.max(
      BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT,
      PENDING_SAMPLE_LIMIT - template.transactions.length,
    ),
  );
  return [
    ...template.transactions.slice(0, PENDING_SAMPLE_LIMIT - outsideCount),
    ...outside.slice(0, outsideCount),
  ];
}

function matchingArrivals(
  sample: BitcoinArrivalSample | null,
  observedAt: number,
): BitcoinArrivalSample | null {
  return sample &&
    Number.isSafeInteger(sample.observedAt) &&
    sample.observedAt >= 0 &&
    sample.observedAt <= observedAt &&
    observedAt - sample.observedAt <= BITCOIN_LIVE_ARRIVAL_TTL_MS &&
    sample.source.trim().length > 0 &&
    sample.source.length <= 100
    ? sample
    : null;
}

function currentArrivals(
  read: (() => BitcoinArrivalSample | null) | undefined,
  observedAt: number,
): BitcoinArrivalSample | null {
  try {
    return matchingArrivals(read?.() ?? null, observedAt);
  } catch {
    // This optional stream cannot invalidate independent live blocks or fee data.
    return null;
  }
}

function mixedTransactions(base: readonly Tx[], arrivals: BitcoinArrivalSample | null): Tx[] {
  const selected = new Map<string, Tx>();
  for (const transaction of [
    ...(arrivals?.transactions.slice(0, BITCOIN_ARRIVAL_SAMPLE_LIMIT) ?? []),
    ...base,
  ]) {
    if (selected.size >= PENDING_SAMPLE_LIMIT) break;
    if (!selected.has(transaction.id)) selected.set(transaction.id, transaction);
  }
  return [...selected.values()];
}

async function collectBitcoinSnapshot(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  now: () => number,
  observations: BitcoinObservations,
  projectionReader: BitcoinProjectionReader | undefined,
  poolReader: BitcoinPoolReader | undefined,
  templateReader: BitcoinTemplateReader | undefined,
  readArrivals: (() => BitcoinArrivalSample | null) | undefined,
): Promise<Snapshot> {
  // A complete-pool download runs in the background. Live block polling never
  // waits for its potentially large response, and injected transports stay isolated.
  const previousTemplate = templateReader?.() ?? null;
  const previousPool = poolReader?.() ?? null;
  const options = fetcher === undefined ? {} : { fetcher };
  const headRequest = requestJson(`${config.bitcoinApiUrl}/v1/blocks`, options).then((raw) => {
    const blocks = parsePayload(bitcoinBlocksSchema, raw);
    // Detect the head before a slower fee, recent-sample or projection read completes.
    // Only a candidate published against the previous head can be frozen here.
    observations.comparison.observeHead(blocks[0]!, now(), config.bitcoinSource);
    return { raw, blocks };
  });
  const [[{ raw: blocksRaw, blocks }, mempoolRaw, feesRaw], recentResult, initialProjection] =
    await Promise.all([
      Promise.all([
        headRequest,
        requestJson(`${config.bitcoinApiUrl}/mempool`, options),
        requestJson(`${config.bitcoinApiUrl}/v1/fees/recommended`, options),
      ]),
      requestJson(`${config.bitcoinApiUrl}/mempool/recent`, options).then(
        (value) => ({ value, failed: false }),
        () => ({ value: null, failed: true }),
      ),
      (previousTemplate || previousPool
        ? Promise.resolve(null)
        : (projectionReader?.(config) ?? Promise.reject(new UpstreamError('network')))
      ).then(
        (value) => ({ value, failed: false }),
        () => ({ value: null, failed: true }),
      ),
    ]);
  const mempool = parsePayload(bitcoinMempoolSchema, mempoolRaw);
  const fees = parsePayload(bitcoinFeesSchema, feesRaw);
  const observedAt = now();
  const latest = blocks[0]!;
  const template = matchingTemplate(templateReader?.() ?? null, latest, observedAt);
  // The complete pool continues to reconcile independently of the optional candidate.
  // Exclusions are applied only to its bounded display sample, never to its inventory/count.
  const pool = poolReader?.(template?.transactionIds) ?? null;
  // A template can become obsolete when a block arrives during the REST read.
  // Fetch the usual projection only when neither primary nor pool can serve it.
  const projectionResult =
    !template && !pool && (previousTemplate || previousPool)
      ? await (projectionReader?.(config) ?? Promise.reject(new UpstreamError('network'))).then(
          (value) => ({ value, failed: false }),
          () => ({ value: null, failed: true }),
        )
      : initialProjection;
  const recentParsed = bitcoinRecentSchema.safeParse(recentResult.value);
  const hasTopFeeSample = !projectionResult.failed && projectionResult.value !== null;
  const hasRecentSample = !recentResult.failed && recentParsed.success;
  const baseTransactions: readonly Tx[] = template
    ? templateTransactions(template, pool)
    : pool
      ? pool.transactions
      : hasTopFeeSample
        ? projectionResult.value!.slice(0, PENDING_SAMPLE_LIMIT)
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
              .slice(0, PENDING_SAMPLE_LIMIT)
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
  const arrivals = currentArrivals(readArrivals, observedAt);
  const transactions = mixedTransactions(baseTransactions, arrivals);
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
  // A complete pool and recent notifications contribute only this bounded mixed sample.
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
  const latestHash = latest.id.toLowerCase();
  // An absent or invalid optional aggregate cannot invalidate the live chain snapshot.
  const latestBlockValue = latestBitcoinBlockValue(
    Array.isArray(blocksRaw) ? blocksRaw[0] : undefined,
    latest,
    observedAt,
  );
  const inclusionResult = await collectBitcoinInclusions(config, fetcher, observations, blocks);
  if (inclusionResult.reorganized) observations.comparison.invalidate();
  const confirmationUnavailable = inclusionResult.unavailable;
  // Verify retained IDs before the new fee sample can evict them. The temporary map
  // holds retained observations plus at most PENDING_SAMPLE_LIMIT current arrivals.
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
  // An unusually slow inclusion catch-up must not publish an expired candidate.
  // Prune first, then retry once through the fallback chain without a template reader.
  if (
    template &&
    (!matchingTemplate(template, latest, now()) ||
      !matchingTemplate(templateReader?.() ?? null, latest, now()))
  )
    return collectBitcoinSnapshot(
      config,
      fetcher,
      now,
      observations,
      projectionReader,
      poolReader,
      undefined,
      readArrivals,
    );
  if (arrivals && !matchingArrivals(arrivals, now())) {
    return collectBitcoinSnapshot(
      config,
      fetcher,
      now,
      observations,
      projectionReader,
      poolReader,
      templateReader,
      undefined,
    );
  }
  const verifiedInclusions = new Map(
    [...observations.verified.values()].flatMap((entry) =>
      entry.transactionIds.map(
        (id) => [id, { height: entry.block.height, hash: entry.block.hash }] as const,
      ),
    ),
  );
  const latestProof =
    observations.checkedBlock?.hash === latestHash
      ? observations.checkedBlock.transactionIds
      : undefined;
  const inclusionFor = (id: string) =>
    observations.pending.get(id)?.inclusion ??
    verifiedInclusions.get(id) ??
    (latestProof?.has(id) ? { height: latest.height, hash: latestHash } : undefined);
  const pending = transactions.filter((transaction) => !inclusionFor(transaction.id));
  // A missing older height preserves watch slots for retry. Even if that bounded
  // watch map is full, its eviction policy cannot erase an exact current-block proof.
  const confirmedCandidates = new Map(
    [...observations.pending.values()].map(({ transaction }) => [transaction.id, transaction]),
  );
  for (const transaction of transactions) confirmedCandidates.set(transaction.id, transaction);
  const confirmed = [...confirmedCandidates.values()]
    .filter((transaction) => inclusionFor(transaction.id)?.hash === latestHash)
    .map((transaction) => ({
      ...transaction,
      status: 'confirmed' as const,
      blockHash: latestHash,
    }));
  // Keep the full pending sample and a separate bounded set of proven inclusions.
  const confirmedSample = [...confirmed]
    .sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id))
    .slice(0, CONFIRMED_SAMPLE_LIMIT);
  const pendingSample = pending.slice(0, PENDING_SAMPLE_LIMIT);
  const arrivalIds = new Set(
    arrivals?.transactions.slice(0, BITCOIN_ARRIVAL_SAMPLE_LIMIT).map(({ id }) => id) ?? [],
  );
  const representedArrivalIds = pendingSample
    .filter(({ id }) => arrivalIds.has(id))
    .map(({ id }) => id);
  const bitcoinArrivals =
    arrivals && representedArrivalIds.length
      ? {
          source: arrivals.source,
          method: 'mempool-transactions' as const,
          observedAt: arrivals.observedAt,
          transactionIds: representedArrivalIds,
        }
      : null;
  const freshArrivalIds = new Set(representedArrivalIds);
  const poolFlow =
    pool && pool.observedAt <= observedAt && observedAt - pool.observedAt <= BITCOIN_POOL_REFRESH_MS
      ? (pool.flowForSample?.(new Set(pendingSample.map(({ id }) => id))) ?? null)
      : null;
  const templateSelectedIds = template
    ? [...new Set([...pendingSample.map((tx) => tx.id), ...observations.pending.keys()])]
        .filter((id) => template.transactionIds.has(id))
        .slice(0, MAX_TRACKED_TRANSACTIONS)
    : [];
  const poolObservationIds = pool?.hasTransaction
    ? [...new Set([...pendingSample.map((tx) => tx.id), ...observations.pending.keys()])].slice(
        0,
        MAX_TRACKED_TRANSACTIONS,
      )
    : [];
  const presentTransactionIds: string[] = [];
  const absentTransactionIds: string[] = [];
  for (const id of poolObservationIds) {
    const present = pool!.hasTransaction!(id);
    // A separate RPC inventory cannot turn a fresh notification from another
    // observation source into a disappearance. It still never proves RPC presence.
    if (!present && freshArrivalIds.has(id)) continue;
    (present ? presentTransactionIds : absentTransactionIds).push(id);
  }
  const poolObservation = pool?.hasTransaction
    ? {
        source: pool.source,
        method: 'getrawmempool' as const,
        observedAt: pool.observedAt,
        presentTransactionIds,
        queuedTransactionIds: [],
        absentTransactionIds,
      }
    : null;
  const outsideSampleCount = template
    ? pendingSample.filter((tx) => !template.transactionIds.has(tx.id)).length
    : 0;
  const templateFallback = template
    ? ''
    : templateReader
      ? ' Candidat getblocktemplate en cours, indisponible, expiré ou sur une autre tête : approche de repli.'
      : '';
  const comparison = observations.comparison.compare(latest, observations.checkedBlock, now());
  const arrivalsCoverage = bitcoinArrivals
    ? `Échantillon mixte : ${representedArrivalIds.length} arrivées de ${bitcoinArrivals.source}, complétées par ${template ? 'GBT' : pool ? 'RPC' : 'le fournisseur'}. Priorité aux arrivées, sans top global ni preuve d’inclusion. ${template ? `Candidat de ${template.source} #${template.height} : ${template.count} tx hors coinbase ; compte, poids et médiane inchangés.` : ''} ${pool ? `Compteur/inventaire RPC : ${pool.source}.` : `Compteur REST : ${config.bitcoinSource}.`} Suivi : ${MAX_TRACKED_TRANSACTIONS} IDs/30 min. Inclusions vérifiées séparément, sans garantie de finalité. Vues locales distinctes ; tailles en vB.`
    : null;
  const combinedSource =
    pool && !template ? `${config.bitcoinSource} · ${pool.source}` : config.bitcoinSource;
  const snapshot = parsePayload(snapshotSchema, {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    // Under GBT, the candidate has its own source. Keep the general REST source
    // accurate for the separately displayed mempool count and block metrics.
    source: combinedSource.length <= 100 ? combinedSource : config.bitcoinSource,
    observedAt,
    coverage:
      arrivalsCoverage ??
      `${template ? `Candidat GBT complet de ${template.source} #${template.height} : ${template.count} tx hors coinbase. Compte, poids et médiane sur toutes ses transactions ; détails individuels limités à ${pendingSample.length}, dont ${outsideSampleCount} hors candidat. Inventaire RPC ${pool ? 'réconcilié séparément' : 'indisponible'} ; compteur ${pool ? 'RPC' : 'REST'}. Blocs/frais : ${config.bitcoinSource}. Aucune preuve de minage ni d’inclusion.` : pool ? `Top ${PENDING_SAMPLE_LIMIT} des frais propres par vB (poids/4) de l’index ${pool.source}, réconcilié avec son dernier inventaire d’IDs : détails des ajouts seuls, au plus toutes les 30 s ; collecte complète au départ et toutes les 10 min. Compteur de cette source ; blocs/frais conseillés : ${config.bitcoinSource}. Index non atomique, CPFP exclu.` : hasTopFeeSample ? `Échantillon regroupant jusqu’à ${PENDING_SAMPLE_LIMIT} transactions aux meilleurs frais propres (fee/vsize) parmi le premier bloc projeté du fournisseur Bitcoin, sans inventaire exhaustif ni garantie de sélection par un mineur.` : hasRecentSample ? 'Sélection des meilleurs frais parmi les seules transactions récentes du fournisseur Bitcoin : le classement du premier bloc projeté est indisponible, ce repli ne représente pas un top global.' : 'L’échantillon de transactions en attente est temporairement indisponible ; les blocs et indicateurs du fournisseur restent disponibles.'} Suivi borné à ${MAX_TRACKED_TRANSACTIONS} identifiants et 30 minutes ; inclusions vérifiées auprès du fournisseur, sans garantie de finalité. Chaque nœud peut observer un mempool différent. Tailles en octets virtuels.`,
    pendingCount: pool?.count ?? mempool.count,
    blockTemplate: template
      ? {
          source: template.source,
          observedAt: template.observedAt,
          height: template.height,
          previousBlockHash: template.previousBlockHash,
          transactionCount: template.count,
          weight: template.weight,
          weightLimit: template.weightLimit,
          medianFeeSats: template.medianFeeSats,
          selectedTransactionIds: templateSelectedIds,
        }
      : null,
    // A wall-clock correction during the asynchronous inclusion read must not
    // attach evidence dated after the snapshot's own observation.
    candidateComparison: comparison && comparison.blockObservedAt <= observedAt ? comparison : null,
    sampling: pool
      ? {
          method: 'getrawmempool',
          source: pool.source,
          observedAt: pool.observedAt,
          pendingCount: pool.count,
          update: pool.update,
        }
      : null,
    poolObservation,
    poolFlow,
    bitcoinArrivals,
    latestBlockValue,
    feeRate: fees.halfHourFee,
    feeUnit: 'sat/vB',
    transactions: [...pendingSample, ...confirmedSample],
    blocks: blocks.slice(0, MAX_BLOCKS).map(publicBlock),
    inclusions: [...observations.verified.values()].sort(
      (left, right) => left.block.height - right.block.height,
    ),
    message: `Frais conseillés par ${config.bitcoinSource} pour environ 30 min, sans garantie d’inclusion.${bitcoinArrivals ? ' Échantillon mixte : arrivées récentes réelles, puis complément ; priorité aux arrivées, sans top global. Le candidat du nœud reste une proposition distincte, sans preuve d’inclusion.' : template ? ' Candidat GBT complet : compte, poids et médiane sur toutes ses transactions ; détails individuels limités. Proposition du nœud, sans preuve de minage ou d’inclusion.' : pool ? ' Classement de l’index RPC complet selon le dernier inventaire reçu ; réconciliation non atomique.' : ' Collecte RPC complète en cours ou indisponible : repli limité, sans top global.'}${templateFallback}${confirmationUnavailable ? ' Inclusions partiellement vérifiées : hauteurs manquantes réessayées ; une disparition ne prouve rien.' : ''}${inclusionResult.truncated ? ' Rattrapage limité aux 8 derniers blocs ; les blocs plus anciens ne sont pas vérifiés.' : ''}${inclusionResult.reorganized ? ' Branche modifiée : anciennes preuves concernées retirées, identifiants conservés suivis à nouveau.' : ''}`,
  });
  // A candidate becomes eligible for the next comparison only after publication
  // of a valid snapshot anchored to this exact head; never just on reader arrival.
  observations.comparison.publishCandidate(template, latest, now());
  return snapshot;
}
