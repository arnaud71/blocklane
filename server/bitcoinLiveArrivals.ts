import {
  BITCOIN_ARRIVALS_MAX_AGE_MS,
  BITCOIN_ARRIVAL_SAMPLE_LIMIT,
  MAX_EVENT_FLOW_IDS,
  type Tx,
} from '../shared/model.js';

export const BITCOIN_LIVE_ARRIVAL_TTL_MS = BITCOIN_ARRIVALS_MAX_AGE_MS;

export interface BitcoinArrivalSample {
  source: string;
  /** Receipt of the latest validated consecutive delta, not first broadcast of any transaction. */
  observedAt: number;
  transactions: readonly Tx[];
}

interface BitcoinArrivalDelta {
  added: unknown[];
  removed: readonly string[];
  mined: readonly string[];
  replaced?: unknown;
}

interface BitcoinLiveArrivalsOptions {
  source: string;
  now?: () => number;
}

const hashPattern = /^[a-f\d]{64}$/i;
const MAX_SATOSHIS = 2_100_000_000_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && hashPattern.test(value) ? value.toLowerCase() : null;
}

function safeInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** Keep only the fields needed for real pending passengers; never retain inputs or scripts. */
function compactTransaction(raw: unknown): Tx | null {
  const transaction = record(raw);
  if (!transaction) return null;
  const id = identifier(transaction.txid);
  if (id === null || !safeInteger(transaction.fee, MAX_SATOSHIS)) return null;
  const size = transaction.vsize;
  if (
    size !== undefined &&
    (typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 1 ||
      size > 1_000_000 ||
      !Number.isInteger(size * 4))
  )
    return null;
  const weight = transaction.weight;
  if (weight !== undefined && (!safeInteger(weight, 4_000_000) || weight < 4)) return null;
  if (size === undefined && weight === undefined) return null;
  // mempool's own stripTransaction uses weight/4, including quarter-byte virtual
  // sizes. A policy-adjusted vsize may be larger, never smaller than the weight.
  const actualSize = typeof weight === 'number' ? weight / 4 : (size as number);
  if (typeof size === 'number' && size < actualSize) return null;
  return {
    id,
    chain: 'bitcoin',
    feeRate: transaction.fee / actualSize,
    size: actualSize,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant non fourni',
  };
}

/** A compact reserve of arrivals from an already validated, continuous provider stream. */
export function createBitcoinLiveArrivals({ source, now = Date.now }: BitcoinLiveArrivalsOptions) {
  if (!source.trim() || source.length > 100) throw new TypeError('Invalid Bitcoin arrival source');
  let observedAt: number | null = null;
  let lastClock: number | null = null;
  let transactions = new Map<string, Tx>();

  function reset() {
    observedAt = null;
    transactions.clear();
    lastClock = null;
  }

  function clock(): number | null {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || (lastClock !== null && time < lastClock)) {
      reset();
      return null;
    }
    lastClock = time;
    return time;
  }

  function reject(): false {
    reset();
    return false;
  }

  function receive(delta: BitcoinArrivalDelta, time: number): boolean {
    const currentTime = clock();
    if (
      currentTime === null ||
      !Number.isSafeInteger(time) ||
      time < 0 ||
      time > currentTime ||
      currentTime - time > BITCOIN_LIVE_ARRIVAL_TTL_MS ||
      (observedAt !== null && time < observedAt)
    )
      return reject();
    if (
      !delta ||
      !Array.isArray(delta.added) ||
      !Array.isArray(delta.removed) ||
      !Array.isArray(delta.mined)
    )
      return reject();
    const replaced = delta.replaced === undefined ? [] : delta.replaced;
    if (
      !Array.isArray(replaced) ||
      delta.added.length + delta.removed.length + delta.mined.length + replaced.length * 2 >
        MAX_EVENT_FLOW_IDS
    )
      return reject();
    const withdrawn = new Set<string>();
    for (const rawId of [...delta.removed, ...delta.mined]) {
      const id = identifier(rawId);
      if (id === null) return reject();
      withdrawn.add(id);
    }
    for (const rawReplacement of replaced) {
      const replacement = record(rawReplacement);
      const id = identifier(replacement?.replaced);
      // Full mempool deltas use a transaction object; the ID-only variant uses
      // a string. Neither variant supplies enough evidence to add it here.
      const by = identifier(
        typeof replacement?.by === 'string' ? replacement.by : record(replacement?.by)?.txid,
      );
      if (id === null || by === null) return reject();
      withdrawn.add(id);
    }
    const next = new Map(
      observedAt !== null && currentTime - observedAt <= BITCOIN_LIVE_ARRIVAL_TTL_MS
        ? transactions
        : [],
    );
    for (const id of withdrawn) next.delete(id);
    for (const rawTransaction of delta.added) {
      const transaction = compactTransaction(rawTransaction);
      if (transaction === null) return reject();
      if (withdrawn.has(transaction.id)) continue;
      // Updating retained metadata preserves its original receipt order.
      next.set(transaction.id, transaction);
      if (next.size > BITCOIN_ARRIVAL_SAMPLE_LIMIT) next.delete(next.keys().next().value!);
    }
    transactions = next;
    observedAt = time;
    return true;
  }

  function read(): BitcoinArrivalSample | null {
    const time = clock();
    if (time === null || observedAt === null) return null;
    if (time < observedAt || time - observedAt > BITCOIN_LIVE_ARRIVAL_TTL_MS) {
      reset();
      return null;
    }
    return {
      source,
      observedAt,
      transactions: [...transactions.values()].reverse().map((transaction) => ({ ...transaction })),
    };
  }

  return { reset, receive, read };
}
