import { describe, expect, it } from 'vitest';
import { snapshotSchema, type PoolFlow, type Snapshot } from '../../shared/model';
import { advanceProviderFlowArrival, poolFlowDisplay } from '../../src/lib/poolFlowDisplay';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const ready = (at = NOW, outside: number | null = 30): PoolFlow => ({
  source: 'Inventaire complet contrôlé',
  method: 'getrawmempool',
  observedAt: at,
  inventoryCount: 110,
  state: 'ready',
  history: [
    {
      fromObservedAt: at - 10_000,
      observedAt: at,
      previousCount: 100,
      currentCount: 110,
      enteredCount: 50,
      disappearedCount: 40,
      outsideSampleEnteredCount: outside,
    },
  ],
});
function snapshot(flow: PoolFlow | null = ready(), overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée',
    observedAt: NOW + 30_000,
    coverage: 'Inventaire complet, scène partielle.',
    pendingCount: 110,
    feeRate: 1,
    feeUnit: 'sat/vB',
    transactions: [],
    blocks: [],
    inclusions: [],
    poolFlow: flow,
    ...overrides,
  });
}

describe('display of observed provider inventory flow', () => {
  it('distinguishes gross entrances from the net inventory change', () => {
    const display = poolFlowDisplay(snapshot(), NOW);
    expect(display).toMatchObject({
      state: 'ready',
      value: '+50',
      interval: 'sur 10 s',
      average: '5 tx/s · moy. observée',
    });
    expect(display.note).toContain('40 disparitions');
    expect(display.note).toContain('pas la variation nette');
    expect(display.note).toContain('ni une mesure mondiale');
  });
  it('uses actual measured durations even when an interval starts before the chart window', () => {
    const flow = ready();
    flow.history[0] = { ...flow.history[0]!, fromObservedAt: NOW - 90_000 };
    const display = poolFlowDisplay(snapshot(flow), NOW);
    expect(display.interval).toBe('sur 90 s');
    expect(display.average).toBe('0,6 tx/s · moy. observée');
    expect(display.note).toContain('90 s observées');
  });
  it('shows a baseline as unknown rather than zero, and a measured zero as zero', () => {
    const warming: PoolFlow = { ...ready(), state: 'warming', history: [] };
    expect(poolFlowDisplay(snapshot(warming), NOW)).toMatchObject({ state: 'warming', value: '—' });
    const zero = ready();
    zero.inventoryCount = 100;
    zero.history[0] = {
      ...zero.history[0]!,
      currentCount: 100,
      enteredCount: 0,
      disappearedCount: 0,
      outsideSampleEnteredCount: 0,
    };
    expect(poolFlowDisplay(snapshot(zero), NOW)).toMatchObject({
      state: 'ready',
      value: '+0',
      average: '0 tx/s · moy. observée',
    });
  });
  it('does not report a current rate for missing, stale, future, expired or demonstration data', () => {
    expect(poolFlowDisplay(snapshot(null), NOW).state).toBe('unavailable');
    expect(poolFlowDisplay(snapshot(ready(), { status: 'stale' }), NOW).state).toBe('stale');
    expect(poolFlowDisplay(snapshot(ready(NOW + 1)), NOW).state).toBe('stale');
    expect(poolFlowDisplay(snapshot(), NOW + 90_001).state).toBe('stale');
    expect(poolFlowDisplay({ ...snapshot(), mode: 'demo' }, NOW).state).toBe('unavailable');
  });
});

describe('one collective lateral arrival per new measured interval', () => {
  it('establishes the initial baseline and never replays an identical interval', () => {
    const initial = advanceProviderFlowArrival(null, snapshot(), NOW);
    expect(initial.arrival).toBeNull();
    const source = snapshot(ready(NOW + 10_000));
    const entered = advanceProviderFlowArrival(initial, source, NOW + 10_000);
    expect(entered.arrival?.count).toBe(30);
    const changedPartition = { ...source, poolFlow: ready(NOW + 10_000, 4) };
    expect(advanceProviderFlowArrival(entered, changedPartition, NOW + 10_000)).toBe(entered);
    const finished = { ...entered, arrival: null };
    expect(advanceProviderFlowArrival(finished, source, NOW + 10_000).arrival).toBeNull();
  });
  it('preserves the marker across temporary absent data and consumes the next interval once', () => {
    const initial = advanceProviderFlowArrival(null, snapshot(), NOW);
    const absent = advanceProviderFlowArrival(initial, snapshot(null), NOW + 1_000);
    expect(absent.context).toBe(initial.context);
    expect(absent.observedAt).toBe(initial.observedAt);
    const next = advanceProviderFlowArrival(absent, snapshot(ready(NOW + 10_000)), NOW + 10_000);
    expect(next.arrival?.count).toBe(30);
  });
  it('keeps an unknown outside-sample partition distinct from zero', () => {
    const initial = advanceProviderFlowArrival(null, snapshot(), NOW);
    for (const outside of [null, 0]) {
      const next = advanceProviderFlowArrival(
        initial,
        snapshot(ready(NOW + 10_000, outside)),
        NOW + 10_000,
      );
      expect(next.arrival).toBeNull();
      expect(next.observedAt).toBe(NOW + 10_000);
    }
  });
  it('resets on warming, chain, mode and provider changes without replaying existing history', () => {
    const initial = advanceProviderFlowArrival(null, snapshot(), NOW);
    const entered = advanceProviderFlowArrival(
      initial,
      snapshot(ready(NOW + 10_000)),
      NOW + 10_000,
    );
    expect(entered.arrival).not.toBeNull();
    for (const changed of [
      snapshot({ ...ready(NOW + 20_000), source: 'Autre fournisseur' }),
      snapshot({ ...ready(NOW + 20_000), state: 'warming', history: [] }),
      { ...snapshot(), chain: 'ethereum' as const },
      { ...snapshot(), mode: 'demo' as const },
    ])
      expect(advanceProviderFlowArrival(entered, changed, NOW + 20_000).arrival).toBeNull();
  });
  it('clears a visible cohort for stale data without advancing its trusted marker', () => {
    const initial = advanceProviderFlowArrival(null, snapshot(), NOW);
    const entered = advanceProviderFlowArrival(
      initial,
      snapshot(ready(NOW + 10_000)),
      NOW + 10_000,
    );
    const stale = advanceProviderFlowArrival(
      entered,
      snapshot(ready(NOW + 20_000), { status: 'stale' }),
      NOW + 20_000,
    );
    expect(stale.arrival).toBeNull();
    expect(stale.observedAt).toBe(entered.observedAt);
    expect(
      advanceProviderFlowArrival(stale, snapshot(ready(NOW + 20_000)), NOW + 20_000).arrival?.count,
    ).toBe(30);
  });
});
