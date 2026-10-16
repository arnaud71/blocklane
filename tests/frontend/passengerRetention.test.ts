import { describe, expect, it } from 'vitest';
import {
  MAX_INDIVIDUAL_HISTORY,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  CANDIDATE_ARRIVAL_DURATION_MS,
  HANDOFF_DURATION_MS,
  MAX_ARCHIVED_OBSERVATIONS,
  MAX_RESIDENT_PASSENGERS,
  preparationDurationMs,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';

const OBSERVED_AT = 1_700_000_000_000;

function identifier(value: number, chain: ChainId = 'bitcoin'): string {
  return `${chain === 'ethereum' ? '0x' : ''}${value.toString(16).padStart(64, '0')}`;
}

function transaction(value: number, feeRate = 20, size = 200, chain: ChainId = 'bitcoin'): Tx {
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

/** A partial, valid provider observation; absence is deliberately not a removal receipt. */
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  const chain = overrides.chain ?? transactions[0]?.chain ?? 'bitcoin';
  const capacity = chain === 'bitcoin' ? 1_000_000 : 60_000_000;
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Sélection partielle de transactions observées ; aucune suppression attestée.',
    pendingCount: 10_000,
    feeRate: chain === 'bitcoin' ? 8 : 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [
      {
        hash: identifier(100, chain),
        height: 100,
        timestamp: Math.floor(OBSERVED_AT / 1_000),
        txCount: 1_000,
        used: capacity / 2,
        capacity,
      },
    ],
    ...overrides,
  });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, durationMs - elapsed));
  return next;
}

function pose(state: PassengerMotionState, id: string) {
  const result = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!result) throw new Error(`Voyageur attendu absent : ${id}`);
  return result;
}

describe('Retained projection passengers', () => {
  it('boards Bitcoin below the recommended rate and keeps its place when that recommendation rises', () => {
    const tx = transaction(1, 2);
    let state = runFor(createPassengerMotion(snapshot([tx], { feeRate: 8 })), 15_000);
    const before = pose(state, tx.id);
    expect(before).toMatchObject({ phase: 'boarded', wagon: 'next', reason: 'accepted' });

    state = reconcilePassengerMotion(
      state,
      snapshot([tx], { feeRate: 100, observedAt: OBSERVED_AT + 3_000 }),
    );
    state = runFor(state, 2_000);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      x: before.x,
      y: before.y,
      selectedForCandidate: true,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).projectionUsed.next).toBe(tx.size);
  });

  it('retains an absent rider without refreshing its provenance and reobserves it without double counting', () => {
    const tx = transaction(2);
    let state = runFor(createPassengerMotion(snapshot([tx])), 15_000);
    const before = pose(state, tx.id);

    state = reconcilePassengerMotion(state, snapshot([], { observedAt: OBSERVED_AT + 3_000 }));
    state = runFor(state, 2_000);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      wagon: before.wagon,
      x: before.x,
      y: before.y,
      sourceObserved: false,
      selectedForCandidate: true,
      tx: { status: 'pending' },
    });
    expect(
      state.passengers.find(({ tx: candidate }) => candidate.id === tx.id)?.lastObservedAt,
    ).toBe(OBSERVED_AT);
    expect(passengerFrame(state).projectionCount.next).toBe(1);
    expect(passengerFrame(state).projectionUsed.next).toBe(tx.size);

    state = reconcilePassengerMotion(state, snapshot([tx], { observedAt: OBSERVED_AT + 6_000 }));
    const frame = passengerFrame(state);
    expect(frame.passengers.filter(({ tx: candidate }) => candidate.id === tx.id)).toHaveLength(1);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      wagon: before.wagon,
      x: before.x,
      y: before.y,
      sourceObserved: true,
    });
    expect(
      state.passengers.find(({ tx: candidate }) => candidate.id === tx.id)?.lastObservedAt,
    ).toBe(OBSERVED_AT + 6_000);
    expect(frame.projectionCount.next).toBe(1);
    expect(frame.projectionUsed.next).toBe(tx.size);
  });

  it('does not invent boarding for an observation lost before reaching the wagon', () => {
    const tx = transaction(3);
    let state = createPassengerMotion(snapshot([tx]));
    expect(pose(state, tx.id).inWagon).toBe(false);
    state = reconcilePassengerMotion(state, snapshot([], { observedAt: OBSERVED_AT + 3_000 }));
    state = runFor(state, 15_000);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      wagon: null,
      selectedForCandidate: false,
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).projectionCount).toEqual({ next: 0, later: 0 });
  });

  it('preserves existing wagon assignments and seats when a higher-fee arrival fits without displacement', () => {
    const first = transaction(4, 20, 600_000);
    const second = transaction(5, 10, 600_000);
    let state = runFor(createPassengerMotion(snapshot([first, second])), 15_000);
    const firstPlace = pose(state, first.id);
    const secondPlace = pose(state, second.id);
    expect(firstPlace.wagon).toBe('next');
    expect(secondPlace.wagon).toBe('later');

    const arrival = transaction(6, 100, 200_000);
    state = reconcilePassengerMotion(
      state,
      snapshot([first, { ...second, feeRate: 30 }, arrival], {
        observedAt: OBSERVED_AT + 3_000,
      }),
    );
    state = runFor(state, 15_000);
    for (const previous of [firstPlace, secondPlace])
      expect(pose(state, previous.tx.id)).toMatchObject({
        phase: 'boarded',
        wagon: previous.wagon,
        x: previous.x,
        y: previous.y,
      });
    expect(pose(state, arrival.id).phase).toBe('boarded');
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 800_000, later: 600_000 });
  });

  it.each([
    { chain: 'bitcoin' as const, size: 600_000, capacity: 1_000_000 },
    { chain: 'ethereum' as const, size: 40_000_000, capacity: 60_000_000 },
  ])(
    'displaces the weaker fee only under actual $chain resource pressure',
    ({ chain, size, capacity }) => {
      const strong = transaction(7, 20, size, chain);
      const weak = transaction(8, 10, size, chain);
      const arrival = transaction(9, 100, size, chain);
      let state = runFor(createPassengerMotion(snapshot([strong, weak], { chain })), 15_000);
      expect(pose(state, strong.id).phase).toBe('boarded');
      expect(pose(state, weak.id).phase).toBe('boarded');

      state = reconcilePassengerMotion(
        state,
        snapshot([strong, weak, arrival], { chain, observedAt: OBSERVED_AT + 3_000 }),
      );
      expect(pose(state, weak.id)).toMatchObject({
        phase: 'exiting',
        reason: 'capacity',
        selectedForCandidate: false,
        tx: { status: 'pending' },
      });
      state = runFor(state, 15_000);
      expect(pose(state, weak.id)).toMatchObject({ inWagon: false, destination: 'queue' });
      expect(pose(state, strong.id).inWagon).toBe(true);
      expect(pose(state, arrival.id).inWagon).toBe(true);
      const frame = passengerFrame(state);
      expect(frame.candidateCapacity).toBe(capacity);
      expect(frame.projectionCount).toEqual({ next: 1, later: 1 });
      expect(frame.projectionUsed).toEqual({ next: size, later: size });
    },
  );

  it('uses exact block evidence for departures and keeps unproved riders aboard during vehicle movement', () => {
    const included = transaction(10, 30, 600_000);
    const unproved = transaction(11, 20, 200_000);
    const connecting = transaction(12, 10, 600_000);
    const initial = snapshot([included, unproved, connecting]);
    let state = runFor(createPassengerMotion(initial), 15_000);
    expect(pose(state, connecting.id).wagon).toBe('later');
    const block = { ...initial.blocks[0]!, hash: identifier(101), height: 101, used: 800_000 };
    const observed = snapshot(
      [{ ...included, status: 'confirmed', blockHash: block.hash }, connecting],
      {
        blocks: [block],
        observedAt: OBSERVED_AT + 3_000,
        inclusions: [{ block, transactionIds: [included.id] }],
      },
    );
    state = reconcilePassengerMotion(state, observed);
    expect(passengerFrame(state).preparationProgress).toBe(0);
    expect(passengerFrame(state).handoffProgress).toBeNull();
    expect(pose(state, unproved.id).tx.status).toBe('pending');

    state = runFor(state, preparationDurationMs(included.chain) - 100);
    expect(passengerFrame(state).handoffProgress).toBeNull();
    state = runFor(state, 100);
    const departing = passengerFrame(state);
    expect(departing.handoffProgress).toBe(0);
    expect(departing.departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    expect(departing.departingPassengers[0]?.tx.blockHash).toBe(block.hash);
    expect(pose(state, unproved.id)).toMatchObject({ inWagon: false, tx: { status: 'pending' } });

    state = reconcilePassengerMotion(state, {
      ...observed,
      observedAt: OBSERVED_AT + 6_000,
      transactions: [],
    });
    for (let elapsed = 0; elapsed < HANDOFF_DURATION_MS; elapsed += 100) {
      expect(pose(state, connecting.id)).toMatchObject({
        phase: 'boarded',
        inWagon: true,
        inHandoff: true,
        tx: { status: 'pending' },
      });
      expect(passengerFrame(state).doors.later.exit).toBe(false);
      state = advancePassengerMotion(state, 100);
    }
    expect(pose(state, connecting.id)).toMatchObject({
      phase: 'boarded',
      inWagon: true,
      wagon: 'next',
      sourceObserved: false,
    });
    const promotedPlace = pose(state, connecting.id);
    state = runFor(state, CANDIDATE_ARRIVAL_DURATION_MS + 2_000);
    state = reconcilePassengerMotion(state, {
      ...observed,
      observedAt: OBSERVED_AT + 9_000,
      transactions: [],
    });
    state = runFor(state, 2_000);
    expect(pose(state, connecting.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      x: promotedPlace.x,
      y: promotedPlace.y,
      sourceObserved: false,
      selectedForCandidate: true,
      tx: { status: 'pending' },
    });
    expect(state.passengers.find(({ tx }) => tx.id === connecting.id)?.lastObservedAt).toBe(
      OBSERVED_AT + 3_000,
    );
  });

  it('still disembarks an Ethereum transaction that becomes ineligible below the current base fee', () => {
    const tx = transaction(15, 5, 21_000, 'ethereum');
    let state = runFor(
      createPassengerMotion(snapshot([tx], { chain: 'ethereum', feeRate: 2 })),
      15_000,
    );
    expect(pose(state, tx.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    state = reconcilePassengerMotion(
      state,
      snapshot([tx], { chain: 'ethereum', feeRate: 6, observedAt: OBSERVED_AT + 3_000 }),
    );
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'exiting',
      reason: 'fee',
      selectedForCandidate: false,
      tx: { status: 'pending' },
    });
    state = runFor(state, 15_000);
    expect(pose(state, tx.id)).toMatchObject({ inWagon: false, destination: 'queue' });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 0, later: 0 });
  });

  it('keeps retained riders at their wagon with reduced motion and respects pause and hidden state', () => {
    const tx = transaction(13);
    let state = runFor(createPassengerMotion(snapshot([tx])), 15_000);
    const before = pose(state, tx.id);
    state = reconcilePassengerMotion(state, snapshot([], { observedAt: OBSERVED_AT + 3_000 }));
    expect(advancePassengerMotion(state, 10_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 10_000, { hidden: true })).toBe(state);
    const elapsedMs = state.elapsedMs;
    state = advancePassengerMotion(state, 10_000, { reducedMotion: true });
    expect(state.elapsedMs).toBe(elapsedMs);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      wagon: before.wagon,
      x: before.x,
      y: before.y,
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).projectionUsed.next).toBe(tx.size);
  });

  it('releases an expired reservation while preserving the pending observation on the platform', () => {
    const tx = transaction(14);
    let state = runFor(createPassengerMotion(snapshot([tx])), 15_000);
    state = reconcilePassengerMotion(
      state,
      snapshot([], { observedAt: OBSERVED_AT + TRACKED_TRANSACTION_TTL_MS - 1 }),
    );
    expect(pose(state, tx.id)).toMatchObject({ phase: 'boarded', selectedForCandidate: true });
    state = reconcilePassengerMotion(
      state,
      snapshot([], { observedAt: OBSERVED_AT + TRACKED_TRANSACTION_TTL_MS }),
    );
    state = runFor(state, 15_000);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).projectionUsed.next).toBe(0);
  });

  it('keeps a fixed historical budget across full new samples without duplicates or invented confirmations', () => {
    const cohort = (firstId: number, feeRate: number) =>
      Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
        transaction(firstId + index, feeRate),
      );
    const first = cohort(10_000, 10);
    const second = cohort(10_000 + PENDING_SAMPLE_LIMIT, 20);
    const third = cohort(10_000 + PENDING_SAMPLE_LIMIT * 2, 30);
    const fourth = cohort(10_000 + PENDING_SAMPLE_LIMIT * 3, 40);
    let state = advancePassengerMotion(createPassengerMotion(snapshot(first)), 100, {
      reducedMotion: true,
    });
    state = reconcilePassengerMotion(state, snapshot(second, { observedAt: OBSERVED_AT + 3_000 }));
    state = advancePassengerMotion(state, 100, { reducedMotion: true });
    expect(passengerFrame(state).passengers).toHaveLength(PENDING_SAMPLE_LIMIT * 2);
    expect(passengerFrame(state).passengers.filter((rider) => !rider.sourceObserved)).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );

    state = reconcilePassengerMotion(state, snapshot(third, { observedAt: OBSERVED_AT + 6_000 }));
    state = advancePassengerMotion(state, 100, { reducedMotion: true });
    const threeSamples = passengerFrame(state);
    const retained = threeSamples.passengers.filter(
      (rider) => !rider.sourceObserved && rider.inWagon,
    );
    expect(MAX_RESIDENT_PASSENGERS).toBe(3_840);
    expect(threeSamples.passengers).toHaveLength(MAX_RESIDENT_PASSENGERS);
    expect(new Set(threeSamples.passengers.map(({ tx }) => tx.id)).size).toBe(
      MAX_RESIDENT_PASSENGERS,
    );
    expect(retained).toHaveLength(MAX_INDIVIDUAL_HISTORY);
    expect(new Set(retained.map(({ tx }) => tx.id))).toEqual(new Set(second.map(({ id }) => id)));
    expect(threeSamples.passengers.filter((rider) => rider.sourceObserved)).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );
    const originalDates = new Map([
      ...first.map(({ id }) => [id, OBSERVED_AT] as const),
      ...second.map(({ id }) => [id, OBSERVED_AT + 3_000] as const),
      ...third.map(({ id }) => [id, OBSERVED_AT + 6_000] as const),
    ]);
    expect(
      threeSamples.passengers.every(
        (rider) =>
          rider.tx.status === 'pending' &&
          rider.tx.blockHash === undefined &&
          rider.lastObservedAt === originalDates.get(rider.tx.id),
      ),
    ).toBe(true);
    expect(threeSamples.projectionUsed).toEqual({ next: MAX_RESIDENT_PASSENGERS * 200, later: 0 });
    expect(threeSamples.candidateCapacity).toBe(1_000_000);
    expect(threeSamples.waitingArchiveCount).toBe(PENDING_SAMPLE_LIMIT);

    state = reconcilePassengerMotion(state, snapshot(fourth, { observedAt: OBSERVED_AT + 9_000 }));
    state = advancePassengerMotion(state, 100, { reducedMotion: true });
    const frame = passengerFrame(state);
    const older = frame.passengers.filter((rider) => !rider.sourceObserved);
    expect(frame.passengers).toHaveLength(MAX_RESIDENT_PASSENGERS);
    expect(new Set(frame.passengers.map(({ tx }) => tx.id)).size).toBe(MAX_RESIDENT_PASSENGERS);
    expect(older).toHaveLength(MAX_INDIVIDUAL_HISTORY);
    expect(older.every((rider) => rider.inWagon && rider.tx.status === 'pending')).toBe(true);
    expect(new Set(older.map(({ tx }) => tx.id))).toEqual(new Set(third.map(({ id }) => id)));
    expect(older.every((rider) => rider.lastObservedAt === originalDates.get(rider.tx.id))).toBe(
      true,
    );
    expect(
      new Set(frame.passengers.filter((rider) => rider.sourceObserved).map(({ tx }) => tx.id)),
    ).toEqual(new Set(fourth.map(({ id }) => id)));
    expect(frame.projectionUsed).toEqual({ next: MAX_RESIDENT_PASSENGERS * 200, later: 0 });
    const archivedCount = PENDING_SAMPLE_LIMIT * 2;
    expect(frame.waitingArchiveCount).toBe(archivedCount);
    const archivedLimit = Math.min(archivedCount, MAX_ARCHIVED_OBSERVATIONS);
    expect(state.waitingArchiveTransactions.size).toBe(archivedLimit);
    expect(frame.waitingArchiveTrackedCount).toBe(archivedLimit);
    expect(frame.waitingArchiveUnknownCount).toBe(archivedCount - archivedLimit);
    expect(
      [...state.waitingArchiveTransactions.values()].every(
        ({ tx, lastSeenAt }) =>
          tx.status === 'pending' &&
          tx.blockHash === undefined &&
          second.some(({ id }) => id === tx.id) &&
          lastSeenAt === OBSERVED_AT + 3_000,
      ),
    ).toBe(true);
    const residentIds = new Set(frame.passengers.map(({ tx }) => tx.id));
    expect([...state.waitingArchiveTransactions.keys()].every((id) => !residentIds.has(id))).toBe(
      true,
    );
    expect(state.queuedDepartures).toEqual([]);
    expect(state.departingPassengers).toEqual([]);
    expect(state.pendingAdmissions).toEqual([]);
  });
});
