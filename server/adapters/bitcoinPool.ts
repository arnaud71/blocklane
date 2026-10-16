import { z } from 'zod';
import { PENDING_SAMPLE_LIMIT, type PoolFlow, type Tx } from '../../shared/model.js';
import { createPoolFlowTracker } from './poolFlow.js';
import { UPSTREAM_TIMEOUT_MS, type ServerConfig } from '../config.js';
import {
  parsePayload,
  ratioToNumber,
  requestJson,
  requestMempoolJson,
  UpstreamError,
  type Fetcher,
} from '../network.js';

export const BITCOIN_POOL_REFRESH_MS = 30_000;
export const BITCOIN_POOL_MAX_TRANSACTIONS = 100_000;
export const BITCOIN_POOL_RESYNC_MS = 10 * 60 * 1_000;
export const BITCOIN_POOL_MAX_ADDITIONS = 500;
export const BITCOIN_POOL_INCREMENTAL_COOLDOWN_MS = 5 * 60 * 1_000;
const ENTRY_BATCH_SIZE = 25;
const ENTRY_BATCH_CONCURRENCY = 2;
const hashPattern = /^[a-fA-F0-9]{64}$/;
const safeInteger = z.number().int().nonnegative().safe();
const entrySchema = z.object({
  vsize: safeInteger.positive().max(1_000_000),
  weight: safeInteger.positive().max(4_000_000),
  fees: z.object({ base: z.number().finite().nonnegative().max(21_000_000) }),
});
const chainSchema = z.object({ chain: z.string(), initialblockdownload: z.boolean() });
const responseSchema = z
  .array(
    z.object({
      id: z.enum(['chain', 'pool']),
      result: z.unknown().optional(),
      error: z.unknown().optional(),
    }),
  )
  .length(2);
const inventorySchema = z.object({
  txids: z.array(z.string().regex(hashPattern)).max(BITCOIN_POOL_MAX_TRANSACTIONS),
  mempool_sequence: safeInteger,
});
const entriesResponseSchema = z
  .array(
    z.object({
      id: z.string().regex(hashPattern),
      result: z.unknown().optional(),
      error: z.unknown().optional(),
    }),
  )
  .min(1)
  .max(ENTRY_BATCH_SIZE);

export interface BitcoinPoolSample {
  transactions: Tx[];
  count: number;
  observedAt: number;
  source: string;
  update: 'full' | 'incremental';
  /** Private lookup over the reconciled inventory; never serialized into the public snapshot. */
  hasTransaction?: (id: string) => boolean;
  /** A sample-bound aggregate; individual inventory IDs never leave this callback. */
  flowForSample?: (selectedIds: ReadonlySet<string>) => PoolFlow | null;
}

/** A synchronous view of an optional background collection; never stalls live block polling. */
export type BitcoinPoolReader = (excludedIds?: ReadonlySet<string>) => BitcoinPoolSample | null;

interface RankedTransaction {
  id: string;
  fee: bigint;
  weight: number;
}
interface CompactEntry {
  fee: bigint;
  weight: number;
}
interface PoolIndex {
  entries: Map<string, CompactEntry>;
  observedAt: number;
  baselineAt: number;
  update: 'full' | 'incremental';
}

class AdditionBudgetError extends UpstreamError {
  constructor(public readonly newEntries: number) {
    super('too-large');
  }
}

class PoolRpcError extends UpstreamError {
  readonly unsupportedIncremental: boolean;
  constructor(error: unknown) {
    super('rpc');
    const parsed = z.object({ code: z.number().int().safe() }).safeParse(error);
    this.unsupportedIncremental =
      parsed.success && (parsed.data.code === -32601 || parsed.data.code === -32602);
  }
}

/** Order by the transaction's own base fee, without CPFP, fee deltas or acceleration. */
function compareFees(left: RankedTransaction, right: RankedTransaction): number {
  const leftFee = left.fee * BigInt(right.weight);
  const rightFee = right.fee * BigInt(left.weight);
  return leftFee > rightFee
    ? -1
    : leftFee < rightFee
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
}

/** Retain only the strongest candidates: the root is always the weakest retained rate. */
function offerCandidate(heap: RankedTransaction[], transaction: RankedTransaction): void {
  if (heap.length < PENDING_SAMPLE_LIMIT) {
    heap.push(transaction);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareFees(heap[index]!, heap[parent]!) <= 0) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
      index = parent;
    }
    return;
  }
  if (compareFees(transaction, heap[0]!) >= 0) return;
  heap[0] = transaction;
  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const weakest =
      right < heap.length && compareFees(heap[right]!, heap[left]!) > 0 ? right : left;
    if (compareFees(heap[index]!, heap[weakest]!) >= 0) break;
    [heap[index], heap[weakest]] = [heap[weakest]!, heap[index]!];
    index = weakest;
  }
}

function ownFeeSatoshis(amount: number): bigint {
  // Core serializes fees in BTC with at most eight decimal places. Recover the
  // integer satoshi amount before comparisons; reject fractional satoshis.
  const [coefficient = '', exponent = '0'] = amount.toString().split('e');
  const [whole = '', fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction);
  const shift = 8 + Number(exponent) - fraction.length;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  if (digits % divisor !== 0n) throw new UpstreamError('invalid');
  return digits / divisor;
}

function readCompactEntry(raw: unknown): CompactEntry {
  const entry = parsePayload(entrySchema, raw);
  // A policy-adjusted vsize can exceed the weight-derived size, never fall below it.
  if (entry.vsize < Math.ceil(entry.weight / 4)) throw new UpstreamError('invalid');
  return { fee: ownFeeSatoshis(entry.fees.base), weight: entry.weight };
}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new UpstreamError('timeout');
  return remaining;
}

async function readPoolResponse(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  verbose: boolean,
  deadline: number,
): Promise<unknown> {
  if (!config.bitcoinRpcUrl) throw new UpstreamError('network');
  const raw = await requestMempoolJson(config.bitcoinRpcUrl, {
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs: remainingTimeout(deadline),
    ...(verbose ? {} : { maxBytes: 8 * 1024 * 1024 }),
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 'chain', method: 'getblockchaininfo', params: [] },
      {
        jsonrpc: '2.0',
        id: 'pool',
        method: 'getrawmempool',
        params: verbose ? [true] : [false, true],
      },
    ]),
  });
  const responses = parsePayload(responseSchema, raw);
  const chainResponse = responses.find((response) => response.id === 'chain');
  const poolResponse = responses.find((response) => response.id === 'pool');
  if (!chainResponse || !poolResponse) throw new UpstreamError('rpc');
  const failed = responses.find((response) => response.error != null);
  if (failed) throw new PoolRpcError(failed.error);
  const chain = parsePayload(chainSchema, chainResponse.result);
  if (chain.chain !== 'main') throw new UpstreamError('wrong-chain');
  if (chain.initialblockdownload) throw new UpstreamError('invalid');
  remainingTimeout(deadline);
  return poolResponse.result;
}

async function collectBaseline(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  now: () => number,
  deadline: number,
): Promise<PoolIndex> {
  const pool = await readPoolResponse(config, fetcher, true, deadline);
  const observedAt = now();
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) throw new UpstreamError('invalid');
  const entries = Object.entries(pool);
  if (entries.length > BITCOIN_POOL_MAX_TRANSACTIONS) throw new UpstreamError('too-large');
  const compact = new Map<string, CompactEntry>();
  for (const [rawId, rawEntry] of entries) {
    if (!hashPattern.test(rawId)) throw new UpstreamError('invalid');
    const id = rawId.toLowerCase();
    if (compact.has(id)) throw new UpstreamError('invalid');
    compact.set(id, readCompactEntry(rawEntry));
  }
  remainingTimeout(deadline);
  return { entries: compact, observedAt, baselineAt: observedAt, update: 'full' };
}

async function collectNewEntries(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  ids: readonly string[],
  deadline: number,
): Promise<Map<string, CompactEntry>> {
  if (!config.bitcoinRpcUrl) throw new UpstreamError('network');
  const raw = await requestJson(config.bitcoinRpcUrl, {
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs: remainingTimeout(deadline),
    maxBytes: 128 * 1024,
    body: JSON.stringify(
      ids.map((id) => ({ jsonrpc: '2.0', id, method: 'getmempoolentry', params: [id] })),
    ),
  });
  const responses = parsePayload(entriesResponseSchema, raw);
  if (responses.length !== ids.length) throw new UpstreamError('invalid');
  const requested = new Set(ids);
  const entries = new Map<string, CompactEntry>();
  for (const response of responses) {
    const id = response.id.toLowerCase();
    if (!requested.has(id) || entries.has(id)) throw new UpstreamError('invalid');
    // An ID may have been mined or evicted since inventory. Do not publish an
    // incomplete reconciliation, and never interpret this error as confirmation.
    if (response.error != null) throw new PoolRpcError(response.error);
    entries.set(id, readCompactEntry(response.result));
  }
  remainingTimeout(deadline);
  return entries;
}

async function reconcilePool(
  config: ServerConfig,
  fetcher: Fetcher | undefined,
  now: () => number,
  previous: PoolIndex,
  deadline: number,
): Promise<PoolIndex> {
  const inventory = parsePayload(
    inventorySchema,
    await readPoolResponse(config, fetcher, false, deadline),
  );
  // This is the inventory receipt time, not an assertion that all detail reads
  // happened atomically. Base fees and transaction weights are immutable by ID.
  const observedAt = now();
  const ids = new Set<string>();
  const entries = new Map<string, CompactEntry>();
  const additions: string[] = [];
  for (const rawId of inventory.txids) {
    const id = rawId.toLowerCase();
    if (ids.has(id)) throw new UpstreamError('invalid');
    ids.add(id);
    const entry = previous.entries.get(id);
    if (entry) entries.set(id, entry);
    else additions.push(id);
  }
  // A burst or a load-balanced upstream can exceed the incremental budget.
  // Abandon this inventory without publishing an incomplete index. Previously
  // validated immutable metadata can still be reused by the next attempt.
  if (additions.length > BITCOIN_POOL_MAX_ADDITIONS)
    throw new AdditionBudgetError(additions.length);
  additions.sort();
  const batches: string[][] = [];
  for (let offset = 0; offset < additions.length; offset += ENTRY_BATCH_SIZE) {
    batches.push(additions.slice(offset, offset + ENTRY_BATCH_SIZE));
  }
  for (let offset = 0; offset < batches.length; offset += ENTRY_BATCH_CONCURRENCY) {
    // Await every in-flight request even after one failure, so the following
    // cycle can never overlap with an abandoned details request.
    const outcomes = await Promise.allSettled(
      batches
        .slice(offset, offset + ENTRY_BATCH_CONCURRENCY)
        .map((batch) => collectNewEntries(config, fetcher, batch, deadline)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
      for (const [id, entry] of outcome.value) entries.set(id, entry);
    }
  }
  if (entries.size !== ids.size) throw new UpstreamError('invalid');
  remainingTimeout(deadline);
  return { entries, observedAt, baselineAt: previous.baselineAt, update: 'incremental' };
}

function samplePool(
  config: ServerConfig,
  pool: PoolIndex,
  excludedIds?: ReadonlySet<string>,
  flow?: ReturnType<typeof createPoolFlowTracker>,
): BitcoinPoolSample {
  const candidates: RankedTransaction[] = [];
  for (const [id, entry] of pool.entries)
    if (!excludedIds?.has(id)) offerCandidate(candidates, { id, ...entry });
  return {
    count: pool.entries.size,
    observedAt: pool.observedAt,
    source: config.bitcoinPoolSource ?? 'RPC Bitcoin configuré',
    update: pool.update,
    hasTransaction: (id) => pool.entries.has(id.toLowerCase()),
    ...(flow
      ? {
          flowForSample: (selectedIds: ReadonlySet<string>) =>
            flow.forSample(selectedIds, pool.observedAt),
        }
      : {}),
    transactions: candidates.sort(compareFees).map((transaction) => ({
      id: transaction.id,
      chain: 'bitcoin',
      feeRate: ratioToNumber(transaction.fee * 4n, BigInt(transaction.weight)),
      // Block space uses actual BIP141 weight, not Core's possible sigop policy adjustment.
      size: transaction.weight / 4,
      status: 'pending',
      kind: 'transfer',
      value: 'Montant non fourni',
    })),
  };
}

/** One bounded full baseline, then complete ID inventories with details for additions only. */
export function createBitcoinPoolReader(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): BitcoinPoolReader {
  const flow = createPoolFlowTracker({
    source: config.bitcoinPoolSource ?? 'RPC Bitcoin configuré',
    method: 'getrawmempool',
    maxTransactions: BITCOIN_POOL_MAX_TRANSACTIONS,
  });
  let sample: BitcoinPoolSample | null = null;
  let index: PoolIndex | null = null;
  let pending = false;
  let nextAttemptAt = 0;
  let incrementalDisabledUntil = 0;
  let lastFailure: string | null = null;
  let excludedSample:
    { index: PoolIndex; excludedIds: ReadonlySet<string>; sample: BitcoinPoolSample } | undefined;
  return (excludedIds) => {
    const currentTime = now();
    if (index && currentTime < index.observedAt) {
      flow.invalidate();
      sample = null;
      index = null;
      excludedSample = undefined;
    }
    if (
      sample &&
      (currentTime < sample.observedAt || currentTime - sample.observedAt > BITCOIN_POOL_REFRESH_MS)
    ) {
      sample = null;
    }
    if (config.bitcoinRpcUrl && !pending && currentTime >= nextAttemptAt) {
      pending = true;
      const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
      const phase =
        index &&
        currentTime >= incrementalDisabledUntil &&
        currentTime >= index.baselineAt &&
        currentTime - index.baselineAt < BITCOIN_POOL_RESYNC_MS
          ? 'incremental'
          : 'baseline';
      const refresh =
        index && phase === 'incremental'
          ? reconcilePool(config, fetcher, now, index, deadline)
          : collectBaseline(config, fetcher, now, deadline);
      void refresh
        .then((value) => {
          const nextSample = samplePool(config, value, undefined, flow);
          remainingTimeout(deadline);
          // A slow attempt cannot make an already expired inventory current.
          if (now() < value.observedAt || now() - value.observedAt > BITCOIN_POOL_REFRESH_MS) {
            throw new UpstreamError('timeout');
          }
          flow.observe(value.entries.keys(), value.observedAt);
          index = value;
          sample = nextSample;
          lastFailure = null;
        })
        .catch((error: unknown) => {
          flow.invalidate();
          sample = null;
          const kind = error instanceof UpstreamError ? error.kind : 'invalid';
          const exceededAdditions = error instanceof AdditionBudgetError;
          if (
            phase === 'incremental' &&
            error instanceof PoolRpcError &&
            error.unsupportedIncremental
          )
            incrementalDisabledUntil = now() + BITCOIN_POOL_INCREMENTAL_COOLDOWN_MS;
          // An RPC refusal/race or excessive additions must not trap a broken incremental
          // path until the ten-minute resync. Recover with a full baseline at the
          // next scheduled attempt; unsupported methods pause incrementals for five minutes.
          // Transport/response-size failures can still reuse immutable metadata privately.
          if (
            phase !== 'incremental' ||
            !index ||
            now() < index.baselineAt ||
            now() - index.baselineAt >= BITCOIN_POOL_RESYNC_MS ||
            kind === 'rpc' ||
            exceededAdditions ||
            kind === 'invalid' ||
            kind === 'wrong-chain'
          ) {
            index = null;
            excludedSample = undefined;
          }
          const failure = `${phase}:${kind}:${exceededAdditions ? 'addition-budget' : 'request'}`;
          if (failure !== lastFailure) {
            // Only fixed categories are logged: never a URL, RPC body, message or stack.
            console.warn(
              `[bitcoin-pool] collection failed phase=${phase} kind=${kind}${exceededAdditions ? ` newEntries=${error.newEntries} budget=${BITCOIN_POOL_MAX_ADDITIONS}` : ''}`,
            );
            lastFailure = failure;
          }
        })
        .finally(() => {
          pending = false;
          nextAttemptAt = now() + BITCOIN_POOL_REFRESH_MS;
        });
    }
    if (!sample || !index || !excludedIds) return sample;
    if (excludedSample?.index === index && excludedSample.excludedIds === excludedIds)
      return excludedSample.sample;
    excludedSample = { index, excludedIds, sample: samplePool(config, index, excludedIds, flow) };
    return excludedSample.sample;
  };
}
