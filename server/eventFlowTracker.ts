import { randomInt } from 'node:crypto';
import {
  EVENT_FLOW_PUBLISH_MS,
  EVENT_FLOW_SILENCE_MS,
  EVENT_FLOW_WINDOW_MS,
  MAX_EVENT_FLOW_IDS,
  MAX_EVENT_FLOW_INTERVAL_MS,
  MAX_EVENT_FLOW_POINTS,
  type EventFlow,
} from '../shared/model.js';

interface EventFlowTrackerOptions {
  source: string;
  method: EventFlow['method'];
  now?: () => number;
  /** Deterministic tests only; production periods start from an opaque random seed. */
  epochSeed?: number;
}

type StoppedState = 'interrupted' | 'limited' | 'disabled';
type FlowPoint = EventFlow['history'][number];

/** A bounded, connection-local measurement. Private identifiers never cross the API. */
export function createEventFlowTracker({
  source,
  method,
  now = Date.now,
  epochSeed = randomInt(1, 2 ** 48),
}: EventFlowTrackerOptions) {
  if (!source.trim() || source.length > 100) throw new TypeError('Invalid event flow source');
  if (
    method !== 'mempool-txids' &&
    method !== 'mempool-transactions' &&
    method !== 'newPendingTransactions'
  )
    throw new TypeError('Invalid event flow method');
  if (!Number.isSafeInteger(epochSeed) || epochSeed < 0 || epochSeed >= Number.MAX_SAFE_INTEGER)
    throw new TypeError('Invalid event flow epoch seed');

  const pattern = method !== 'newPendingTransactions' ? /^[a-f0-9]{64}$/ : /^0x[a-f0-9]{64}$/;
  const initialTime = now();
  let lastClock = Number.isSafeInteger(initialTime) && initialTime >= 0 ? initialTime : 0;
  let state: EventFlow['state'] = 'disabled';
  let epoch = epochSeed;
  let observedAt = lastClock;
  let startedAt: number | null = null;
  let lastMessageAt: number | null = null;
  let windowStartedAt: number | null = null;
  let history: FlowPoint[] = [];
  const seen = new Map<string, number>();
  const entered = new Set<string>();

  function clearData() {
    windowStartedAt = null;
    history = [];
    seen.clear();
    entered.clear();
  }

  function deactivate(nextState: StoppedState, time: number) {
    if (state !== nextState) observedAt = time;
    state = nextState;
    clearData();
  }

  function clock(): number | null {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) {
      deactivate('interrupted', lastClock);
      return null;
    }
    if (time < lastClock) {
      // End the old period at its last valid date. A subsequent handshake may
      // establish a new period under the corrected clock.
      deactivate('interrupted', lastClock);
      lastClock = time;
      return null;
    }
    lastClock = time;
    return time;
  }

  function active() {
    return state === 'warming' || state === 'live';
  }

  function stillConnected(time: number) {
    if (lastMessageAt === null || time - lastMessageAt > EVENT_FLOW_SILENCE_MS) {
      deactivate('interrupted', time);
      return false;
    }
    return true;
  }

  function begin(time: number, preserveLastMessage: boolean) {
    if (epoch >= Number.MAX_SAFE_INTEGER) {
      deactivate('limited', time);
      return;
    }
    epoch += 1;
    clearData();
    state = 'warming';
    startedAt = time;
    observedAt = time;
    windowStartedAt = time;
    if (!preserveLastMessage) lastMessageAt = time;
  }

  function connecting() {
    const time = clock();
    if (time === null) return;
    if (state !== 'connecting') observedAt = time;
    state = 'connecting';
    clearData();
    startedAt = null;
    lastMessageAt = null;
  }

  function start() {
    const time = clock();
    if (time !== null) begin(time, false);
  }

  function expireSeen(time: number) {
    // Refreshing duplicate entries below keeps the map ordered by last sighting.
    for (const [id, lastSeenAt] of seen) {
      if (lastSeenAt > time - EVENT_FLOW_WINDOW_MS) break;
      seen.delete(id);
    }
  }

  function receive(ids: readonly string[]): boolean {
    const time = clock();
    if (time === null || !active() || !stillConnected(time)) return false;
    if (!Array.isArray(ids) || ids.length > MAX_EVENT_FLOW_IDS) {
      deactivate('limited', time);
      return false;
    }
    expireSeen(time);
    for (const value of ids) {
      if (typeof value !== 'string' || !pattern.test(value.toLowerCase())) {
        deactivate('limited', time);
        return false;
      }
      const id = value.toLowerCase();
      if (seen.has(id)) {
        seen.delete(id);
      } else {
        if (seen.size >= MAX_EVENT_FLOW_IDS || entered.size >= MAX_EVENT_FLOW_IDS) {
          deactivate('limited', time);
          return false;
        }
        entered.add(id);
      }
      seen.set(id, time);
    }
    lastMessageAt = time;
    return true;
  }

  function heartbeat() {
    const time = clock();
    if (time !== null && active() && stillConnected(time)) lastMessageAt = time;
  }

  function stop(nextState: StoppedState) {
    const time = clock();
    if (time !== null) deactivate(nextState, time);
  }

  function outsideSample(selectedIds: ReadonlySet<string>): number | null {
    // The normal caller supplies the bounded validated sample. A malformed
    // selection cannot turn unknown membership into a fabricated zero.
    if (selectedIds.size > MAX_EVENT_FLOW_IDS) return null;
    const selected = new Set<string>();
    for (const value of selectedIds) {
      if (typeof value !== 'string' || !pattern.test(value.toLowerCase())) return null;
      selected.add(value.toLowerCase());
    }
    let count = 0;
    for (const id of entered) if (!selected.has(id)) count++;
    return count;
  }

  function read(selectedIds: ReadonlySet<string>): EventFlow {
    const time = clock();
    if (time !== null && active() && stillConnected(time) && windowStartedAt !== null) {
      const interval = time - windowStartedAt;
      if (interval > MAX_EVENT_FLOW_INTERVAL_MS) {
        // A client returning after a gap gets a new baseline, never an old burst.
        // Keep the transport's real last message date instead of refreshing it.
        begin(time, true);
      } else if (interval >= EVENT_FLOW_PUBLISH_MS) {
        history.push({
          fromObservedAt: windowStartedAt,
          observedAt: time,
          enteredCount: entered.size,
          outsideSampleEnteredCount: outsideSample(selectedIds),
        });
        history = history
          .filter((point) => point.observedAt > time - EVENT_FLOW_WINDOW_MS)
          .slice(-MAX_EVENT_FLOW_POINTS);
        entered.clear();
        windowStartedAt = time;
        observedAt = time;
        state = 'live';
      }
    }
    return {
      source,
      method,
      state,
      epoch,
      startedAt,
      observedAt,
      lastMessageAt,
      history: history.map((point) => ({ ...point })),
    };
  }

  return { connecting, start, receive, heartbeat, stop, read };
}
