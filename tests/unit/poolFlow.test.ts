import { describe, expect, it } from 'vitest';
import { createPoolFlowTracker } from '../../server/adapters/poolFlow.js';
import { poolFlowSchema, snapshotSchema } from '../../shared/model.js';
import { liveSnapshot, now } from './fixtures.js';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tracker = () =>
  createPoolFlowTracker({
    source: 'Nœud contrôlé',
    method: 'getrawmempool',
    maxTransactions: 100_000,
  });

describe('dated provider inventory flow', () => {
  it('starts with a baseline and counts gross entries even if net pool size is unchanged', () => {
    const flow = tracker();
    expect(flow.forSample(new Set(), now)).toBeNull();
    flow.observe([id(1), id(2)], now);
    expect(flow.forSample(new Set(), now)).toMatchObject({
      state: 'warming',
      inventoryCount: 2,
      history: [],
    });
    flow.observe([id(2), id(3)], now + 30_000);
    const measured = flow.forSample(new Set([id(3)]), now + 30_000)!;
    expect(measured.history).toEqual([
      {
        fromObservedAt: now,
        observedAt: now + 30_000,
        previousCount: 2,
        currentCount: 2,
        enteredCount: 1,
        disappearedCount: 1,
        outsideSampleEnteredCount: 0,
      },
    ]);
    expect(poolFlowSchema.safeParse(measured).success).toBe(true);
    expect(JSON.stringify(measured)).not.toContain(id(3));
  });

  it('freezes outside-sample counts at first publication without leaking mutable history', () => {
    const flow = tracker();
    flow.observe([], now);
    flow.observe([id(1), id(2)], now + 10_000);
    expect(flow.forSample(new Set(), now)).toBeNull();
    const first = flow.forSample(new Set([id(1)]), now + 10_000)!;
    first.history[0]!.outsideSampleEnteredCount = 99;
    expect(flow.forSample(new Set(), now + 10_000)!.history[0]!.outsideSampleEnteredCount).toBe(1);
  });

  it('distinguishes a measured zero from missing data, long gaps and clock resets', () => {
    const flow = tracker();
    flow.observe([id(1)], now);
    flow.observe([id(1)], now + 30_000);
    expect(flow.forSample(new Set(), now + 30_000)?.history[0]?.enteredCount).toBe(0);
    flow.observe([id(1), id(2)], now + 120_001);
    expect(flow.forSample(new Set(), now + 120_001)?.state).toBe('warming');
    flow.observe([id(1), id(2)], now + 120_000);
    expect(flow.forSample(new Set(), now + 120_000)?.state).toBe('warming');
    flow.invalidate();
    expect(flow.forSample(new Set(), now + 120_000)).toBeNull();
  });

  it('bounds both work and retained history, and rejects incomplete or malformed inventories', () => {
    const flow = tracker();
    for (let i = 0; i <= 30; i++) {
      flow.observe([id(i)], now + i * 1_000);
      flow.forSample(new Set(), now + i * 1_000);
    }
    const recent = flow.forSample(new Set(), now + 30_000)!;
    expect(recent.history).toHaveLength(12);
    expect(poolFlowSchema.safeParse(recent).success).toBe(true);
    flow.observe([id(1)], now + 90_000);
    const pruned = flow.forSample(new Set(), now + 90_000)!;
    expect(pruned.history).toHaveLength(1);
    const bounded = createPoolFlowTracker({
      source: 'Nœud',
      method: 'getrawmempool',
      maxTransactions: 1,
    });
    bounded.observe([id(1), id(2)], now);
    expect(bounded.forSample(new Set(), now)).toBeNull();
    bounded.observe(['invalid'], now);
    expect(bounded.forSample(new Set(), now)).toBeNull();
    bounded.observe([id(1), id(1)], now);
    expect(bounded.forSample(new Set(), now)).toBeNull();
  });

  it('does not invent an outside-sample split for an interval never published', () => {
    const flow = tracker();
    flow.observe([], now);
    flow.observe([id(1)], now + 10_000);
    flow.observe([id(1), id(2)], now + 20_000);
    expect(
      flow.forSample(new Set(), now + 20_000)!.history.map((p) => p.outsideSampleEnteredCount),
    ).toEqual([null, 1]);
  });
});

describe('pool flow public contract', () => {
  function measured() {
    const flow = tracker();
    flow.observe([], now - 30_000);
    flow.observe([id(1), id(2)], now);
    return flow.forSample(new Set([id(1)]), now)!;
  }

  it('accepts optional live evidence and refuses a cross-chain, future, demo or unavailable flow', () => {
    const base = liveSnapshot('bitcoin', now);
    const poolFlow = measured();
    expect(snapshotSchema.safeParse({ ...base, poolFlow }).success).toBe(true);
    for (const patch of [
      { poolFlow: { ...poolFlow, method: 'txpool_content' } },
      { observedAt: now - 1, poolFlow },
      { mode: 'demo', poolFlow },
      { status: 'unavailable', poolFlow, transactions: [], blocks: [] },
    ])
      expect(snapshotSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('rejects impossible counts, incomplete history, excessive windows and payloads', () => {
    const flow = measured();
    const point = flow.history[0]!;
    const mutations = [
      { ...flow, history: [{ ...point, enteredCount: 3 }] },
      { ...flow, history: [{ ...point, outsideSampleEnteredCount: 3 }] },
      { ...flow, history: [{ ...point, fromObservedAt: now - 90_001 }] },
      { ...flow, history: [{ ...point, observedAt: now - 1 }] },
      { ...flow, history: Array(13).fill(point) },
      { ...flow, state: 'warming' },
      { ...flow, inventoryCount: 3 },
      { ...flow, observedAt: Infinity },
      { ...flow, history: [{ ...point, disappearedCount: -1 }] },
      { ...flow, method: 'txpool_content', inventoryCount: 50_001 },
    ];
    for (const value of mutations) expect(poolFlowSchema.safeParse(value).success).toBe(false);
  });
});
