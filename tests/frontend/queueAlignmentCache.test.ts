import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  reflowPassengerQueue,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { DEFAULT_QUEUE_LAYOUT, createQueueLayout } from '../../src/lib/streetGeometry';

const OBSERVED_AT = 1_700_000_000_000;
const identifier = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const transaction = (value: number): Tx => ({
  id: identifier(value),
  chain: 'ethereum',
  status: 'pending',
  feeRate: 1,
  size: 21_000,
  kind: 'transfer',
  value: '0.01 ETH',
});

function snapshot(transactions: Tx[], observedAt = OBSERVED_AT): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt,
    coverage: 'Échantillon contrôlé ; aucune inclusion déduite de la scène.',
    pendingCount: null,
    feeRate: 2,
    feeUnit: 'Gwei',
    transactions,
    blocks: [
      {
        hash: identifier(100_000),
        height: 100,
        timestamp: OBSERVED_AT / 1_000,
        txCount: 1_000,
        used: 30_000_000,
        capacity: 60_000_000,
      },
    ],
  });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100)
    state = advancePassengerMotion(state, Math.min(100, durationMs - elapsed));
  return state;
}

function passenger(state: PassengerMotionState, id: string) {
  const result = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!result) throw new Error(`Voyageur absent : ${id}`);
  return result;
}

describe('Stable queue alignment and time-dependent journeys', () => {
  it('retains fixed queue places and source dates while the animation clock advances', () => {
    const tx = transaction(1);
    let state = runFor(createPassengerMotion(snapshot([tx])), 2_000);
    const before = state;
    const place = passenger(state, tx.id);
    state = runFor(state, 2_000);
    expect(state.passengers).toBe(before.passengers);
    expect(passenger(state, tx.id)).toBe(place);
    expect(state.elapsedMs).toBe(before.elapsedMs + 2_000);
    expect(state.passengers[0]?.lastObservedAt).toBe(OBSERVED_AT);
    expect(passenger(state, tx.id)).toMatchObject({
      phase: 'queue',
      inWagon: false,
      tx: { status: 'pending' },
    });
  });

  it('finishes a reordering journey near its destination before its nominal duration ends', () => {
    const txs = [transaction(1), transaction(2)];
    let state = createPassengerMotion(snapshot(txs));
    state = reflowPassengerQueue(state, createQueueLayout(2));
    const moving = state.passengers.find(({ tx }) => tx.id === txs[1]!.id)!;
    expect(moving.phase).toBe('reordering');
    expect(moving.durationMs).toBe(350);
    state = runFor(state, moving.durationMs - 1);
    expect(state.elapsedMs).toBeLessThan(moving.phaseStartedAt + moving.durationMs);
    expect(passenger(state, moving.tx.id)).toMatchObject({
      phase: 'queue',
      x: moving.queuePoint!.x,
      y: moving.queuePoint!.y,
      tx: { status: 'pending' },
    });
  });

  it('keeps arrival positions moving between phase changes without moving established waiters', () => {
    const first = transaction(1);
    const incoming = transaction(2);
    let state = runFor(createPassengerMotion(snapshot([first])), 2_000);
    const established = passenger(state, first.id);
    state = reconcilePassengerMotion(state, snapshot([first, incoming], OBSERVED_AT + 3_000));
    state = reflowPassengerQueue(state, DEFAULT_QUEUE_LAYOUT);
    const arrival = passenger(state, incoming.id);
    const before = state.passengers;
    state = advancePassengerMotion(state, 100);
    expect(state.passengers).toBe(before);
    expect(passenger(state, incoming.id).phase).toBe('arriving');
    expect(passenger(state, incoming.id).x).toBeLessThan(arrival.x);
    expect(passenger(state, first.id)).toMatchObject({ x: established.x, y: established.y });
    state = runFor(state, 6_000);
    expect(passenger(state, incoming.id)).toMatchObject({
      phase: 'queue',
      queueZone: 'active',
      sourceObserved: true,
      tx: { status: 'pending' },
    });
    expect(passenger(state, incoming.id).x).not.toBe(established.x);
  });

  it('reassigns source changes and newly available desktop places after a stable period', () => {
    const txs = Array.from({ length: DEFAULT_QUEUE_LAYOUT.capacity + 2 }, (_, index) =>
      transaction(index + 1),
    );
    let state = runFor(createPassengerMotion(snapshot(txs)), 2_000);
    const retained = txs[0]!;
    state = reconcilePassengerMotion(state, snapshot(txs.slice(1), OBSERVED_AT + 3_000));
    state = runFor(state, 15_000);
    expect(passenger(state, retained.id)).toMatchObject({
      phase: 'parked',
      queueZone: 'history',
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    const roomy = createQueueLayout(4);
    state = reflowPassengerQueue(state, roomy);
    state = runFor(state, 2_000);
    const current = passengerFrame(state).passengers.filter(({ sourceObserved }) => sourceObserved);
    expect(new Set(current.map(({ x, y }) => `${x}:${y}`)).size).toBe(txs.length - 1);
    expect(passenger(state, retained.id).queueZone).toBe('history');
    state = reconcilePassengerMotion(state, snapshot(txs, OBSERVED_AT + 6_000));
    state = runFor(state, 15_000);
    expect(passenger(state, retained.id)).toMatchObject({
      phase: 'queue',
      queueZone: 'active',
      sourceObserved: true,
      tx: { status: 'pending' },
    });
    expect(state.passengers.find(({ tx }) => tx.id === retained.id)?.lastObservedAt).toBe(
      OBSERVED_AT + 6_000,
    );
  });
});
