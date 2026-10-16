import { describe, expect, it } from 'vitest';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  HANDOFF_DURATION_MS,
  NETWORK_DOOR_OPEN_MS,
  NETWORK_SIGNAL_LEAD_MS,
  NETWORK_DOOR_BEFORE_PASSAGE_MS,
  PREPARATION_DURATION_MS,
  WAITING_ARCHIVE_POSITION,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  preparationDurationMs,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { passengerDescription } from '../../src/lib/passengerPresentation';
import {
  NETWORK_BOX_RECT,
  ACTIVE_QUEUE_AREA,
  NETWORK_VESTIBULE_Y,
  PLATFORM_CORRIDOR_X,
  networkBoxBoardingPath,
  networkBoxExit,
  arrivalStart,
  queuePosition,
} from '../../src/lib/streetGeometry';

const OBSERVED_AT = 1_700_000_000_000;
const NETWORK_PRELUDE_MS = NETWORK_SIGNAL_LEAD_MS + NETWORK_DOOR_BEFORE_PASSAGE_MS;
const identifier = (chain: ChainId, value: number) =>
  `${chain === 'ethereum' ? '0x' : ''}${value.toString(16).padStart(64, '0')}`;

function transaction(chain: ChainId, value: number): Tx {
  return {
    id: identifier(chain, value),
    chain,
    feeRate: 0,
    size: chain === 'ethereum' ? 21_000 : 200,
    status: 'pending',
    kind: 'transfer',
    value: 'Valeur réellement fournie',
  };
}

function block(chain: ChainId, height = 100): Block {
  return {
    hash: identifier(chain, 10_000 + height),
    height,
    timestamp: OBSERVED_AT / 1_000 + (height - 100) * 12,
    txCount: 150,
    used: chain === 'ethereum' ? 15_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 30_000_000 : 1_000_000,
  };
}

function snapshot(
  chain: ChainId,
  transactions: Tx[] = [],
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Échantillon borné ; seules les inclusions exactes sont confirmées.',
    pendingCount: 5_000,
    feeRate: 20,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions,
    blocks: [block(chain)],
    inclusions: [],
    ...overrides,
  });
}

function inclusionSnapshot(chain: ChainId, tx: Tx, observedAt = OBSERVED_AT + 3_000): Snapshot {
  const mined = block(chain, 101);
  return snapshot(chain, [{ ...tx, status: 'confirmed', blockHash: mined.hash }], {
    observedAt,
    blocks: [mined],
    inclusions: [{ block: mined, transactionIds: [tx.id] }],
  });
}

function runFor(state: PassengerMotionState, duration: number): PassengerMotionState {
  let next = state;
  for (let elapsed = 0; elapsed < duration; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, duration - elapsed));
  return next;
}

function stoppedScene(chain: ChainId): PassengerMotionState {
  return runFor(createPassengerMotion(snapshot(chain)), 1_000);
}

describe('Network remainder as the origin of late exact inclusions', () => {
  it.each(['bitcoin', 'ethereum'] as const)(
    'brings a newly discovered %s inclusion from the box through the quay and upper door',
    (chain) => {
      const tx = transaction(chain, 1);
      let state = reconcilePassengerMotion(stoppedScene(chain), inclusionSnapshot(chain, tx));
      const frame = passengerFrame(state);
      const passenger = frame.passengers[0]!;
      const preparationMs = preparationDurationMs(chain);
      expect(frame.passengers).toHaveLength(1);
      expect(passenger).toMatchObject({
        tx: { id: tx.id, status: 'confirmed', blockHash: block(chain, 101).hash },
        arrivalKind: 'late-inclusion',
        phase: 'preparing',
        ...networkBoxExit(),
      });
      expect(state.passengers[0]!.path).toEqual(networkBoxBoardingPath(0));
      expect(state.passengers[0]!.durationMs).toBe(preparationMs - NETWORK_PRELUDE_MS);
      expect(state.passengers[0]!.phaseStartedAt).toBe(state.elapsedMs + NETWORK_PRELUDE_MS);
      expect(passenger.opacity).toBe(0);
      expect(frame.networkDoorProgress).toBe(0);
      expect(
        state.passengers[0]!.path.slice(0, -2).every((point) => point.x >= PLATFORM_CORRIDOR_X),
      ).toBe(true);
      expect(networkBoxExit()).toEqual({
        x: NETWORK_BOX_RECT.x + NETWORK_BOX_RECT.width / 2,
        y: NETWORK_BOX_RECT.y + NETWORK_BOX_RECT.height,
      });
      expect(passengerDescription(passenger)).toContain(
        'Inclusion découverte hors de l’échantillon',
      );
      expect(passengerDescription(passenger)).toContain('ne date pas son arrivée réelle');

      expect(advancePassengerMotion(state, 100, { paused: true })).toBe(state);
      expect(advancePassengerMotion(state, 100, { hidden: true })).toBe(state);
      state = runFor(state, preparationMs - 100);
      expect(passengerFrame(state).departingPassengers).toHaveLength(0);
      state = runFor(state, 100);
      expect(passengerFrame(state).departingPassengers).toMatchObject([
        { tx: { id: tx.id, status: 'confirmed' }, arrivalKind: 'late-inclusion' },
      ]);
      state = runFor(state, HANDOFF_DURATION_MS);
      state = reconcilePassengerMotion(state, inclusionSnapshot(chain, tx, OBSERVED_AT + 6_000));
      expect(passengerFrame(state).passengers).toHaveLength(0);
      expect(passengerFrame(state).departingPassengers).toHaveLength(0);
      expect(state.preparationStartedAt).toBeNull();
    },
  );

  it('preserves an existing waiting traveller instead of recreating it at the box', () => {
    const tx = transaction('ethereum', 2);
    let state = createPassengerMotion(snapshot('ethereum', [tx]));
    const before = passengerFrame(state).passengers[0]!;
    state = reconcilePassengerMotion(state, inclusionSnapshot('ethereum', tx));
    const after = passengerFrame(state).passengers[0]!;
    expect(after).toMatchObject({
      tx: { id: tx.id, status: 'confirmed' },
      arrivalKind: 'initial-stock',
      opacity: 1,
      x: before.x,
      y: before.y,
    });
    expect(state.passengers[0]!.path[0]).toEqual({ x: before.x, y: before.y });
    expect(after.arrivalKind).not.toBe('late-inclusion');
    expect(state.passengers).toHaveLength(1);
  });

  it.each([
    { chain: 'bitcoin' as const, preparationMs: 3_000 },
    { chain: 'ethereum' as const, preparationMs: 1_500 },
  ])(
    'prepares $chain for $preparationMs ms without changing its network prelude',
    ({ chain, preparationMs }) => {
      const tx = transaction(chain, 20);
      let state = reconcilePassengerMotion(stoppedScene(chain), inclusionSnapshot(chain, tx));
      const startedAt = state.preparationStartedAt!;
      expect(preparationDurationMs(chain)).toBe(preparationMs);
      expect(state.passengers[0]!.phaseStartedAt).toBe(startedAt + 320);
      state = runFor(state, preparationMs - 1);
      expect(state.preparationStartedAt).toBe(startedAt);
      expect(state.lastDepartureStartedAt).toBeNull();
      expect(passengerFrame(state).departingPassengers).toHaveLength(0);
      expect(passengerFrame(state).preparationProgress).toBeLessThan(1);
      expect(advancePassengerMotion(state, 100, { paused: true })).toBe(state);
      expect(advancePassengerMotion(state, 100, { hidden: true })).toBe(state);
      state = advancePassengerMotion(state, 1);
      expect(state.preparationStartedAt).toBeNull();
      expect(state.lastDepartureStartedAt).toBe(startedAt + preparationMs);
      expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([tx.id]);
    },
  );

  it('adds a Bitcoin inclusion received after two seconds to the original departure without replay', () => {
    const first = transaction('bitcoin', 21);
    const complement = transaction('bitcoin', 22);
    let state = reconcilePassengerMotion(
      stoppedScene('bitcoin'),
      inclusionSnapshot('bitcoin', first),
    );
    const startedAt = state.preparationStartedAt!;
    const originalPath = state.passengers[0]!.path;
    state = runFor(state, 2_000);
    expect(state.lastDepartureStartedAt).toBeNull();
    const source = inclusionSnapshot('bitcoin', complement, OBSERVED_AT + 6_000);
    const updated = {
      ...source,
      inclusions: [{ block: block('bitcoin', 101), transactionIds: [first.id, complement.id] }],
    };
    state = reconcilePassengerMotion(state, updated);
    const added = state.passengers.find(({ tx }) => tx.id === complement.id)!;
    expect(added).toMatchObject({
      arrivalKind: 'late-inclusion',
      phase: 'preparing',
      phaseStartedAt: startedAt + 2_320,
      durationMs: 680,
    });
    expect(state.preparationStartedAt).toBe(startedAt);
    expect(state.preparationTransactions.map(({ id }) => id).sort()).toEqual(
      [first.id, complement.id].sort(),
    );
    expect(state.passengers.find(({ tx }) => tx.id === first.id)!.path).toBe(originalPath);
    state = runFor(state, 999);
    expect(state.lastDepartureStartedAt).toBeNull();
    state = advancePassengerMotion(state, 1);
    expect(state.lastDepartureStartedAt).toBe(startedAt + 3_000);
    expect(
      passengerFrame(state)
        .departingPassengers.map(({ tx }) => tx.id)
        .sort(),
    ).toEqual([first.id, complement.id].sort());
    state = runFor(state, HANDOFF_DURATION_MS + 1_000);
    state = reconcilePassengerMotion(state, updated);
    expect(state.preparationStartedAt).toBeNull();
    expect(passengerFrame(state).departingPassengers).toHaveLength(0);
    expect(state.lastDepartureStartedAt).toBe(startedAt + 3_000);
  });

  it('keeps an already boarded traveller inside its wagon', () => {
    const tx = { ...transaction('ethereum', 8), feeRate: 100 };
    let state = runFor(createPassengerMotion(snapshot('ethereum', [tx])), 15_000);
    const before = passengerFrame(state).passengers[0]!;
    expect(before.inWagon).toBe(true);
    state = reconcilePassengerMotion(state, inclusionSnapshot('ethereum', tx));
    const after = passengerFrame(state).passengers[0]!;
    expect(after).toMatchObject({
      tx: { id: tx.id, status: 'confirmed' },
      arrivalKind: 'initial-stock',
      opacity: 1,
      x: before.x,
      y: before.y,
    });
    expect(state.passengers[0]!.path[0]).toEqual({ x: before.x, y: before.y });
    expect(state.passengers).toHaveLength(1);
  });

  it('remembers a known pending admission before reconciliation consumes that queue', () => {
    const tx = transaction('ethereum', 9);
    const initial = stoppedScene('ethereum');
    const state = reconcilePassengerMotion(
      {
        ...initial,
        pendingAdmissions: [
          {
            tx,
            plannedWagon: null,
            plannedSeatIndex: 0,
            selectedForCandidate: false,
            reason: 'capacity',
          },
        ],
      },
      inclusionSnapshot('ethereum', tx),
    );
    expect(passengerFrame(state).passengers).toMatchObject([
      {
        tx: { id: tx.id, status: 'confirmed' },
        arrivalKind: 'new-observation',
        ...arrivalStart(0),
      },
    ]);
    expect(state.passengers[0]!.path[0]).toEqual(arrivalStart(0));
    expect(state.passengers[0]!.arrivalKind).not.toBe('late-inclusion');
  });

  it('restores a known archive inclusion from its existing group', () => {
    const tx = transaction('ethereum', 3);
    const initial = stoppedScene('ethereum');
    const state = reconcilePassengerMotion(
      {
        ...initial,
        waitingArchiveCount: 1,
        waitingArchiveTransactions: new Map([[tx.id, { tx, lastSeenAt: OBSERVED_AT }]]),
      },
      inclusionSnapshot('ethereum', tx),
    );
    expect(passengerFrame(state).passengers).toMatchObject([
      { tx: { id: tx.id, status: 'confirmed' }, ...WAITING_ARCHIVE_POSITION },
    ]);
    expect(state.passengers[0]!.path[0]).toEqual(WAITING_ARCHIVE_POSITION);
    expect(state.passengers[0]!.arrivalKind).not.toBe('late-inclusion');
    expect(state.waitingArchiveTransactions.has(tx.id)).toBe(false);
  });

  it('does not invent a traveller for an unknown identifier without transaction details', () => {
    const mined = block('ethereum', 101);
    let state = reconcilePassengerMotion(
      stoppedScene('ethereum'),
      snapshot('ethereum', [], {
        observedAt: OBSERVED_AT + 3_000,
        blocks: [mined],
        inclusions: [{ block: mined, transactionIds: [identifier('ethereum', 4)] }],
      }),
    );
    state = runFor(state, PREPARATION_DURATION_MS);
    expect(passengerFrame(state).passengers).toHaveLength(0);
    expect(passengerFrame(state).departingPassengers).toHaveLength(0);
  });

  it('does not stage a late arrival from stale data or animate one in reduced motion', () => {
    const tx = transaction('ethereum', 5);
    const source = inclusionSnapshot('ethereum', tx);
    const initial = stoppedScene('ethereum');
    const stale = reconcilePassengerMotion(initial, { ...source, status: 'stale' });
    expect(passengerFrame(stale).passengers).toHaveLength(0);
    const reduced = advancePassengerMotion(reconcilePassengerMotion(initial, source), 0, {
      reducedMotion: true,
    });
    expect(passengerFrame(reduced).passengers).toHaveLength(0);
    expect(passengerFrame(reduced).departingPassengers).toHaveLength(0);
    expect(reduced.preparationStartedAt).toBeNull();
  });

  it('starts a further exact discovery at the box during the remaining preparation', () => {
    const first = transaction('ethereum', 6);
    const late = transaction('ethereum', 7);
    let state = reconcilePassengerMotion(
      stoppedScene('ethereum'),
      inclusionSnapshot('ethereum', first),
    );
    state = runFor(state, 300);
    const originalPath = state.passengers[0]!.path;
    const source = inclusionSnapshot('ethereum', late, OBSERVED_AT + 6_000);
    state = reconcilePassengerMotion(state, {
      ...source,
      transactions: [...inclusionSnapshot('ethereum', first).transactions, ...source.transactions],
      inclusions: [{ block: block('ethereum', 101), transactionIds: [first.id, late.id] }],
    });
    const added = state.passengers.find(({ tx }) => tx.id === late.id)!;
    expect(added).toMatchObject({ arrivalKind: 'late-inclusion', phase: 'preparing' });
    expect(added.path[0]).toEqual(networkBoxExit());
    const remaining = PREPARATION_DURATION_MS - 300;
    expect(added.durationMs).toBe(remaining - NETWORK_PRELUDE_MS);
    expect(added.phaseStartedAt).toBe(state.elapsedMs + NETWORK_PRELUDE_MS);
    expect(passengerFrame(state).passengers.find(({ tx }) => tx.id === late.id)!.opacity).toBe(0);
    expect(state.passengers.find(({ tx }) => tx.id === first.id)!.path).toBe(originalPath);
    expect(new Set(state.passengers.map(({ tx }) => tx.id)).size).toBe(2);
    state = runFor(state, remaining);
    expect(
      passengerFrame(state)
        .departingPassengers.map(({ tx }) => tx.id)
        .sort(),
    ).toEqual([first.id, late.id].sort());
  });

  it('reserves a distinct upper network passage and keeps ordinary arrivals below it', () => {
    const path = networkBoxBoardingPath(0);
    const queue = queuePosition(0);
    expect(NETWORK_BOX_RECT).toEqual({ x: 434, y: 28, width: 26, height: 88 });
    expect(networkBoxExit()).toEqual({ x: 447, y: 116 });
    expect(path.slice(0, 3)).toEqual([
      { x: 447, y: 116 },
      { x: 447, y: NETWORK_VESTIBULE_Y },
      { x: PLATFORM_CORRIDOR_X, y: NETWORK_VESTIBULE_Y },
    ]);
    expect(path.slice(0, 3).every(({ y }) => y < ACTIVE_QUEUE_AREA.y - 40)).toBe(true);
    expect(path).not.toContainEqual(queue);
    expect(queue.y).toBe(200);
    expect(arrivalStart(0).y).toBe(200);
    expect(queuePosition(24).y).toBe(480);
  });

  it('scales the network margins only when an Ethereum complement has less than one second left', () => {
    const first = transaction('ethereum', 23);
    const late = transaction('ethereum', 24);
    let state = reconcilePassengerMotion(
      stoppedScene('ethereum'),
      inclusionSnapshot('ethereum', first),
    );
    const startedAt = state.preparationStartedAt!;
    state = runFor(state, 1_200);
    const source = inclusionSnapshot('ethereum', late, OBSERVED_AT + 6_000);
    state = reconcilePassengerMotion(state, {
      ...source,
      inclusions: [{ block: block('ethereum', 101), transactionIds: [first.id, late.id] }],
    });
    const added = state.passengers.find(({ tx }) => tx.id === late.id)!;
    expect(added).toMatchObject({
      phaseStartedAt: startedAt + 1_296,
      durationMs: 204,
      networkDoorLeadMs: 60,
    });
    expect(passengerFrame(state).passengers.find(({ tx }) => tx.id === late.id)!.opacity).toBe(0);
    state = runFor(state, 299);
    expect(state.lastDepartureStartedAt).toBeNull();
    state = advancePassengerMotion(state, 1);
    expect(state.lastDepartureStartedAt).toBe(startedAt + 1_500);
    expect(
      passengerFrame(state)
        .departingPassengers.map(({ tx }) => tx.id)
        .sort(),
    ).toEqual([first.id, late.id].sort());
  });

  it('signals before opening, reveals the newcomer after opening, and holds the clear doorway', () => {
    const tx = transaction('ethereum', 10);
    let state = reconcilePassengerMotion(
      stoppedScene('ethereum'),
      inclusionSnapshot('ethereum', tx),
    );
    const stationary = passengerFrame(state).passengers[0]!;
    expect(stationary.walkPhase).toBe(0);
    expect(stationary.opacity).toBe(0);
    expect(stationary.trail).toBeUndefined();
    expect(passengerFrame(state).networkActive).toBe(true);
    expect(passengerFrame(state).networkDoorProgress).toBe(0);
    state = runFor(state, NETWORK_SIGNAL_LEAD_MS);
    expect(passengerFrame(state).networkDoorProgress).toBe(0);
    expect(passengerFrame(state).passengers[0]).toBe(stationary);
    state = advancePassengerMotion(state, NETWORK_DOOR_OPEN_MS / 2);
    let frame = passengerFrame(state);
    expect(frame.networkDoorProgress).toBeCloseTo(0.5);
    expect(frame.passengers[0]).toMatchObject(networkBoxExit());
    expect(frame.passengers[0]).toBe(stationary);
    expect(frame.passengers[0]!.walkPhase).toBe(0);
    expect(advancePassengerMotion(state, 100, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 100, { hidden: true })).toBe(state);
    state = advancePassengerMotion(state, NETWORK_DOOR_OPEN_MS / 2);
    frame = passengerFrame(state);
    expect(frame.networkDoorProgress).toBe(1);
    expect(frame.passengers[0]).toMatchObject(networkBoxExit());
    expect(frame.passengers[0]).toBe(stationary);
    state = runFor(state, NETWORK_PRELUDE_MS - NETWORK_SIGNAL_LEAD_MS - NETWORK_DOOR_OPEN_MS - 1);
    expect(passengerFrame(state).networkDoorProgress).toBe(1);
    expect(passengerFrame(state).passengers[0]).toBe(stationary);
    state = advancePassengerMotion(state, 1);
    frame = passengerFrame(state);
    expect(frame.passengers[0]!.opacity).toBe(1);
    expect(frame.passengers[0]!.progress).toBe(0);
    expect(frame.passengers[0]!.trail).toBeUndefined();
    expect(frame.passengers[0]).not.toBe(stationary);
    state = advancePassengerMotion(state, 50);
    frame = passengerFrame(state);
    expect(frame.networkDoorProgress).toBe(1);
    expect(frame.passengers[0]!.y).toBeGreaterThan(networkBoxExit().y);
    expect(frame.passengers[0]!.y).toBeLessThanOrEqual(NETWORK_VESTIBULE_Y);
    state = runFor(state, 200);
    frame = passengerFrame(state);
    expect(frame.passengers[0]!.x).toBeLessThan(NETWORK_BOX_RECT.x - 24);
    expect(frame.networkDoorProgress).toBe(1);
    expect(frame.networkActive).toBe(true);
    state = runFor(state, 80);
    expect(passengerFrame(state).networkDoorProgress).toBe(1);
    state = advancePassengerMotion(state, 50);
    expect(passengerFrame(state).networkDoorProgress).toBeGreaterThan(0);
    expect(passengerFrame(state).networkDoorProgress).toBeLessThan(1);
    state = advancePassengerMotion(state, 80);
    frame = passengerFrame(state);
    expect(frame.networkDoorProgress).toBe(0);
    expect(frame.preparationProgress).toBeLessThan(1);
    expect(frame.passengers[0]!.x).toBeLessThan(NETWORK_BOX_RECT.x - 24);
    const reduced = advancePassengerMotion(state, 0, { reducedMotion: true });
    expect(passengerFrame(reduced).networkDoorProgress).toBe(0);
    expect(passengerFrame(reduced).networkActive).toBe(false);
    expect(reduced.preparationStartedAt).toBeNull();
  });
});
