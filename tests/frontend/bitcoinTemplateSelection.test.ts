import { describe, expect, it } from 'vitest';
import {
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type BitcoinBlockTemplate,
  type Block,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  preparationDurationMs,
  activeBitcoinBlockTemplate,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';

const OBSERVED_AT = 1_700_000_000_000;
const identifier = (value: number) => value.toString(16).padStart(64, '0');

function transaction(value: number, feeRate = 20, size = 200): Tx {
  return {
    id: identifier(value),
    chain: 'bitcoin',
    status: 'pending',
    feeRate,
    size,
    kind: 'transfer',
    value: '0.01 BTC',
  };
}

function block(height = 100, fork = 0): Block {
  return {
    hash: identifier(100_000 + height + fork * 1_000),
    height,
    timestamp: OBSERVED_AT / 1_000 - 12 + (height - 100) * 12,
    txCount: 1_000,
    used: 500_000,
    capacity: 1_000_000,
  };
}

function template(
  members: Tx[],
  parent = block(),
  observedAt = OBSERVED_AT,
  overrides: Partial<BitcoinBlockTemplate> = {},
): BitcoinBlockTemplate {
  return {
    source: 'Nœud Bitcoin contrôlé · getblocktemplate',
    observedAt,
    height: parent.height + 1,
    previousBlockHash: parent.hash,
    transactionCount: members.length,
    weight: members.reduce((total, tx) => total + tx.size * 4, 0),
    weightLimit: 4_000_000,
    selectedTransactionIds: members.map((tx) => tx.id),
    ...overrides,
  };
}

/** A template is explicit proposed membership, independent of real inclusion receipts. */
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur Bitcoin contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Échantillon limité ; un candidat du nœud ne prouve aucune confirmation.',
    pendingCount: 10_000,
    feeRate: 10,
    feeUnit: 'sat/vB',
    transactions,
    blocks: [block()],
    inclusions: [],
    ...overrides,
  });
}

function settle(state: PassengerMotionState) {
  return advancePassengerMotion(state, 0, { reducedMotion: true });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, durationMs - elapsed));
  return next;
}

function pose(state: PassengerMotionState, id: string) {
  const person = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!person) throw new Error(`Voyageur attendu absent : ${id}`);
  return person;
}

describe('Bitcoin node template projection', () => {
  it('boards current members without turning a proposed candidate into a confirmation or departure', () => {
    const member = transaction(1, 2);
    const source = snapshot([member], { blockTemplate: template([member]) });
    let state = createPassengerMotion(source);
    state = runFor(state, 15_000);
    expect(pose(state, member.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      sourceObserved: true,
      tx: { status: 'pending' },
    });
    expect(state.blockTemplate).toBe(source.blockTemplate);
    expect(passengerFrame(state).projectionUsed).toEqual({ next: member.size, later: 0 });
    expect(state.preparationTransactions).toEqual([]);
    expect(state.queuedDepartures).toEqual([]);
    expect(passengerFrame(state).departingPassengers).toEqual([]);
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
  });

  it('moves an already boarded historical nonmember to the second estimate even when the first has free native space', () => {
    const outside = transaction(2, 100);
    const member = transaction(3, 1);
    let state = runFor(createPassengerMotion(snapshot([outside, member])), 15_000);
    expect(pose(state, outside.id).wagon).toBe('next');
    state = reconcilePassengerMotion(
      state,
      snapshot([member], {
        observedAt: OBSERVED_AT + 3_000,
        blockTemplate: template([member], block(), OBSERVED_AT + 3_000),
      }),
    );
    state = runFor(state, 18_000);
    expect(pose(state, member.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    expect(pose(state, outside.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: outside,
    });
    expect(passengerFrame(state).projectionCount).toEqual({ next: 1, later: 1 });
    expect(state.preparationTransactions).toEqual([]);
  });

  it('brings a known lower-fee member from the second wagon into the first and sends its nonmember peer outside it', () => {
    const outside = transaction(4, 100, 600_000);
    const member = transaction(5, 1, 600_000);
    let state = settle(createPassengerMotion(snapshot([outside, member])));
    expect(pose(state, member.id).wagon).toBe('later');
    state = reconcilePassengerMotion(
      state,
      snapshot([member], {
        observedAt: OBSERVED_AT + 3_000,
        blockTemplate: template([member], block(), OBSERVED_AT + 3_000),
      }),
    );
    state = runFor(state, 18_000);
    expect(pose(state, member.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    expect(pose(state, outside.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      sourceObserved: false,
    });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 600_000, later: 600_000 });
  });

  it('allows an exact known template member that never boarded before while keeping its historical provenance', () => {
    const first = transaction(6, 100, 600_000);
    const second = transaction(7, 90, 600_000);
    const queued = transaction(8, 1, 600_000);
    let state = settle(createPassengerMotion(snapshot([first, second, queued])));
    expect(pose(state, queued.id)).toMatchObject({ phase: 'queue', inWagon: false });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: OBSERVED_AT + 3_000,
          blockTemplate: template([queued], block(), OBSERVED_AT + 3_000),
        }),
      ),
    );
    expect(pose(state, queued.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'next',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: queued,
    });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 600_000, later: 600_000 });
    expect(passengerFrame(state).passengers.every(({ tx }) => tx.status === 'pending')).toBe(true);
  });

  it('leaves the first wagon empty when a valid node candidate selects no known transaction', () => {
    const historical = transaction(9);
    let state = settle(createPassengerMotion(snapshot([historical])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: OBSERVED_AT + 3_000,
          blockTemplate: template([], block(), OBSERVED_AT + 3_000),
        }),
      ),
    );
    expect(pose(state, historical.id)).toMatchObject({ wagon: 'later', sourceObserved: false });
    expect(passengerFrame(state).projectionCount).toEqual({ next: 0, later: 1 });
  });

  it('restores the existing fee-and-capacity allocator as soon as the provider falls back without a template', () => {
    const historical = transaction(10, 100);
    const member = transaction(11, 20);
    const newcomer = transaction(12, 10);
    let state = settle(createPassengerMotion(snapshot([historical, member])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([member], {
          observedAt: OBSERVED_AT + 3_000,
          blockTemplate: template([member], block(), OBSERVED_AT + 3_000),
        }),
      ),
    );
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([member, newcomer], { observedAt: OBSERVED_AT + 6_000 }),
      ),
    );
    expect(state.blockTemplate).toBeNull();
    expect(pose(state, historical.id)).toMatchObject({ wagon: 'later', sourceObserved: false });
    expect(pose(state, member.id).wagon).toBe('next');
    expect(pose(state, newcomer.id).wagon).toBe('next');
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 400, later: 200 });
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
  });

  it('keeps the first projection within the node weight policy even with conservative per-transaction vB rounding', () => {
    const first = transaction(13, 20, 250);
    const second = transaction(14, 10, 250);
    const source = snapshot([first, second], {
      // Two weights of 999 WU fit; summing their rounded 250-vB sizes is conservative.
      blockTemplate: template([first, second], block(), OBSERVED_AT, {
        weight: 1_998,
        weightLimit: 1_999,
      }),
    });
    const state = settle(createPassengerMotion(source));
    expect(pose(state, first.id).wagon).toBe('next');
    expect(pose(state, second.id).inWagon).toBe(false);
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 250, later: 0 });
    expect(passengerFrame(state).projectionUsed.next).toBeLessThanOrEqual(1_999 / 4);
  });

  it('revokes outdated, unavailable and wrong-parent candidates instead of retaining their membership indefinitely', () => {
    const member = transaction(15);
    const source = snapshot([member], { blockTemplate: template([member]) });
    expect(activeBitcoinBlockTemplate(source)).toBe(source.blockTemplate);
    expect(activeBitcoinBlockTemplate({ ...source, observedAt: OBSERVED_AT + 30_000 })).toBe(
      source.blockTemplate,
    );
    expect(activeBitcoinBlockTemplate({ ...source, observedAt: OBSERVED_AT + 30_001 })).toBeNull();
    expect(activeBitcoinBlockTemplate({ ...source, status: 'stale' })).toBeNull();
    expect(activeBitcoinBlockTemplate({ ...source, mode: 'demo' })).toBeNull();
    expect(activeBitcoinBlockTemplate({ ...source, blocks: [block(100, 1)] })).toBeNull();
    expect(activeBitcoinBlockTemplate({ ...source, blocks: [block(101)] })).toBeNull();
    expect(activeBitcoinBlockTemplate({ ...source, observedAt: OBSERVED_AT - 1 })).toBeNull();
    const aged = snapshot([member], {
      observedAt: OBSERVED_AT + 30_001,
      blockTemplate: source.blockTemplate,
    });
    expect(createPassengerMotion(aged).blockTemplate).toBeNull();
    expect(snapshotSchema.safeParse({ ...source, blocks: [block(100, 1)] }).success).toBe(false);
  });

  it('reroutes a known nonmember before promotion while preserving the new-parent membership and provenance', () => {
    const included = transaction(16, 100, 600_000);
    const historical = transaction(17, 90, 600_000);
    const member = transaction(18, 10, 200);
    let state = settle(createPassengerMotion(snapshot([included, historical])));
    const mined = block(101);
    const source = snapshot([member], {
      observedAt: OBSERVED_AT + 3_000,
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: [included.id] }],
      blockTemplate: template([member], mined, OBSERVED_AT + 3_000),
    });
    state = reconcilePassengerMotion(state, source);
    state = runFor(state, preparationDurationMs(source.chain));
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    expect(pose(state, historical.id)).toMatchObject({ inHandoff: false, inWagon: false });
    state = reconcilePassengerMotion(state, { ...source, observedAt: OBSERVED_AT + 4_000 });
    state = runFor(state, 500);
    expect(pose(state, historical.id)).toMatchObject({ inHandoff: false, inWagon: false });
    state = runFor(state, 18_000);
    expect(state.blockTemplate).toBe(source.blockTemplate);
    expect(pose(state, historical.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: historical,
    });
    expect(pose(state, member.id)).toMatchObject({ phase: 'boarded', wagon: 'next' });
    expect(passengerFrame(state).passengers.some(({ tx }) => tx.id === included.id)).toBe(false);
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 200, later: 600_000 });
  });

  it('revokes a candidate on a same-height reorganization and does not invent inclusion from the new parent', () => {
    const member = transaction(19);
    const newcomer = transaction(20);
    let state = settle(
      createPassengerMotion(snapshot([member], { blockTemplate: template([member]) })),
    );
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([member, newcomer], {
          observedAt: OBSERVED_AT + 3_000,
          blocks: [block(100, 1)],
        }),
      ),
    );
    expect(state.blockTemplate).toBeNull();
    expect(passengerFrame(state).projectionCount).toEqual({ next: 2, later: 0 });
    expect(passengerFrame(state).passengers.every(({ tx }) => tx.status === 'pending')).toBe(true);
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
    expect(state.preparationTransactions).toEqual([]);
  });

  it('honors pause, reduced movement and the 5× clock without changing an historical observation into a current one', () => {
    const historical = transaction(21);
    const member = transaction(22);
    let state = settle(createPassengerMotion(snapshot([historical, member])));
    const before = pose(state, historical.id);
    state = reconcilePassengerMotion(
      state,
      snapshot([member], {
        observedAt: OBSERVED_AT + 3_000,
        blockTemplate: template([member], block(), OBSERVED_AT + 3_000),
      }),
    );
    const paused = advancePassengerMotion(state, 5_000, { paused: true, speed: 5 });
    expect(paused).toBe(state);
    expect(pose(paused, historical.id)).toMatchObject({ x: before.x, y: before.y });
    const faster = advancePassengerMotion(paused, 100, { speed: 5 });
    expect(faster.elapsedMs - paused.elapsedMs).toBe(500);
    state = settle(faster);
    expect(pose(state, historical.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      tx: historical,
    });
    expect(pose(state, member.id).wagon).toBe('next');
  });

  it('allows recent node membership to supersede historical candidacy expiry without refreshing individual details', () => {
    const historical = transaction(23);
    let state = settle(createPassengerMotion(snapshot([historical])));
    const observedAt = OBSERVED_AT + TRACKED_TRANSACTION_TTL_MS;
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt,
          blockTemplate: template([historical], block(), observedAt),
        }),
      ),
    );
    expect(pose(state, historical.id)).toMatchObject({
      inWagon: true,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
      selectedForCandidate: true,
      tx: historical,
    });
    expect(passengerFrame(state).projectionUsed).toEqual({ next: historical.size, later: 0 });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], { observedAt: observedAt + 3_000, blockTemplate: null }),
      ),
    );
    expect(pose(state, historical.id)).toMatchObject({
      inWagon: false,
      selectedForCandidate: false,
      sourceObserved: false,
      lastObservedAt: OBSERVED_AT,
    });
  });
});
