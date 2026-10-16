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
  WAITING_ARCHIVE_POSITION,
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  preparationDurationMs,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import {
  ACTIVE_QUEUE_AREA,
  PLATFORM_CORRIDOR_X,
  networkBoxExit,
} from '../../src/lib/streetGeometry';

const OBSERVED_AT = 1_700_000_000_000;
const hash = (chain: ChainId, value: number) =>
  `${chain === 'ethereum' ? '0x' : ''}${value.toString(16).padStart(64, '0')}`;

function block(chain: ChainId, height = 100): Block {
  return {
    hash: hash(chain, 10_000 + height),
    height,
    timestamp: OBSERVED_AT / 1_000 + (height - 100) * 12,
    txCount: 200,
    used: chain === 'bitcoin' ? 800_000 : 20_000_000,
    capacity: chain === 'bitcoin' ? 1_000_000 : 30_000_000,
  };
}

function transaction(chain: ChainId, value: number): Tx {
  return {
    id: hash(chain, value),
    chain,
    status: 'pending',
    feeRate: 1,
    size: chain === 'bitcoin' ? 200 : 21_000,
    kind: 'transfer',
    value: 'Montant fourni',
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
    coverage: 'Détails limités ; seules les inclusions exactes autorisent ces départs.',
    pendingCount: 5_000,
    feeRate: 20,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [block(chain)],
    inclusions: [],
    ...overrides,
  });
}

function inclusions(chain: ChainId, details: Tx[], ids = details.map(({ id }) => id)): Snapshot {
  const mined = block(chain, 101);
  return snapshot(
    chain,
    details.map((tx) => ({ ...tx, status: 'confirmed', blockHash: mined.hash })),
    {
      observedAt: OBSERVED_AT + 3_000,
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: ids }],
    },
  );
}

function runFor(state: PassengerMotionState, duration: number): PassengerMotionState {
  for (let elapsed = 0; elapsed < duration; elapsed += 100)
    state = advancePassengerMotion(state, Math.min(100, duration - elapsed));
  return state;
}

function stopped(chain: ChainId): PassengerMotionState {
  return runFor(createPassengerMotion(snapshot(chain)), 1_000);
}

function lanes(state: PassengerMotionState): Set<number> {
  return new Set(
    state.passengers.flatMap(({ path }) =>
      path
        .filter(({ x, y }) => x === PLATFORM_CORRIDOR_X && y < ACTIVE_QUEUE_AREA.y)
        .map(({ y }) => y),
    ),
  );
}

describe('Visible, bounded cohorts leaving the network box', () => {
  it.each(['bitcoin', 'ethereum'] as const)(
    'fans out 24 proved %s discoveries without delaying their original block departure',
    (chain) => {
      const details = Array.from({ length: 24 }, (_, index) => transaction(chain, index + 1));
      let state = reconcilePassengerMotion(stopped(chain), inclusions(chain, details));
      const startedAt = state.preparationStartedAt!;
      const duration = preparationDurationMs(chain);
      expect(state.passengers).toHaveLength(24);
      expect(new Set(state.passengers.map(({ tx }) => tx.id))).toEqual(
        new Set(details.map(({ id }) => id)),
      );
      const starts = state.passengers.map(({ phaseStartedAt }) => phaseStartedAt);
      expect(new Set(starts).size).toBe(24);
      expect(Math.min(...starts)).toBe(startedAt + 320);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(480);
      expect(lanes(state)).toEqual(new Set([140, 122, 104, 86]));
      for (const passenger of state.passengers) {
        expect(passenger).toMatchObject({
          arrivalKind: 'late-inclusion',
          phase: 'preparing',
          networkDoorLeadMs: 200,
          tx: { status: 'confirmed', blockHash: block(chain, 101).hash },
        });
        expect(passenger.path[0]).toEqual(networkBoxExit());
        expect(passenger.phaseStartedAt + passenger.durationMs).toBeCloseTo(
          startedAt + duration,
          8,
        );
        for (const point of passenger.path.slice(0, -2)) {
          expect(point.x).toBeGreaterThanOrEqual(PLATFORM_CORRIDOR_X);
          expect(point.y).toBeGreaterThanOrEqual(86);
          expect(
            point.x >= ACTIVE_QUEUE_AREA.x &&
              point.x <= ACTIVE_QUEUE_AREA.x + ACTIVE_QUEUE_AREA.width &&
              point.y >= ACTIVE_QUEUE_AREA.y,
          ).toBe(false);
        }
      }
      expect(
        passengerFrame(state).passengers.every(({ opacity, trail }) => opacity === 0 && !trail),
      ).toBe(true);
      state = runFor(state, 200);
      expect(passengerFrame(state).networkDoorProgress).toBe(1);
      expect(passengerFrame(state).passengers.every(({ opacity }) => opacity === 0)).toBe(true);
      state = runFor(state, 700);
      const visible = passengerFrame(state).passengers.filter(({ opacity }) => opacity > 0);
      expect(visible).toHaveLength(24);
      expect(new Set(visible.map(({ x, y }) => `${x.toFixed(4)},${y.toFixed(4)}`)).size).toBe(24);
      const frame = passengerFrame(state);
      for (const options of [{ paused: true }, { hidden: true }]) {
        const same = advancePassengerMotion(state, 100, options);
        expect(same).toBe(state);
        expect(passengerFrame(same).passengers).toBe(frame.passengers);
      }
      const reduced = advancePassengerMotion(state, 0, { reducedMotion: true });
      expect(passengerFrame(reduced).passengers).toHaveLength(0);
      expect(passengerFrame(reduced).networkActive).toBe(false);
      expect(passengerFrame(reduced).networkDoorProgress).toBe(0);
      state = runFor(state, duration - 901);
      expect(state.lastDepartureStartedAt).toBeNull();
      state = advancePassengerMotion(state, 1);
      expect(state.lastDepartureStartedAt).toBe(startedAt + duration);
      expect(new Set(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id))).toEqual(
        new Set(details.map(({ id }) => id)),
      );
    },
  );

  it.each(['bitcoin', 'ethereum'] as const)(
    'keeps existing %s paths and schedules stable when another proved cohort arrives',
    (chain) => {
      const first = Array.from({ length: 4 }, (_, index) => transaction(chain, index + 30));
      const late = Array.from({ length: 4 }, (_, index) => transaction(chain, index + 40));
      let state = reconcilePassengerMotion(stopped(chain), inclusions(chain, first));
      const startedAt = state.preparationStartedAt!;
      state = runFor(state, 400);
      const original = new Map(state.passengers.map((passenger) => [passenger.tx.id, passenger]));
      const source = inclusions(
        chain,
        late,
        [...first, ...late].map(({ id }) => id),
      );
      state = reconcilePassengerMotion(state, source);
      for (const tx of first) {
        const previous = original.get(tx.id)!;
        const current = state.passengers.find((passenger) => passenger.tx.id === tx.id)!;
        expect(current.path).toBe(previous.path);
        expect(current.phaseStartedAt).toBe(previous.phaseStartedAt);
        expect(current.durationMs).toBe(previous.durationMs);
      }
      const remaining = preparationDurationMs(chain) - 400;
      const newcomers = state.passengers.filter(({ tx }) => late.some(({ id }) => id === tx.id));
      expect(newcomers).toHaveLength(4);
      expect(new Set(newcomers.map(({ phaseStartedAt }) => phaseStartedAt)).size).toBe(4);
      for (const passenger of newcomers)
        expect(passenger.phaseStartedAt + passenger.durationMs).toBeCloseTo(
          startedAt + preparationDurationMs(chain),
          8,
        );
      expect(state.preparationStartedAt).toBe(startedAt);
      state = runFor(state, remaining - 1);
      expect(state.lastDepartureStartedAt).toBeNull();
      state = advancePassengerMotion(state, 1);
      expect(state.lastDepartureStartedAt).toBe(startedAt + preparationDurationMs(chain));
      expect(passengerFrame(state).departingPassengers).toHaveLength(8);
      state = runFor(state, HANDOFF_DURATION_MS + 1_000);
      state = reconcilePassengerMotion(state, source);
      expect(state.preparationStartedAt).toBeNull();
      expect(passengerFrame(state).departingPassengers).toHaveLength(0);
    },
  );

  it('does not count an archived traveller as a newly discovered network actor', () => {
    const archived = transaction('ethereum', 60);
    const fresh = transaction('ethereum', 61);
    const initial = stopped('ethereum');
    const state = reconcilePassengerMotion(
      {
        ...initial,
        waitingArchiveCount: 1,
        waitingArchiveTransactions: new Map([
          [archived.id, { tx: archived, lastSeenAt: OBSERVED_AT }],
        ]),
      },
      inclusions('ethereum', [archived, fresh]),
    );
    const known = state.passengers.find(({ tx }) => tx.id === archived.id)!;
    const newcomer = state.passengers.find(({ tx }) => tx.id === fresh.id)!;
    expect(known.path[0]).toEqual(WAITING_ARCHIVE_POSITION);
    expect(known.networkDoorLeadMs).toBeUndefined();
    expect(known.arrivalKind).not.toBe('late-inclusion');
    expect(passengerFrame(state).passengers.find(({ tx }) => tx.id === archived.id)!.opacity).toBe(
      1,
    );
    expect(newcomer.phaseStartedAt).toBe(state.preparationStartedAt! + 320);
    expect(newcomer.path.some(({ x, y }) => x === PLATFORM_CORRIDOR_X && y === 140)).toBe(true);
  });

  it('does not invent a crowd from inclusion identifiers without individual transaction details', () => {
    const ids = Array.from({ length: 24 }, (_, index) => hash('ethereum', index + 100));
    const state = reconcilePassengerMotion(stopped('ethereum'), inclusions('ethereum', [], ids));
    expect(state.passengers).toHaveLength(0);
    expect(passengerFrame(state).networkActive).toBe(false);
    expect(passengerFrame(state).networkDoorProgress).toBe(0);
  });
});
