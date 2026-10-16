import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Block, type Snapshot, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  preparationDurationMs,
  reconcilePassengerMotion,
  reflowPassengerQueue,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import {
  ACTIVE_QUEUE_AREA,
  HISTORICAL_QUEUE_AREA,
  DEFAULT_QUEUE_LAYOUT,
  createQueueLayout,
  historicalQueueLayout,
  historicalQueuePosition,
  queuePosition,
  exitPlatformPoint,
  type QueueLayout,
} from '../../src/lib/streetGeometry';

const T0 = 1_700_000_000_000;
const id = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
function transaction(value: number, cap = '2000000000'): Tx {
  return {
    id: id(value),
    chain: 'ethereum',
    status: 'pending',
    feeRate: 2,
    size: 21_000,
    kind: 'transfer',
    value: '0.01 ETH',
    ethereum: {
      from: `0x${value.toString(16).padStart(40, '0')}`,
      nonce: '0',
      maxFeePerGasWei: cap,
      maxPriorityFeePerGasWei: '1000000000',
    },
  };
}
function block(height = 100): Block {
  return {
    height,
    hash: id(100_000 + height),
    timestamp: T0 / 1_000 + (height - 100) * 12,
    txCount: 1_000,
    used: 30_000_000,
    capacity: 60_000_000,
  };
}
function snapshot(
  transactions: Tx[],
  observedAt = T0,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  const parent = overrides.blocks?.[0] ?? block();
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée',
    observedAt,
    coverage: 'Échantillon et inventaire datés séparément.',
    pendingCount: null,
    feeRate: 3,
    feeUnit: 'Gwei',
    transactions,
    blocks: [parent],
    inclusions: [],
    ethereumProjection: {
      parentBlockHash: parent.hash,
      height: parent.height + 1,
      baseFeePerGasWei: '3000000000',
      source: 'calculated',
      observedAt,
    },
    ...overrides,
  });
}
function inventory(
  observedAt: number,
  pending: Tx[] = [],
  queued: Tx[] = [],
  absent: Tx[] = [],
): Partial<Snapshot> {
  return {
    sampling: {
      method: 'txpool_content',
      source: 'Inventaire contrôlé',
      observedAt,
      pendingCount: pending.length,
      queuedCount: queued.length,
    },
    poolObservation: {
      method: 'txpool_content',
      source: 'Inventaire contrôlé',
      observedAt,
      presentTransactionIds: pending.map(({ id }) => id),
      queuedTransactionIds: queued.map(({ id }) => id),
      absentTransactionIds: absent.map(({ id }) => id),
    },
  };
}
function pose(state: PassengerMotionState, identity: string) {
  const found = passengerFrame(state).passengers.find(({ tx }) => tx.id === identity);
  if (!found) throw new Error(`Voyageur absent : ${identity}`);
  return found;
}
function runFor(state: PassengerMotionState, ms: number) {
  let next = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, ms - elapsed));
  return next;
}
const settle = (state: PassengerMotionState) =>
  advancePassengerMotion(state, 0, { reducedMotion: true });
function inHistory(state: PassengerMotionState, identity: string) {
  const person = pose(state, identity);
  expect(person.queueZone).toBe('history');
  expect(person.y).toBeGreaterThanOrEqual(HISTORICAL_QUEUE_AREA.y);
  expect(person.y).toBeLessThanOrEqual(HISTORICAL_QUEUE_AREA.y + HISTORICAL_QUEUE_AREA.height);
  expect(person.x).toBeGreaterThanOrEqual(HISTORICAL_QUEUE_AREA.x);
  expect(person.x).toBeLessThanOrEqual(HISTORICAL_QUEUE_AREA.x + HISTORICAL_QUEUE_AREA.width);
}
function inActive(state: PassengerMotionState, identity: string) {
  const person = pose(state, identity);
  expect(person.queueZone).toBe('active');
  expect(person.y).toBeGreaterThanOrEqual(ACTIVE_QUEUE_AREA.y);
  expect(person.y).toBeLessThanOrEqual(ACTIVE_QUEUE_AREA.y + ACTIVE_QUEUE_AREA.height);
}
function safeRoute(state: PassengerMotionState, identity: string) {
  const person = pose(state, identity);
  if (!person.inWagon && !['boarding', 'exiting', 'preparing'].includes(person.phase))
    expect(person.x).toBeGreaterThanOrEqual(exitPlatformPoint('later').x);
}

describe('Separated historical observations on the outer quay', () => {
  it('exports distinct active and historical grids which reuse their own free places before overlap', () => {
    for (const scale of [0.5, 1, 4, 20]) {
      const active = createQueueLayout(scale);
      const historical = historicalQueueLayout(active);
      expect(active.rows).toBe(9);
      expect(historical.rows).toBe(3);
      expect(historical.columns).toBe(active.columns);
      for (const [layout, point] of [
        [active, (index: number) => queuePosition(index, active)],
        [historical, (index: number) => historicalQueuePosition(index, active)],
      ] as const) {
        expect(
          new Set(
            Array.from({ length: layout.capacity }, (_, index) => JSON.stringify(point(index))),
          ).size,
        ).toBe(layout.capacity);
        expect(point(layout.capacity)).toEqual(point(0));
        for (let index = 0; index < layout.capacity; index += 1) {
          expect(point(index).x).toBeGreaterThanOrEqual(ACTIVE_QUEUE_AREA.x);
          expect(point(index).x).toBeLessThanOrEqual(ACTIVE_QUEUE_AREA.x + ACTIVE_QUEUE_AREA.width);
        }
      }
      expect(queuePosition(active.capacity - 1, active).y).toBe(480);
      expect(historicalQueuePosition(historical.capacity - 1, active).y).toBe(640);
    }
  });

  it('moves an unknown observation to the lower zone continuously, preserves it during pause and never confirms it', () => {
    const person = transaction(1);
    let state = createPassengerMotion(snapshot([person]));
    const before = pose(state, person.id);
    state = reconcilePassengerMotion(state, snapshot([], T0 + 3_000));
    expect(pose(state, person.id)).toMatchObject({
      x: before.x,
      y: before.y,
      phase: 'reordering',
      queueZone: 'history',
      sourceObserved: false,
      lastObservedAt: T0,
    });
    expect(advancePassengerMotion(state, 60_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000, { hidden: true })).toBe(state);
    for (let step = 0; step < 15; step += 1) {
      state = advancePassengerMotion(state, 100);
      safeRoute(state, person.id);
      expect(passengerFrame(state).passengers).toHaveLength(1);
      expect(pose(state, person.id).tx.status).toBe('pending');
    }
    inHistory(state, person.id);
    expect(pose(state, person.id).phase).toBe('parked');
    expect(state.waitingArchiveCount).toBe(0);
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
  });

  it('returns an old detail with verified pending presence to the active queue, then boards only when eligible', () => {
    const person = transaction(2);
    let state = createPassengerMotion(snapshot([person]));
    state = runFor(reconcilePassengerMotion(state, snapshot([], T0 + 3_000)), 2_000);
    inHistory(state, person.id);
    state = reconcilePassengerMotion(
      state,
      snapshot([], T0 + 6_000, inventory(T0 + 6_000, [person])),
    );
    const during = pose(state, person.id);
    expect(during).toMatchObject({
      queueZone: 'active',
      phase: 'reordering',
      sourceObserved: false,
      poolState: 'pending',
      lastObservedAt: T0,
    });
    state = runFor(state, 2_000);
    inActive(state, person.id);
    expect(pose(state, person.id)).toMatchObject({ phase: 'queue', selectedForCandidate: false });
    const parent = block();
    state = reconcilePassengerMotion(
      state,
      snapshot([], T0 + 9_000, {
        ...inventory(T0 + 9_000, [person]),
        ethereumProjection: {
          parentBlockHash: parent.hash,
          height: parent.height + 1,
          baseFeePerGasWei: '1000000000',
          observedAt: T0 + 9_000,
          source: 'calculated',
        },
      }),
    );
    for (let step = 0; step < 160; step += 1) {
      state = advancePassengerMotion(state, 100);
      safeRoute(state, person.id);
    }
    expect(pose(state, person.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: false,
      poolState: 'pending',
      lastObservedAt: T0,
      tx: { status: 'pending' },
    });
  });

  it('keeps verified queued identities in the active queue despite old individual details and expires them back into history', () => {
    const person = transaction(3);
    let state = settle(createPassengerMotion(snapshot([person])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], T0 + 3_000, inventory(T0 + 3_000, [], [person])),
      ),
    );
    inActive(state, person.id);
    expect(pose(state, person.id)).toMatchObject({
      phase: 'queue',
      poolState: 'queued',
      sourceObserved: false,
      inWagon: false,
      lastObservedAt: T0,
    });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], T0 + 70_000, { sampling: null, poolObservation: null }),
      ),
    );
    inHistory(state, person.id);
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'unknown',
      sourceObserved: false,
      lastObservedAt: T0,
      tx: { status: 'pending' },
    });
  });

  it('puts explicit absence on the historical quay without treating it as confirmation or erasing a person', () => {
    const person = transaction(4);
    let state = settle(createPassengerMotion(snapshot([person])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], T0 + 3_000, inventory(T0 + 3_000, [], [], [person])),
      ),
    );
    inHistory(state, person.id);
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'absent',
      sourceObserved: false,
      reason: 'absent',
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).departingPassengers).toEqual([]);
  });

  it('keeps a replaced identity visible on the historical quay after its ordinary door exit', () => {
    const original = transaction(9, '10000000000');
    const replacement = {
      ...transaction(10, '20000000000'),
      ethereum: { ...original.ethereum!, maxFeePerGasWei: '20000000000' },
    };
    let state = settle(createPassengerMotion(snapshot([original])));
    const before = pose(state, original.id);
    state = reconcilePassengerMotion(state, snapshot([replacement], T0 + 3_000));
    expect(pose(state, original.id)).toMatchObject({
      phase: 'exiting',
      x: before.x,
      y: before.y,
      poolState: 'replaced',
      sourceObserved: false,
      lastObservedAt: T0,
      tx: { status: 'pending' },
    });
    for (let step = 0; step < 160; step += 1) {
      state = advancePassengerMotion(state, 100);
      safeRoute(state, original.id);
    }
    inHistory(state, original.id);
    expect(pose(state, replacement.id)).toMatchObject({ phase: 'boarded', sourceObserved: true });
    expect(passengerFrame(state).passengers).toHaveLength(2);
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
  });

  it('returns a reobserved identity from history to a free active place, retaining its identity and other waiters', () => {
    const person = transaction(5);
    const peer = transaction(6);
    let state = settle(createPassengerMotion(snapshot([person, peer])));
    const peerBefore = pose(state, peer.id);
    state = settle(reconcilePassengerMotion(state, snapshot([peer], T0 + 3_000)));
    inHistory(state, person.id);
    const historyBefore = pose(state, person.id);
    state = reconcilePassengerMotion(state, snapshot([person, peer], T0 + 6_000));
    expect(pose(state, person.id)).toMatchObject({
      x: historyBefore.x,
      y: historyBefore.y,
      queueZone: 'active',
      phase: 'reordering',
      sourceObserved: true,
    });
    state = runFor(state, 2_000);
    inActive(state, person.id);
    expect(pose(state, peer.id)).toMatchObject({ x: peerBefore.x, y: peerBefore.y });
    expect(new Set(passengerFrame(state).passengers.map(({ tx }) => tx.id)).size).toBe(2);
  });

  it('leaves an unproved boarded historical traveller in its seat until existing exit rules apply', () => {
    const person = transaction(7, '10000000000');
    let state = settle(createPassengerMotion(snapshot([person])));
    const before = pose(state, person.id);
    state = reconcilePassengerMotion(state, snapshot([], T0 + 3_000));
    expect(pose(state, person.id)).toMatchObject({
      phase: 'boarded',
      inWagon: true,
      x: before.x,
      y: before.y,
      sourceObserved: false,
      lastObservedAt: T0,
    });
    state = runFor(state, 2_000);
    expect(pose(state, person.id)).toMatchObject({ x: before.x, y: before.y, inWagon: true });
  });

  it('boards an exactly proved historical observation from its current position during stationary preparation and consumes it once', () => {
    const person = transaction(8);
    let state = settle(createPassengerMotion(snapshot([person])));
    state = settle(reconcilePassengerMotion(state, snapshot([], T0 + 3_000)));
    inHistory(state, person.id);
    const before = pose(state, person.id);
    const mined = block(101);
    const source = snapshot([], T0 + 6_000, {
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: [person.id] }],
    });
    state = reconcilePassengerMotion(state, source);
    expect(pose(state, person.id)).toMatchObject({
      x: before.x,
      y: before.y,
      phase: 'preparing',
      tx: { status: 'confirmed', blockHash: mined.hash },
    });
    expect(passengerFrame(state).handoffProgress).toBeNull();
    expect(advancePassengerMotion(state, 60_000, { paused: true })).toBe(state);
    state = runFor(state, preparationDurationMs(source.chain) + 100);
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([person.id]);
    state = runFor(state, 3_000);
    expect(passengerFrame(state).passengers).toHaveLength(0);
    state = settle(reconcilePassengerMotion(state, source));
    expect(passengerFrame(state).passengers).toHaveLength(0);
    expect(state.waitingArchiveCount).toBe(0);
  });

  it('uses every historical place before overlap, without consuming free active places or dropping people', () => {
    const capacity = historicalQueueLayout(DEFAULT_QUEUE_LAYOUT).capacity;
    const old = Array.from({ length: capacity + 2 }, (_, index) => transaction(100 + index));
    const current = transaction(200);
    let state = settle(createPassengerMotion(snapshot(old)));
    state = settle(reconcilePassengerMotion(state, snapshot([current], T0 + 3_000)));
    const frame = passengerFrame(state);
    expect(frame.passengers).toHaveLength(capacity + 3);
    const historical = frame.passengers.filter(({ queueZone }) => queueZone === 'history');
    expect(new Set(historical.map(({ x, y }) => `${x}:${y}`)).size).toBe(capacity);
    expect(historical).toHaveLength(capacity + 2);
    inActive(state, current.id);
    for (const person of old) inHistory(state, person.id);
  });

  it('reflows both zones on desktop and small screens without crossing doors, changing provenance or moving boarded riders', () => {
    const old = Array.from({ length: 12 }, (_, index) => transaction(300 + index));
    const current = Array.from({ length: 12 }, (_, index) => transaction(400 + index));
    const rider = transaction(500, '10000000000');
    let state = settle(createPassengerMotion(snapshot([...old, rider])));
    state = settle(reconcilePassengerMotion(state, snapshot([...current, rider], T0 + 3_000)));
    const riderBefore = pose(state, rider.id);
    const observationDates = new Map(
      passengerFrame(state).passengers.map(({ tx, lastObservedAt }) => [tx.id, lastObservedAt]),
    );
    for (const layout of [createQueueLayout(5), createQueueLayout(0.5)] satisfies QueueLayout[]) {
      state = reflowPassengerQueue(state, layout);
      for (let step = 0; step < 15; step += 1) {
        state = advancePassengerMotion(state, 100);
        for (const person of [...old, ...current]) safeRoute(state, person.id);
      }
      expect(pose(state, rider.id)).toMatchObject({
        x: riderBefore.x,
        y: riderBefore.y,
        inWagon: true,
      });
      for (const person of old) inHistory(state, person.id);
      for (const person of current) inActive(state, person.id);
      for (const person of passengerFrame(state).passengers)
        expect(person.lastObservedAt).toBe(observationDates.get(person.tx.id));
    }
  });
});
