import { describe, expect, it } from 'vitest';
import { snapshotSchema, type EventFlow, type PoolFlow, type Snapshot } from '../../shared/model';
import { advanceProviderFlowArrival, providerFlowDisplay } from '../../src/lib/poolFlowDisplay';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const inventory = (at = NOW - 2_000): PoolFlow => ({
  source: 'Inventaire périodique',
  method: 'getrawmempool',
  state: 'ready',
  observedAt: at,
  inventoryCount: 100,
  history: [
    {
      fromObservedAt: at - 10_000,
      observedAt: at,
      previousCount: 100,
      currentCount: 100,
      enteredCount: 30,
      disappearedCount: 30,
      outsideSampleEnteredCount: 25,
    },
  ],
});
const events = (at = NOW, overrides: Partial<EventFlow> = {}): EventFlow => ({
  source: 'Flux du fournisseur',
  method: 'mempool-txids',
  state: 'live',
  epoch: 1,
  startedAt: at - 3_000,
  observedAt: at,
  lastMessageAt: at,
  history: [
    { fromObservedAt: at - 3_000, observedAt: at, enteredCount: 18, outsideSampleEnteredCount: 12 },
  ],
  ...overrides,
});
function snapshot(
  eventFlow: EventFlow | null = events(),
  poolFlow: PoolFlow | null = inventory(),
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée',
    observedAt: NOW + 30_000,
    coverage: 'Deux sources de flux distinctes.',
    pendingCount: 100,
    feeRate: 1,
    feeUnit: 'sat/vB',
    transactions: [],
    blocks: [],
    inclusions: [],
    poolFlow,
    eventFlow,
    ...overrides,
  });
}
const warming = (): EventFlow => events(NOW - 3_000, { state: 'warming', history: [] });

describe('event flow display and explicitly dated periodic fallback', () => {
  it('prefers a valid event batch and retains its own date and actual interval rate', () => {
    const display = providerFlowDisplay(snapshot(), NOW);
    expect(display).toMatchObject({
      kind: 'events',
      value: '+18',
      label: 'Ajouts observés',
      interval: 'sur 3 s',
      average: '6 ajouts/s · moy. observée',
      observedAt: NOW,
      kindLabel: 'Flux suivi · événements',
    });
    expect(display.note).toContain('vue');
    expect(display.note).not.toContain('inventaires complets');
  });
  it('does not describe Ethereum notifications as a complete inventory or new world-wide arrivals', () => {
    const source = snapshot(events(NOW, { method: 'newPendingTransactions' }), null, {
      chain: 'ethereum',
      feeUnit: 'Gwei',
    });
    const display = providerFlowDisplay(source, NOW);
    expect(display.label).toBe('Notifications pending');
    expect(display.average).toBe('6 notif./s · moy. observée');
    expect(display.note).toContain('promotion depuis queued');
    expect(display.note).toContain('réémission');
    expect(display.note).toContain('ne mesure pas les nouvelles entrées');
  });
  it('averages actual event interval durations rather than dividing by the chart window', () => {
    const flow = events();
    flow.startedAt = NOW - 9_000;
    flow.history = [
      {
        fromObservedAt: NOW - 9_000,
        observedAt: NOW - 6_000,
        enteredCount: 18,
        outsideSampleEnteredCount: 12,
      },
      {
        fromObservedAt: NOW - 6_000,
        observedAt: NOW,
        enteredCount: 24,
        outsideSampleEnteredCount: 12,
      },
    ];
    expect(providerFlowDisplay(snapshot(flow), NOW).average).toBe('4,7 ajouts/s · moy. observée');
  });
  it('falls back to the separately dated inventory for interrupted, connecting or limited events', () => {
    for (const state of ['connecting', 'interrupted', 'limited'] as const) {
      const display = providerFlowDisplay(snapshot(events(NOW, { state })), NOW);
      expect(display).toMatchObject({
        kind: 'inventory',
        value: '+30',
        observedAt: NOW - 2_000,
      });
      expect(display.note).toContain('Secours par relevé périodique');
      expect(display.kindLabel).toBe(
        `Relevé périodique · ${state === 'connecting' ? 'connexion' : state === 'limited' ? 'limite atteinte' : 'flux interrompu'}`,
      );
      expect(display.note).toContain(
        state === 'connecting' ? 'Connexion' : state === 'limited' ? 'Limite' : 'interrompu',
      );
    }
  });
  it('does not invent zero before the first batch or when no usable transport remains', () => {
    for (const state of ['disabled', 'connecting', 'warming', 'interrupted', 'limited'] as const) {
      const display = providerFlowDisplay(snapshot(events(NOW, { state, history: [] }), null), NOW);
      expect(display.value).toBe('—');
      expect(display.kind).toBe('none');
      expect(display.history).toHaveLength(0);
    }
  });
  it('rejects future or expired event clocks independently of a fresh HTTP snapshot', () => {
    for (const [flow, now] of [
      [events(NOW + 1), NOW],
      [events(), NOW + 15_001],
      [events(NOW, { lastMessageAt: NOW + 1 }), NOW],
      [events(NOW, { lastMessageAt: NOW - 30_001 }), NOW],
    ] as const)
      expect(providerFlowDisplay(snapshot(flow), now).kind).toBe('inventory');
    expect(
      providerFlowDisplay(snapshot(events(), null, { observedAt: NOW - 6_000 }), NOW).kind,
    ).toBe('events');
  });
});

describe('independent stream clocks on stale block snapshots', () => {
  it('keeps dated live events, rejects unavailable data and retains the old inventory restriction', () => {
    const source = snapshot(events(), inventory(), { status: 'stale' });
    const display = providerFlowDisplay(source, NOW);
    expect(display).toMatchObject({ kind: 'events', value: '+18' });
    expect(display.note).toContain('Relevé des blocs ancien ; notifications datées indépendamment');
    expect(providerFlowDisplay({ ...source, status: 'unavailable' }, NOW).value).toBe('—');
    expect(providerFlowDisplay({ ...source, eventFlow: null }, NOW).state).toBe('stale');
  });
});

describe('collective event groups without replay across transports and epochs', () => {
  it('baselines an initial live batch but allows the first batch after warming', () => {
    expect(advanceProviderFlowArrival(null, snapshot(), NOW).arrival).toBeNull();
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    expect(advanceProviderFlowArrival(baseline, snapshot(), NOW).arrival).toMatchObject({
      kind: 'events',
      count: 12,
    });
  });
  it('freezes a batch partition and never replays a new HTTP snapshot or heartbeat', () => {
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    const batch = advanceProviderFlowArrival(baseline, snapshot(), NOW);
    const changed = events(NOW, { lastMessageAt: NOW + 100 });
    changed.history[0]!.outsideSampleEnteredCount = 2;
    expect(advanceProviderFlowArrival(batch, snapshot(changed), NOW + 100)).toBe(batch);
    expect(
      advanceProviderFlowArrival({ ...batch, arrival: null }, snapshot(), NOW).arrival,
    ).toBeNull();
  });
  it('keeps inventory markers while events lead and does not replay a fallback or restored batch', () => {
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    const batch = advanceProviderFlowArrival(baseline, snapshot(), NOW);
    const fallback = advanceProviderFlowArrival(
      batch,
      snapshot(events(NOW, { state: 'interrupted' })),
      NOW,
    );
    expect(fallback.arrival).toBeNull();
    const newInventory = advanceProviderFlowArrival(
      fallback,
      snapshot(events(NOW, { state: 'interrupted' }), inventory(NOW + 3_000)),
      NOW + 3_000,
    );
    expect(newInventory.arrival).toMatchObject({ kind: 'inventory', count: 25 });
    expect(advanceProviderFlowArrival(newInventory, snapshot(), NOW + 3_000).arrival).toBeNull();
  });
  it('baselines an unknown live epoch, then allows its next batch without replaying the prior connection', () => {
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    const batch = advanceProviderFlowArrival(baseline, snapshot(), NOW);
    const reconnected = advanceProviderFlowArrival(
      batch,
      snapshot(events(NOW + 3_000, { epoch: 2 })),
      NOW + 3_000,
    );
    expect(reconnected.arrival).toBeNull();
    expect(
      advanceProviderFlowArrival(
        reconnected,
        snapshot(events(NOW + 6_000, { epoch: 2 })),
        NOW + 6_000,
      ).arrival?.count,
    ).toBe(12);
  });
  it('preserves the event marker across a temporary null and never turns an unknown partition into zero', () => {
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    const absent = advanceProviderFlowArrival(baseline, snapshot(null), NOW);
    expect(advanceProviderFlowArrival(absent, snapshot(), NOW).arrival?.count).toBe(12);
    const unknown = events();
    unknown.history[0]!.outsideSampleEnteredCount = null;
    const partition = advanceProviderFlowArrival(baseline, snapshot(unknown), NOW);
    expect(partition.arrival).toBeNull();
    expect(advanceProviderFlowArrival(partition, snapshot(), NOW).arrival).toBeNull();
  });
  it('does not let an invalid future clock poison the established event baseline', () => {
    const baseline = advanceProviderFlowArrival(null, snapshot(warming()), NOW - 3_000);
    const future = advanceProviderFlowArrival(baseline, snapshot(events(NOW + 10_000)), NOW);
    expect(future.eventObservedAt).toBe(baseline.eventObservedAt);
    expect(advanceProviderFlowArrival(future, snapshot(), NOW).arrival?.count).toBe(12);
  });
});
