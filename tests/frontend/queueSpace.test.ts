import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  reflowPassengerQueue,
  type PassengerMotionState,
  type PassengerPose,
} from '../../src/lib/passengerMotion';
import {
  DEFAULT_QUEUE_LAYOUT,
  PLATFORM_CORRIDOR_X,
  createQueueLayout,
  ACTIVE_QUEUE_AREA,
  HISTORICAL_QUEUE_AREA,
  historicalQueueLayout,
} from '../../src/lib/streetGeometry';

const OBSERVED_AT = 1_700_000_000_000;

function identifier(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function transaction(value: number, feeRate = 1): Tx {
  return {
    id: identifier(value),
    chain: 'ethereum',
    status: 'pending',
    feeRate,
    size: 21_000,
    kind: 'transfer',
    value: '0.01 ETH',
  };
}

/** Low-fee Ethereum transactions remain on the platform for these queue scenarios. */
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Transactions observées dans un échantillon partiel du fournisseur.',
    pendingCount: null,
    feeRate: 2,
    feeUnit: 'Gwei',
    transactions,
    blocks: [
      {
        hash: identifier(100_000),
        height: 100,
        timestamp: Math.floor(OBSERVED_AT / 1_000),
        txCount: 1_000,
        used: 30_000_000,
        capacity: 60_000_000,
      },
    ],
    ...overrides,
  });
}

function cohort(count: number, firstId = 1): Tx[] {
  return Array.from({ length: count }, (_, index) => transaction(firstId + index));
}

function settle(state: PassengerMotionState): PassengerMotionState {
  return advancePassengerMotion(state, 100, { reducedMotion: true });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, durationMs - elapsed));
  return next;
}

function pose(state: PassengerMotionState, id: string): PassengerPose {
  const result = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!result) throw new Error(`Voyageur attendu absent : ${id}`);
  return result;
}

function queuePoints(state: PassengerMotionState): Set<string> {
  return new Set(
    passengerFrame(state)
      .passengers.filter((passenger) => !passenger.inWagon)
      .map(({ x, y }) => `${x}:${y}`),
  );
}

describe('Shared free queue places', () => {
  it('spreads waiting passengers over distinct places while the platform has room', () => {
    const transactions = cohort(20);
    const state = settle(createPassengerMotion(snapshot(transactions)));
    const frame = passengerFrame(state);
    expect(DEFAULT_QUEUE_LAYOUT.capacity).toBeGreaterThanOrEqual(transactions.length);
    expect(frame.passengers).toHaveLength(transactions.length);
    expect(frame.passengers.every(({ phase, inWagon }) => phase === 'queue' && !inWagon)).toBe(
      true,
    );
    expect(queuePoints(state).size).toBe(transactions.length);
    for (const [index, left] of frame.passengers.entries())
      for (const right of frame.passengers.slice(index + 1))
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(32);
  });

  it('preserves arrival places and gives higher-fee newcomers the first available places', () => {
    const first = transaction(1, 0.5);
    const second = transaction(2, 1);
    let state = settle(createPassengerMotion(snapshot([first, second])));
    const before = [pose(state, first.id), pose(state, second.id)];
    const low = transaction(3, 0.2);
    const high = transaction(4, 1.5);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([first, second, low, high], { observedAt: OBSERVED_AT + 3_000 }),
      ),
    );
    for (const previous of before)
      expect(pose(state, previous.tx.id)).toMatchObject({ x: previous.x, y: previous.y });
    const highSlot = state.passengers.find(({ tx }) => tx.id === high.id)?.queueIndex;
    const lowSlot = state.passengers.find(({ tx }) => tx.id === low.id)?.queueIndex;
    expect(highSlot).toBeDefined();
    expect(lowSlot).toBeDefined();
    expect(highSlot!).toBeLessThan(lowSlot!);
    expect(queuePoints(state).size).toBe(4);
  });

  it('reuses the queue place released by an embarked passenger', () => {
    const embarked = transaction(1, 3);
    const waiting = transaction(2);
    let state = createPassengerMotion(snapshot([embarked, waiting]));
    const oldQueuePlace = pose(state, embarked.id);
    state = settle(state);
    expect(pose(state, embarked.id).phase).toBe('boarded');
    const waitingPlace = pose(state, waiting.id);
    const incoming = transaction(3, 1.5);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([embarked, waiting, incoming], { observedAt: OBSERVED_AT + 3_000 }),
      ),
    );
    expect(pose(state, incoming.id)).toMatchObject({
      phase: 'queue',
      x: oldQueuePlace.queueX,
      y: oldQueuePlace.queueY,
    });
    expect(pose(state, waiting.id)).toMatchObject({ x: waitingPlace.x, y: waitingPlace.y });
    expect(queuePoints(state).size).toBe(2);
  });

  it('uses every free historical place while keeping the active queue separate', () => {
    const transactions = cohort(historicalQueueLayout(DEFAULT_QUEUE_LAYOUT).capacity);
    let state = settle(createPassengerMotion(snapshot(transactions)));
    const oldPlaces = new Map(
      passengerFrame(state).passengers.map((passenger) => [passenger.tx.id, passenger]),
    );
    const incoming = transaction(30, 1.5);
    state = settle(
      reconcilePassengerMotion(state, snapshot([incoming], { observedAt: OBSERVED_AT + 3_000 })),
    );
    expect(passengerFrame(state).passengers).toHaveLength(transactions.length + 1);
    for (const previous of oldPlaces.values())
      expect(pose(state, previous.tx.id)).toMatchObject({
        phase: 'parked',
        sourceObserved: false,
        queueZone: 'history',
        tx: { status: 'pending' },
      });
    expect(queuePoints(state).size).toBe(transactions.length + 1);
    expect(pose(state, incoming.id).queueZone).toBe('active');
    expect(pose(state, incoming.id).y).toBeLessThanOrEqual(
      ACTIVE_QUEUE_AREA.y + ACTIVE_QUEUE_AREA.height,
    );
    expect([...oldPlaces.keys()].every((id) => pose(state, id).y >= HISTORICAL_QUEUE_AREA.y)).toBe(
      true,
    );
    const oldObservation = state.passengers.find(({ tx }) => tx.id === transactions[0]!.id);
    expect(oldObservation?.lastObservedAt).toBe(OBSERVED_AT);
  });

  it('finds another free place when a disembarking passenger has lost its former place', () => {
    const returning = transaction(1, 3);
    const waiting = transaction(2);
    let state = createPassengerMotion(snapshot([returning, waiting]));
    const formerPlace = pose(state, returning.id);
    state = settle(state);
    const incoming = transaction(3, 1.5);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([returning, waiting, incoming], { observedAt: OBSERVED_AT + 3_000 }),
      ),
    );
    expect(pose(state, incoming.id)).toMatchObject({
      x: formerPlace.queueX,
      y: formerPlace.queueY,
    });
    const newcomerPlace = pose(state, incoming.id);
    state = reconcilePassengerMotion(
      state,
      snapshot([returning, waiting, incoming], {
        feeRate: 4,
        observedAt: OBSERVED_AT + 6_000,
      }),
    );
    expect(pose(state, returning.id).phase).toBe('exiting');
    state = runFor(state, 15_000);
    expect(pose(state, returning.id)).toMatchObject({ inWagon: false, destination: 'queue' });
    expect(pose(state, incoming.id)).toMatchObject({ x: newcomerPlace.x, y: newcomerPlace.y });
    expect(queuePoints(state).size).toBe(3);
  });

  it('returns a reobserved historical traveller to a free active place without moving other waiters', () => {
    const transactions = cohort(3);
    const retained = transactions[0]!;
    let state = settle(createPassengerMotion(snapshot(transactions)));
    const originalPlace = pose(state, retained.id);
    const incoming = transaction(4, 1.5);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([...transactions.slice(1), incoming], { observedAt: OBSERVED_AT + 3_000 }),
      ),
    );
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'parked',
      sourceObserved: false,
      queueZone: 'history',
    });
    expect(pose(state, retained.id).y).not.toBe(originalPlace.y);
    const before = passengerFrame(state).passengers;
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([{ ...retained, feeRate: 1.9 }, ...transactions.slice(1), incoming], {
          observedAt: OBSERVED_AT + 6_000,
        }),
      ),
    );
    for (const previous of before.filter(({ tx }) => tx.id !== retained.id))
      expect(pose(state, previous.tx.id)).toMatchObject({ x: previous.x, y: previous.y });
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'queue',
      queueZone: 'active',
      sourceObserved: true,
      tx: { feeRate: 1.9, status: 'pending' },
    });
    expect(state.passengers.find(({ tx }) => tx.id === retained.id)?.lastObservedAt).toBe(
      OBSERVED_AT + 6_000,
    );
    expect(queuePoints(state).size).toBe(4);
  });

  it('only overlaps queue positions after every available place is occupied', () => {
    const capacity = DEFAULT_QUEUE_LAYOUT.capacity;
    const state = settle(createPassengerMotion(snapshot(cohort(capacity + 3))));
    const frame = passengerFrame(state);
    expect(frame.passengers).toHaveLength(capacity + 3);
    expect(queuePoints(state).size).toBe(capacity);
    expect(frame.passengers.every(({ tx, inWagon }) => tx.status === 'pending' && !inWagon)).toBe(
      true,
    );
  });

  it('moves overlapping occupants into places freed by boarding without moving other waiters', () => {
    const capacity = DEFAULT_QUEUE_LAYOUT.capacity;
    const transactions = cohort(capacity + 2);
    let state = settle(createPassengerMotion(snapshot(transactions)));
    expect(queuePoints(state).size).toBe(capacity);
    const boarding = new Set(transactions.slice(0, 2).map(({ id }) => id));
    const before = passengerFrame(state).passengers;
    const occupiedOnce = new Map<string, PassengerPose>();
    for (const passenger of before) {
      const peers = before.filter(({ x, y }) => x === passenger.x && y === passenger.y);
      if (!boarding.has(passenger.tx.id) && peers.length === 1)
        occupiedOnce.set(passenger.tx.id, passenger);
    }
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot(
          transactions.map((tx) => (boarding.has(tx.id) ? { ...tx, feeRate: 3 } : tx)),
          { observedAt: OBSERVED_AT + 3_000 },
        ),
      ),
    );
    expect(passengerFrame(state).passengers.filter(({ inWagon }) => inWagon)).toHaveLength(2);
    expect(queuePoints(state).size).toBe(capacity);
    for (const previous of occupiedOnce.values())
      expect(pose(state, previous.tx.id)).toMatchObject({ x: previous.x, y: previous.y });
  });

  it('uses wider desktop room while preserving embarked passengers, provenance and the clock', () => {
    const boarded = transaction(1, 3);
    const waiting = cohort(80, 10);
    let state = settle(createPassengerMotion(snapshot([boarded, ...waiting])));
    state = runFor(state, 1_000);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([boarded, ...waiting.slice(1)], { observedAt: OBSERVED_AT + 3_000 }),
      ),
    );
    const before = state;
    const boardedBefore = pose(state, boarded.id);
    const observations = new Map(
      state.passengers.map((passenger) => [
        passenger.tx.id,
        {
          tx: passenger.tx,
          lastObservedAt: passenger.lastObservedAt,
          presentInSample: passenger.presentInSample,
        },
      ]),
    );
    const roomy = createQueueLayout(4);
    expect(roomy.capacity).toBeGreaterThanOrEqual(waiting.length);
    state = reflowPassengerQueue(state, roomy);
    expect(state).toMatchObject({
      context: before.context,
      elapsedMs: before.elapsedMs,
      observedBlockHash: before.observedBlockHash,
      lastDepartureStartedAt: before.lastDepartureStartedAt,
      queueLayout: roomy,
    });
    expect(advancePassengerMotion(state, 60_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000, { hidden: true })).toBe(state);
    const elapsedMs = state.elapsedMs;
    state = settle(state);
    expect(state.elapsedMs).toBe(elapsedMs);
    expect(queuePoints(state).size).toBe(waiting.length);
    expect(pose(state, boarded.id)).toMatchObject({
      phase: 'boarded',
      wagon: boardedBefore.wagon,
      x: boardedBefore.x,
      y: boardedBefore.y,
      sourceObserved: true,
    });
    for (const passenger of state.passengers) {
      const observation = observations.get(passenger.tx.id)!;
      expect(passenger).toMatchObject(observation);
      expect(passenger.tx).toBe(observation.tx);
    }
    expect(pose(state, waiting[0]!.id)).toMatchObject({
      sourceObserved: false,
      tx: { status: 'pending' },
    });
  });

  it('keeps animated resizing routes on the platform and preserves every waiting transaction', () => {
    const transactions = cohort(50);
    let state = settle(createPassengerMotion(snapshot(transactions)));
    state = reflowPassengerQueue(state, createQueueLayout(3));
    for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
      state = advancePassengerMotion(state, 100);
      const frame = passengerFrame(state);
      expect(frame.passengers).toHaveLength(transactions.length);
      expect(frame.passengers.every(({ x }) => x >= PLATFORM_CORRIDOR_X)).toBe(true);
      expect(frame.passengers.every(({ tx }) => tx.status === 'pending')).toBe(true);
    }
    expect(queuePoints(state).size).toBe(transactions.length);
  });
});
