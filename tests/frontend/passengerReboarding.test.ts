import { describe, expect, it } from 'vitest';
import {
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  preparationDurationMs,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
  type PassengerPose,
} from '../../src/lib/passengerMotion';

const OBSERVED_AT = 1_700_000_000_000;

function identifier(value: number, chain: ChainId = 'bitcoin'): string {
  return `${chain === 'ethereum' ? '0x' : ''}${value.toString(16).padStart(64, '0')}`;
}

function transaction(value: number, feeRate = 20, size = 200_000, chain: ChainId = 'bitcoin'): Tx {
  return {
    id: identifier(value, chain),
    chain,
    status: 'pending',
    feeRate,
    size,
    kind: 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
  };
}

function block(height = 100, chain: ChainId = 'bitcoin'): Block {
  const capacity = chain === 'bitcoin' ? 1_000_000 : 60_000_000;
  return {
    hash: identifier(100_000 + height, chain),
    height,
    timestamp: Math.floor(OBSERVED_AT / 1_000) + (height - 100) * 12,
    txCount: 1_000,
    used: capacity / 2,
    capacity,
  };
}

/** Source changes use valid live snapshots; no field fabricates a passenger's engine history. */
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  const chain = overrides.chain ?? transactions[0]?.chain ?? 'bitcoin';
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Échantillon partiel du fournisseur ; seules les inclusions exactes sont prouvées.',
    pendingCount: 10_000,
    feeRate: chain === 'bitcoin' ? 8 : 2,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [block(100, chain)],
    inclusions: [],
    ...overrides,
  });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, durationMs - elapsed));
  return next;
}

function pose(state: PassengerMotionState, id: string): PassengerPose {
  const passenger = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!passenger) throw new Error(`Voyageur attendu absent : ${id}`);
  return passenger;
}

function minedSnapshot(
  included: Tx,
  observedAt = OBSERVED_AT + 3_000,
  transactions: Tx[] = [],
  overrides: Partial<Snapshot> = {},
): Snapshot {
  const mined = block(101, included.chain);
  return snapshot([...transactions, { ...included, status: 'confirmed', blockHash: mined.hash }], {
    chain: included.chain,
    observedAt,
    blocks: [mined],
    inclusions: [{ block: mined, transactionIds: [included.id] }],
    ...overrides,
  });
}

function boardedPair(retained: Tx, included: Tx): PassengerMotionState {
  const state = runFor(createPassengerMotion(snapshot([retained, included])), 15_000);
  expect(pose(state, retained.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
  expect(pose(state, included.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
  return state;
}

describe('Reboarding a previously boarded observation', () => {
  it('reboards an absent Bitcoin rider after an exact departure despite refreshes during its exit and return', () => {
    const retained = transaction(1);
    const included = transaction(2, 30);
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'exiting',
      sourceObserved: false,
      tx: retained,
      lastObservedAt: OBSERVED_AT,
    });
    state = runFor(state, 200);
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 6_000));
    expect(pose(state, retained.id).phase).toBe('exiting');
    state = runFor(state, 400);
    expect(pose(state, retained.id).phase).toBe('returning');
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 9_000));
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'returning',
      selectedForCandidate: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    expect(advancePassengerMotion(state, 10_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 10_000, { hidden: true })).toBe(state);
    state = runFor(state, preparationDurationMs(included.chain) - 600);
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    expect(pose(state, retained.id)).toMatchObject({ inWagon: false, tx: { status: 'pending' } });
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      inWagon: true,
      selectedForCandidate: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    const frame = passengerFrame(state);
    expect(frame.passengers.map(({ tx }) => tx.id)).toEqual([retained.id]);
    expect(frame.waitingArchiveCount).toBe(0);
    expect(frame.projectionUsed).toEqual({ next: retained.size, later: 0 });
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 12_000));
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
    });
  });

  it('does not grant a historical boarding reservation to someone lost before ever entering a wagon', () => {
    const neverBoarded = transaction(3);
    let state = createPassengerMotion(snapshot([neverBoarded]));
    expect(pose(state, neverBoarded.id)).toMatchObject({
      phase: 'queue',
      arrivalKind: 'initial-stock',
      inWagon: false,
    });
    state = reconcilePassengerMotion(state, snapshot([], { observedAt: OBSERVED_AT + 3_000 }));
    state = runFor(state, 15_000);
    expect(pose(state, neverBoarded.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      destination: 'queue',
      selectedForCandidate: false,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: neverBoarded,
    });
    const included = transaction(4, 30);
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 6_000));
    state = runFor(state, 15_000);
    expect(pose(state, neverBoarded.id)).toMatchObject({
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      tx: neverBoarded,
    });
  });

  it('does not renew an absent rider reservation beyond thirty minutes while returning', () => {
    const retained = transaction(5);
    const included = transaction(6, 30);
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    state = runFor(state, 600);
    expect(pose(state, retained.id).phase).toBe('returning');
    state = reconcilePassengerMotion(
      state,
      minedSnapshot(included, OBSERVED_AT + TRACKED_TRANSACTION_TTL_MS),
    );
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 0, later: 0 });
  });

  it('keeps a retained rider outside when current higher-fee transactions consume both native block budgets', () => {
    const retained = transaction(7);
    const included = transaction(8, 30);
    const higher = transaction(9, 200, 1_000_000);
    const nextHigher = transaction(10, 100, 1_000_000);
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    state = runFor(state, 600);
    state = reconcilePassengerMotion(
      state,
      minedSnapshot(included, OBSERVED_AT + 6_000, [higher, nextHigher]),
    );
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      tx: retained,
    });
    expect(pose(state, higher.id).inWagon).toBe(true);
    expect(pose(state, nextHigher.id).inWagon).toBe(true);
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 1_000_000, later: 1_000_000 });
  });

  it('reboards an already parked historical rider when an exact inclusion frees enough native space', () => {
    const retained = transaction(17, 20, 600_000);
    const higher = transaction(18, 200, 600_000);
    const nextHigher = transaction(19, 100, 600_000);
    let state = runFor(createPassengerMotion(snapshot([retained])), 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      lastObservedAt: OBSERVED_AT,
    });
    state = reconcilePassengerMotion(
      state,
      snapshot([higher, nextHigher], { observedAt: OBSERVED_AT + 3_000 }),
    );
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    expect(pose(state, higher.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    expect(pose(state, nextHigher.id)).toMatchObject({ phase: 'boarded', wagon: 'later' });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 600_000, later: 600_000 });

    state = reconcilePassengerMotion(
      state,
      minedSnapshot(higher, OBSERVED_AT + 6_000, [nextHigher]),
    );
    state = runFor(state, preparationDurationMs(higher.chain));
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([higher.id]);
    state = runFor(state, 15_000);
    expect(pose(state, nextHigher.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      inWagon: true,
      selectedForCandidate: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    expect(
      passengerFrame(state)
        .passengers.map(({ tx }) => tx.id)
        .sort(),
    ).toEqual([retained.id, nextHigher.id].sort());
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 600_000, later: 600_000 });
    expect(passengerFrame(state).waitingArchiveCount).toBe(0);
  });

  it('still requires an Ethereum retained rider to cover the current base fee before reboarding', () => {
    const retained = transaction(11, 5, 21_000, 'ethereum');
    const included = transaction(12, 10, 21_000, 'ethereum');
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    state = runFor(state, 600);
    state = reconcilePassengerMotion(
      state,
      minedSnapshot(included, OBSERVED_AT + 6_000, [], { feeRate: 6 }),
    );
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      tx: retained,
      lastObservedAt: OBSERVED_AT,
    });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 0, later: 0 });
  });

  it('updates provenance only on a real pending reobservation during the return', () => {
    const retained = transaction(13);
    const included = transaction(14, 30);
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    state = runFor(state, 600);
    state = reconcilePassengerMotion(
      state,
      minedSnapshot(included, OBSERVED_AT + 9_000, [retained]),
    );
    state = runFor(state, 15_000);
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      inWagon: true,
      selectedForCandidate: true,
      sourceObserved: true,
      lastObservedAt: OBSERVED_AT + 9_000,
      tx: retained,
    });
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 12_000));
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT + 9_000,
    });
  });

  it('settles the retained rider aboard with reduced motion without refreshing its source observation', () => {
    const retained = transaction(15);
    const included = transaction(16, 30);
    let state = boardedPair(retained, included);
    state = reconcilePassengerMotion(state, minedSnapshot(included));
    state = runFor(state, 600);
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 6_000));
    const clock = state.elapsedMs;
    state = advancePassengerMotion(state, 0, { reducedMotion: true });
    expect(state.elapsedMs).toBe(clock);
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      inWagon: true,
      selectedForCandidate: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: retained,
    });
    expect(passengerFrame(state).passengers.map(({ tx }) => tx.id)).toEqual([retained.id]);
    expect(passengerFrame(state).departingPassengers).toEqual([]);
    expect(passengerFrame(state).waitingArchiveCount).toBe(0);
    state = reconcilePassengerMotion(state, minedSnapshot(included, OBSERVED_AT + 9_000));
    state = advancePassengerMotion(state, 0, { reducedMotion: true });
    expect(pose(state, retained.id)).toMatchObject({
      phase: 'boarded',
      inWagon: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
    });
  });
});
