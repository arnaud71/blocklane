import {
  MAX_POOL_FLOW_POINTS,
  POOL_FLOW_MAX_INTERVAL_MS,
  POOL_FLOW_WINDOW_MS,
  type PoolFlow,
  type PoolFlowPoint,
} from '../../shared/model.js';

interface PoolFlowTrackerOptions {
  source: string;
  method: PoolFlow['method'];
  maxTransactions: number;
}

/** Private ID sets stay on the server; only small dated counts cross the API. */
export function createPoolFlowTracker({ source, method, maxTransactions }: PoolFlowTrackerOptions) {
  const limit = Math.min(method === 'getrawmempool' ? 100_000 : 50_000, maxTransactions);
  const pattern = method === 'getrawmempool' ? /^[a-f0-9]{64}$/ : /^0x[a-f0-9]{64}$/;
  let previous: Set<string> | null = null;
  let observedAt = 0;
  let history: PoolFlowPoint[] = [];
  let latestEntered: Set<string> | null = null;

  function invalidate() {
    previous = null;
    observedAt = 0;
    history = [];
    latestEntered = null;
  }

  function observe(ids: Iterable<string>, time: number) {
    if (!Number.isSafeInteger(time) || time < 0 || !Number.isSafeInteger(limit) || limit < 0) {
      invalidate();
      return;
    }
    const current = new Set<string>();
    let received = 0;
    for (const value of ids) {
      // Bound work even if a caller accidentally supplies many duplicate identifiers.
      if (++received > limit || typeof value !== 'string' || !pattern.test(value.toLowerCase())) {
        invalidate();
        return;
      }
      current.add(value.toLowerCase());
    }
    if (previous && time > observedAt && time - observedAt <= POOL_FLOW_MAX_INTERVAL_MS) {
      const entered = new Set<string>();
      let disappearedCount = 0;
      for (const id of current) if (!previous.has(id)) entered.add(id);
      for (const id of previous) if (!current.has(id)) disappearedCount++;
      history.push({
        fromObservedAt: observedAt,
        observedAt: time,
        previousCount: previous.size,
        currentCount: current.size,
        enteredCount: entered.size,
        disappearedCount,
        outsideSampleEnteredCount: null,
      });
      history = history
        .filter((point) => point.observedAt > time - POOL_FLOW_WINDOW_MS)
        .slice(-MAX_POOL_FLOW_POINTS);
      latestEntered = entered;
    } else {
      // First success or discontinuity is a baseline, never a burst or a measured zero.
      history = [];
      latestEntered = null;
    }
    previous = current;
    observedAt = time;
  }

  function forSample(
    selectedIds: ReadonlySet<string>,
    expectedObservedAt: number,
  ): PoolFlow | null {
    if (!previous || expectedObservedAt !== observedAt) return null;
    const latest = history.at(-1);
    if (latest && latestEntered) {
      const selected = new Set([...selectedIds].map((id) => id.toLowerCase()));
      let outside = 0;
      for (const id of latestEntered) if (!selected.has(id)) outside++;
      latest.outsideSampleEnteredCount = outside;
      // Freeze the split at first publication and release this interval's private IDs.
      latestEntered = null;
    }
    return {
      source,
      method,
      observedAt,
      inventoryCount: previous.size,
      state: history.length ? 'ready' : 'warming',
      history: history.map((point) => ({ ...point })),
    };
  }

  return { observe, invalidate, forSample };
}
