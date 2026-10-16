import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import type { StreetPoint } from '../../src/lib/streetGeometry';

const observedAt = 1_700_000_000_000;
const tx: Tx = {
  id: `0x${'1'.repeat(64)}`,
  chain: 'ethereum',
  status: 'pending',
  feeRate: 1,
  size: 21_000,
  kind: 'transfer',
  value: '0.01 ETH',
};
const included: Tx = { ...tx, status: 'confirmed', blockHash: `0x${'b'.repeat(64)}` };

function motion(
  path: StreetPoint[],
  progress = 0.5,
  overrides: Partial<PassengerMotionState['passengers'][number]> = {},
): PassengerMotionState {
  const initial = createPassengerMotion(
    snapshotSchema.parse({
      chain: 'ethereum',
      mode: 'live',
      status: 'ok',
      source: 'Fournisseur contrôlé',
      observedAt,
      coverage: 'Échantillon contrôlé, sans confirmation déduite de son mouvement.',
      pendingCount: null,
      feeRate: 20,
      feeUnit: 'Gwei',
      transactions: [tx],
      blocks: [
        {
          hash: `0x${'a'.repeat(64)}`,
          height: 100,
          timestamp: observedAt / 1_000,
          txCount: 100,
          used: 15_000_000,
          capacity: 30_000_000,
        },
      ],
    }),
  );
  return {
    ...initial,
    elapsedMs: progress * 1_000,
    candidateArrivalStartedAt: null,
    preparationStartedAt: 0,
    preparationTransactions: [included],
    passengers: [
      {
        ...initial.passengers[0]!,
        tx: included,
        arrivalKind: 'late-inclusion',
        phase: 'preparing',
        departureIncluded: true,
        networkDoorLeadMs: 80,
        path,
        phaseStartedAt: 0,
        durationMs: 1_000,
        wagon: null,
        inHandoff: false,
        ...overrides,
      },
    ],
  };
}

function length(points: readonly StreetPoint[]): number {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index]!;
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

describe('Bounded trails reconstructed from current passenger paths', () => {
  it('ends at the present position and retains 110 units behind a moving traveller', () => {
    const state = motion([
      { x: 300, y: 200 },
      { x: 600, y: 200 },
    ]);
    const pose = passengerFrame(state).passengers[0]!;
    expect(pose).toMatchObject({ x: 450, y: 200, progress: 0.5, inWagon: false });
    expect(pose.trail).toEqual([
      { x: 340, y: 200 },
      { x: 450, y: 200 },
    ]);
    expect(length(pose.trail!)).toBe(110);
    expect(pose.trail!.at(-1)).toEqual({ x: pose.x, y: pose.y });
    expect(pose.trail!.every((point) => point.x <= pose.x)).toBe(true);
  });

  it('follows a right angle instead of cutting across the platform corner', () => {
    const state = motion([
      { x: 400, y: 200 },
      { x: 298, y: 200 },
      { x: 298, y: 400 },
    ]);
    const pose = passengerFrame(state).passengers[0]!;
    expect(pose.trail).toEqual([
      { x: 359, y: 200 },
      { x: 298, y: 200 },
      { x: 298, y: 249 },
    ]);
    expect(length(pose.trail!)).toBe(110);
    expect(pose.trail!.every(({ x, y }) => y === 200 || x === 298)).toBe(true);
    expect(pose.trail).not.toContainEqual({ x: 298, y: 400 });
  });

  it('omits zero length paths and duplicate corners without extending ahead', () => {
    expect(
      passengerFrame(
        motion([
          { x: 300, y: 200 },
          { x: 300, y: 200 },
        ]),
      ).passengers[0]!.trail,
    ).toBeUndefined();
    const pose = passengerFrame(
      motion([
        { x: 400, y: 200 },
        { x: 400, y: 200 },
        { x: 298, y: 200 },
        { x: 298, y: 200 },
        { x: 298, y: 400 },
      ]),
    ).passengers[0]!;
    expect(pose.trail).toHaveLength(3);
    expect(length(pose.trail!)).toBe(110);
    expect(
      pose.trail!.slice(1).every((point, index) => {
        const previous = pose.trail![index]!;
        return Math.hypot(point.x - previous.x, point.y - previous.y) > 0;
      }),
    ).toBe(true);
  });

  it('keeps at most eight recent corners even when a path has many short turns', () => {
    const path = Array.from({ length: 31 }, (_, index) => ({
      x: 350 + Math.ceil(index / 2) * 8,
      y: 200 + Math.floor(index / 2) * 8,
    }));
    const pose = passengerFrame(motion(path, 0.9)).passengers[0]!;
    expect(pose.trail!.length).toBeLessThanOrEqual(8);
    expect(pose.trail!.length).toBeGreaterThan(1);
    expect(length(pose.trail!)).toBeLessThanOrEqual(110);
    expect(pose.trail!.at(-1)).toEqual({ x: pose.x, y: pose.y });
    expect(
      pose.trail!.every((point) => path.some(({ x, y }) => point.x === x && point.y === y)),
    ).toBe(true);
  });

  it('omits trails for waiting, future phases, completed paths, onboard and transferred travellers', () => {
    const path = [
      { x: 400, y: 200 },
      { x: 298, y: 200 },
      { x: 298, y: 400 },
    ];
    for (const phase of ['queue', 'parked', 'confirmed'] as const)
      expect(passengerFrame(motion(path, 0.5, { phase })).passengers[0]!.trail).toBeUndefined();
    for (const progress of [0, 1])
      expect(passengerFrame(motion(path, progress)).passengers[0]!.trail).toBeUndefined();
    expect(
      passengerFrame(motion(path, 0.5, { phase: 'preparing', phaseStartedAt: 580 })).passengers[0]!
        .trail,
    ).toBeUndefined();
    expect(
      passengerFrame(motion(path, 0.5, { inHandoff: true, wagon: 'later' })).passengers[0]!.trail,
    ).toBeUndefined();
    const inside = passengerFrame(
      motion(
        [
          { x: 260, y: 250 },
          { x: 230, y: 250 },
        ],
        0.5,
        { phase: 'boarding', wagon: 'next' },
      ),
    ).passengers[0]!;
    expect(inside.inWagon).toBe(true);
    expect(inside.trail).toBeUndefined();
  });

  it('retains the same pose and trail during pause or a hidden tab, and clears reduced motion', () => {
    const state = motion([
      { x: 400, y: 200 },
      { x: 298, y: 200 },
      { x: 298, y: 400 },
    ]);
    const before = passengerFrame(state).passengers[0]!;
    expect(before.trail).toBeDefined();
    for (const options of [{ paused: true }, { hidden: true }]) {
      const unchanged = advancePassengerMotion(state, 100, options);
      expect(unchanged).toBe(state);
      expect(passengerFrame(unchanged).passengers[0]).toBe(before);
      expect(passengerFrame(unchanged).passengers[0]!.trail).toBe(before.trail);
    }
    const reduced = advancePassengerMotion(state, 0, { reducedMotion: true });
    expect(passengerFrame(reduced).passengers.every(({ trail }) => trail === undefined)).toBe(true);
  });

  it('does not retain ghost points when a route is replaced', () => {
    const initial = motion([
      { x: 1_000, y: 200 },
      { x: 1_400, y: 200 },
    ]);
    expect(passengerFrame(initial).passengers[0]!.trail).toBeDefined();
    const changed: PassengerMotionState = {
      ...initial,
      passengers: initial.passengers.map((passenger) => ({
        ...passenger,
        path: [
          { x: 300, y: 200 },
          { x: 300, y: 500 },
        ],
      })),
    };
    const pose = passengerFrame(changed).passengers[0]!;
    expect(pose.trail).toEqual([
      { x: 300, y: 240 },
      { x: 300, y: 350 },
    ]);
    expect(pose.trail!.every(({ x }) => x === 300)).toBe(true);
  });

  it('does not draw a trail for ordinary pending walkers or a remembered old network origin', () => {
    const path = [
      { x: 400, y: 200 },
      { x: 298, y: 200 },
      { x: 298, y: 400 },
    ];
    const ordinary = passengerFrame(
      motion(path, 0.5, {
        tx,
        phase: 'walking',
        arrivalKind: 'new-observation',
        departureIncluded: false,
        networkDoorLeadMs: undefined,
      }),
    ).passengers[0]!;
    expect(ordinary.progress).toBe(0.5);
    expect(ordinary.trail).toBeUndefined();
    const oldOrigin = passengerFrame(
      motion(path, 0.5, {
        tx,
        phase: 'walking',
        arrivalKind: 'late-inclusion',
        departureIncluded: false,
      }),
    ).passengers[0]!;
    expect(oldOrigin.trail).toBeUndefined();
    for (const overrides of [{ networkDoorLeadMs: undefined }, { departureIncluded: false }])
      expect(passengerFrame(motion(path, 0.5, overrides)).passengers[0]!.trail).toBeUndefined();
  });

  it('keeps the network active after its door closes only for the current real passage', () => {
    const active: PassengerMotionState = {
      ...motion(
        [
          { x: 447, y: 116 },
          { x: 447, y: 140 },
          { x: 298, y: 140 },
          { x: 298, y: 239 },
        ],
        0.8,
        {
          arrivalKind: 'late-inclusion',
          phase: 'preparing',
          networkDoorLeadMs: 80,
          departureIncluded: true,
        },
      ),
      preparationStartedAt: 0,
    };
    expect(passengerFrame(active).networkDoorProgress).toBe(0);
    expect(passengerFrame(active).networkActive).toBe(true);
    expect(passengerFrame({ ...active, preparationStartedAt: null }).networkActive).toBe(false);
    expect(
      passengerFrame({
        ...active,
        passengers: active.passengers.map((passenger) => ({ ...passenger, phase: 'boarding' })),
      }).networkActive,
    ).toBe(false);
    expect(
      passengerFrame({
        ...active,
        passengers: active.passengers.map((passenger) => ({
          ...passenger,
          networkDoorLeadMs: undefined,
        })),
      }).networkActive,
    ).toBe(false);
  });
});
