import { describe, expect, it } from 'vitest';
import { eventFlowSchema, snapshotSchema, type EventFlow } from '../../shared/model.js';
import { liveSnapshot, now } from './fixtures.js';

export function observedEvents(): EventFlow {
  return {
    source: 'Flux contrôlé',
    method: 'mempool-txids',
    state: 'live',
    epoch: 1,
    startedAt: now - 3_000,
    observedAt: now,
    lastMessageAt: now,
    history: [
      {
        fromObservedAt: now - 3_000,
        observedAt: now,
        enteredCount: 7,
        outsideSampleEnteredCount: 5,
      },
    ],
  };
}

describe('independent event stream contract', () => {
  it('allows separate observation clocks without renewing the age of a block snapshot', () => {
    const snapshot = liveSnapshot('bitcoin', now - 1_000);
    const result = snapshotSchema.parse({ ...snapshot, eventFlow: observedEvents() });
    expect(result.observedAt).toBe(now - 1_000);
    expect(result.eventFlow?.observedAt).toBe(now);
    expect(result.poolFlow ?? null).toBeNull();
  });

  it('refuses cross-chain, demo and unavailable event contexts', () => {
    const base = liveSnapshot('bitcoin', now);
    for (const patch of [
      { eventFlow: { ...observedEvents(), method: 'newPendingTransactions' } },
      { mode: 'demo', eventFlow: observedEvents() },
      { status: 'unavailable', transactions: [], blocks: [], eventFlow: observedEvents() },
    ])
      expect(snapshotSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('rejects impossible quantities, gaps, timestamps and unbounded histories', () => {
    const flow = observedEvents();
    const point = flow.history[0]!;
    for (const invalid of [
      { ...flow, history: [] },
      { ...flow, epoch: 0 },
      { ...flow, lastMessageAt: null },
      { ...flow, startedAt: null },
      { ...flow, startedAt: now + 1 },
      { ...flow, history: [{ ...point, enteredCount: 20_001 }] },
      { ...flow, history: [{ ...point, enteredCount: -1 }] },
      { ...flow, history: [{ ...point, outsideSampleEnteredCount: 8 }] },
      { ...flow, history: [{ ...point, fromObservedAt: now - 15_001 }] },
      { ...flow, history: [{ ...point, fromObservedAt: now - 2_999 }] },
      { ...flow, history: Array(13).fill(point) },
      { ...flow, history: [{ ...point, observedAt: now - 1 }] },
    ])
      expect(eventFlowSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps inactive states and a new connection distinct from a measured zero', () => {
    const flow = observedEvents();
    for (const state of ['disabled', 'connecting', 'interrupted', 'limited'] as const)
      expect(eventFlowSchema.safeParse({ ...flow, state, history: [] }).success).toBe(true);
    expect(eventFlowSchema.safeParse({ ...flow, state: 'warming', history: [] }).success).toBe(
      true,
    );
    expect(
      eventFlowSchema.safeParse({
        ...flow,
        history: [{ ...flow.history[0]!, enteredCount: 0, outsideSampleEnteredCount: 0 }],
      }).success,
    ).toBe(true);
  });
});
