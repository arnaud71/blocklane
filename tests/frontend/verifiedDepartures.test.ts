import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Block, type Snapshot, type Tx } from '../../shared/model';
import {
  CANDIDATE_ARRIVAL_DURATION_MS,
  HANDOFF_DURATION_MS,
  preparationDurationMs,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';

const OBSERVED_AT = 1_700_000_000_000;

function identifier(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function transaction(value: number, feeRate = 100): Tx {
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

function block(height = 100, fork = 0): Block {
  return {
    height,
    hash: identifier(10_000 + height + fork * 1_000),
    timestamp: Math.floor(OBSERVED_AT / 1_000) + (height - 100) * 12,
    txCount: 150,
    used: 15_000_000,
    capacity: 30_000_000,
  };
}

/** Every observation goes through the public live-data contract, without real provider calls. */
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur Ethereum contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Échantillon limité et preuves exactes provenant du fournisseur observé.',
    pendingCount: 5_000,
    feeRate: 20,
    feeUnit: 'Gwei',
    transactions,
    blocks: [block()],
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

function observeInclusion(
  state: PassengerMotionState,
  included: Tx,
  overrides: Partial<Snapshot> = {},
): PassengerMotionState {
  const mined = block(101);
  return reconcilePassengerMotion(
    state,
    snapshot([], {
      observedAt: OBSERVED_AT + 3_000,
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: [included.id] }],
      ...overrides,
    }),
  );
}

function expectNoWaitingCopy(state: PassengerMotionState, id: string): void {
  expect(passengerFrame(state).passengers.some(({ tx }) => tx.id === id)).toBe(false);
  expect(state.pendingAdmissions.some(({ tx }) => tx.id === id)).toBe(false);
  expect(state.waitingArchiveTransactions.has(id)).toBe(false);
}

describe('Verified transaction departures', () => {
  it('does not admit a stale pending row already proved included in the initial journal', () => {
    const included = transaction(1);
    const unknown = transaction(2, 10);
    const mined = block();
    let state = createPassengerMotion(
      snapshot([included, unknown], {
        inclusions: [{ block: mined, transactionIds: [included.id] }],
      }),
    );
    state = runFor(state, 15_000);
    expectNoWaitingCopy(state, included.id);
    expect(passengerFrame(state).passengers.map(({ tx }) => tx.id)).toEqual([unknown.id]);
    expect(passengerFrame(state).waitingArchiveCount).toBe(0);
    expect(state.queuedDepartures).toEqual([]);
  });

  it('recovers a waiting historical traveller from a later proof of an older exact block', () => {
    const included = transaction(3);
    const unknown = transaction(4, 90);
    let state = runFor(
      createPassengerMotion(snapshot([included, unknown], { feeRate: 200 })),
      15_000,
    );
    state = reconcilePassengerMotion(
      state,
      snapshot([], { blocks: [block(102)], feeRate: 200, observedAt: OBSERVED_AT + 3_000 }),
    );
    state = runFor(state, 1_000);
    expect(passengerFrame(state).passengers.every((person) => !person.sourceObserved)).toBe(true);
    state = observeInclusion(state, included, {
      blocks: [block(102)],
      feeRate: 200,
      observedAt: OBSERVED_AT + 6_000,
    });
    expect(passengerFrame(state).departureRecovered).toBe(true);
    state = runFor(state, preparationDurationMs(included.chain));
    expect(passengerFrame(state).departingPassengers).toMatchObject([
      { tx: { id: included.id, status: 'confirmed', blockHash: block(101).hash } },
    ]);
    state = runFor(state, HANDOFF_DURATION_MS + CANDIDATE_ARRIVAL_DURATION_MS);
    expectNoWaitingCopy(state, included.id);
    expect(passengerFrame(state).passengers).toMatchObject([
      { tx: { id: unknown.id, status: 'pending' }, sourceObserved: false },
    ]);
  });

  it('does not readmit an old pending response during or after a completed exact departure', () => {
    const included = transaction(5);
    let state = runFor(createPassengerMotion(snapshot([included])), 15_000);
    state = observeInclusion(state, included);
    state = runFor(state, preparationDurationMs(included.chain));
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    const replay = snapshot([included], {
      blocks: [block(101)],
      observedAt: OBSERVED_AT + 6_000,
    });
    state = reconcilePassengerMotion(state, replay);
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    state = runFor(state, HANDOFF_DURATION_MS + CANDIDATE_ARRIVAL_DURATION_MS);
    expectNoWaitingCopy(state, included.id);
    for (let replayIndex = 1; replayIndex <= 3; replayIndex += 1) {
      state = reconcilePassengerMotion(
        state,
        snapshot([included], {
          blocks: [block(101)],
          observedAt: OBSERVED_AT + 6_000 + replayIndex * 3_000,
        }),
      );
      state = runFor(state, 1_000);
      expectNoWaitingCopy(state, included.id);
      expect(passengerFrame(state).departingPassengers).toEqual([]);
      expect(state.queuedDepartures).toEqual([]);
      expect(passengerFrame(state).waitingArchiveCount).toBe(0);
      expect(passengerFrame(state).projectionCount).toEqual({ next: 0, later: 0 });
    }
  });

  it.each([
    ['preparation', 100],
    ['departure', preparationDurationMs('ethereum') + 100],
  ] as const)(
    'does not restore proved travellers when reduced motion begins during %s',
    (_, elapsed) => {
      const included = transaction(6);
      const unknown = transaction(7, 10);
      let state = runFor(createPassengerMotion(snapshot([included, unknown])), 15_000);
      state = observeInclusion(state, included);
      state = runFor(state, elapsed);
      const clock = state.elapsedMs;
      state = advancePassengerMotion(state, 0, { reducedMotion: true });
      expect(state.elapsedMs).toBe(clock);
      expectNoWaitingCopy(state, included.id);
      expect(passengerFrame(state).departingPassengers).toEqual([]);
      expect(state.queuedDepartures).toEqual([]);
      expect(state.preparationTransactions).toEqual([]);
      expect(passengerFrame(state).passengers).toMatchObject([
        {
          tx: { id: unknown.id, status: 'pending' },
          sourceObserved: false,
          lastObservedAt: OBSERVED_AT,
        },
      ]);
      expect(passengerFrame(state).waitingArchiveCount).toBe(0);
      state = reconcilePassengerMotion(
        state,
        snapshot([included], { blocks: [block(101)], observedAt: OBSERVED_AT + 6_000 }),
      );
      state = advancePassengerMotion(state, 0, { reducedMotion: true });
      expectNoWaitingCopy(state, included.id);
    },
  );

  it('consumes a proved inclusion directly when reduced motion was active before the block', () => {
    const included = transaction(8);
    let state = advancePassengerMotion(createPassengerMotion(snapshot([included])), 0, {
      reducedMotion: true,
    });
    state = observeInclusion(state, included);
    state = advancePassengerMotion(state, 0, { reducedMotion: true });
    expectNoWaitingCopy(state, included.id);
    expect(passengerFrame(state).departingPassengers).toEqual([]);
    expect(state.elapsedMs).toBe(0);
  });

  it.each(['replacement', 'rewind'] as const)(
    'allows a real pending return when the consumed receipt is contradicted by a %s',
    (change) => {
      const included = transaction(9);
      let state = runFor(createPassengerMotion(snapshot([included])), 15_000);
      state = observeInclusion(state, included);
      state = runFor(
        state,
        preparationDurationMs(included.chain) + HANDOFF_DURATION_MS + CANDIDATE_ARRIVAL_DURATION_MS,
      );
      expectNoWaitingCopy(state, included.id);
      const replacement = change === 'replacement' ? block(101, 1) : block();
      state = reconcilePassengerMotion(
        state,
        snapshot([included], {
          blocks: [replacement],
          observedAt: OBSERVED_AT + 6_000,
        }),
      );
      state = runFor(state, 15_000);
      expect(passengerFrame(state).passengers).toMatchObject([
        { tx: { id: included.id, status: 'pending' }, sourceObserved: true, inWagon: true },
      ]);
      expect(state.handledDepartures.some((receipt) => receipt.hash === block(101).hash)).toBe(
        false,
      );
      expect(passengerFrame(state).waitingArchiveCount).toBe(0);
    },
  );

  it.each(['replacement', 'rewind'] as const)(
    'does not overwrite a pending return with a cancelled preparation after a %s',
    (change) => {
      const included = transaction(12);
      let state = runFor(createPassengerMotion(snapshot([included])), 15_000);
      state = observeInclusion(state, included);
      state = runFor(state, 100);
      expect(state.preparationStartedAt).not.toBeNull();
      const replacement = change === 'replacement' ? block(101, 1) : block();
      state = reconcilePassengerMotion(
        state,
        snapshot([included], {
          blocks: [replacement],
          observedAt: OBSERVED_AT + 6_000,
        }),
      );
      expect(state.preparationStartedAt).toBeNull();
      expect(passengerFrame(state).passengers).toMatchObject([
        { tx: { id: included.id, status: 'pending' }, sourceObserved: true },
      ]);
      state = runFor(state, 15_000);
      expect(passengerFrame(state).passengers).toMatchObject([
        { tx: { id: included.id, status: 'pending' }, phase: 'boarded', inWagon: true },
      ]);
      expect(passengerFrame(state).departingPassengers).toEqual([]);
    },
  );

  it.each([false, true])(
    'keeps absence without inclusion evidence unknown (reduced motion: %s)',
    (reducedMotion) => {
      const unknown = transaction(10, 10);
      let state = runFor(createPassengerMotion(snapshot([unknown])), 15_000);
      state = reconcilePassengerMotion(
        state,
        snapshot([], { blocks: [block(101)], observedAt: OBSERVED_AT + 3_000 }),
      );
      state = reducedMotion
        ? advancePassengerMotion(state, 0, { reducedMotion })
        : runFor(state, 15_000);
      expect(passengerFrame(state).passengers).toMatchObject([
        {
          tx: { id: unknown.id, status: 'pending' },
          sourceObserved: false,
          lastObservedAt: OBSERVED_AT,
          inWagon: false,
        },
      ]);
      expect(passengerFrame(state).departingPassengers).toEqual([]);
    },
  );

  it('retains an old reported status without an exact inclusion proof as an observation', () => {
    const unknown = transaction(11, 10);
    let state = runFor(createPassengerMotion(snapshot([unknown])), 15_000);
    state = reconcilePassengerMotion(
      state,
      snapshot([{ ...unknown, status: 'confirmed' }], { observedAt: OBSERVED_AT + 3_000 }),
    );
    state = reconcilePassengerMotion(state, snapshot([], { observedAt: OBSERVED_AT + 6_000 }));
    state = advancePassengerMotion(state, 0, { reducedMotion: true });
    expect(passengerFrame(state).passengers).toMatchObject([
      {
        tx: { id: unknown.id, status: 'confirmed' },
        sourceObserved: false,
        lastObservedAt: OBSERVED_AT + 3_000,
        inWagon: false,
      },
    ]);
    expect(state.handledDepartures.flatMap((receipt) => receipt.transactionIds)).not.toContain(
      unknown.id,
    );
  });
});
