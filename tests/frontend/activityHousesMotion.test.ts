import { describe, expect, it } from 'vitest';
import { HOUSE_IDS, type HouseId } from '../../shared/activityHouses';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  reflowPassengerQueue,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import {
  HOUSE_RECTS,
  createQueueLayout,
  houseArrivalPath,
  ordinaryEthereumArrivalPath,
  networkBoxExit,
  networkBoxBoardingPath,
  queuePosition,
} from '../../src/lib/streetGeometry';
import { passengerDescription } from '../../src/lib/passengerPresentation';

const now = 1_760_000_000_000;
const id = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const block = (height = 100) => ({
  hash: id(1000 + height),
  height,
  timestamp: now / 1000,
  txCount: 100,
  used: 21_000,
  capacity: 30_000_000,
});
function transaction(index: number, house?: HouseId): Tx {
  return {
    id: id(index),
    chain: 'ethereum',
    status: 'pending',
    feeRate: 0,
    size: 21_000,
    kind: 'contract',
    value: '0 ETH',
    ...(house === 'usdt' || house === 'usdc'
      ? { tokens: [{ tokenId: house, operation: 'transfer', evidence: 'call', amount: '1000000' }] }
      : {}),
    ...(house === 'uniswap' || house === 'aave'
      ? { protocols: [{ protocolId: house, operation: 'interaction', evidence: 'call' }] }
      : {}),
  };
}
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Controlled fixture',
    observedAt: now,
    coverage: 'Bounded activity sample.',
    pendingCount: null,
    feeRate: 20,
    feeUnit: 'Gwei',
    transactions,
    blocks: [block()],
    inclusions: [],
    ...overrides,
  });
}
function advance(state: PassengerMotionState, duration: number): PassengerMotionState {
  for (let elapsed = 0; elapsed < duration; elapsed += 100)
    state = advancePassengerMotion(state, Math.min(100, duration - elapsed));
  return state;
}
const empty = () => advance(createPassengerMotion(snapshot([])), 1000);

/** Conservative body envelope, excluding the house from which a doorway passage emerges. */
function intersectsOtherHouse(point: { x: number; y: number }, source?: HouseId): boolean {
  return HOUSE_IDS.some((id) => {
    if (id === source) return false;
    const house = HOUSE_RECTS[id];
    return (
      point.x + 20 > house.x &&
      point.x - 20 < house.x + house.width &&
      point.y + 8 > house.y - 8 &&
      point.y - 48 < house.y + house.height
    );
  });
}
function samples(path: { x: number; y: number }[]) {
  return path.flatMap((point, index) => {
    const next = path[index + 1];
    if (!next) return [point];
    return Array.from({ length: 41 }, (_, step) => ({
      x: point.x + ((next.x - point.x) * step) / 40,
      y: point.y + ((next.y - point.y) * step) / 40,
    }));
  });
}

describe('shared activity-house origin and routes', () => {
  it.each(HOUSE_IDS)('captures the %s doorway and opens only its clock', (houseId) => {
    const tx = transaction(1, houseId);
    let state = reconcilePassengerMotion(empty(), snapshot([tx]));
    const rect = HOUSE_RECTS[houseId];
    const initial = passengerFrame(state);
    expect(initial.passengers).toHaveLength(1);
    expect(initial.passengers[0]).toMatchObject({
      houseId,
      arrivalKind: 'token-house',
      phase: 'arriving',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height,
      opacity: 0,
    });
    expect(state.passengers[0]!.path).toEqual(houseArrivalPath(houseId, 0));
    expect(initial.houses[houseId]).toEqual({ active: true, doorProgress: 0 });
    expect(HOUSE_IDS.filter((id) => id !== houseId).every((id) => !initial.houses[id].active)).toBe(
      true,
    );
    state = advance(state, 80);
    const opening = passengerFrame(state);
    expect(opening.houses[houseId].doorProgress).toBe(1);
    expect(opening.passengers[0]!.opacity).toBe(0);
    expect(advancePassengerMotion(state, 100, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 100, { hidden: true })).toBe(state);
    const reduced = passengerFrame(advancePassengerMotion(state, 100, { reducedMotion: true }));
    expect(
      HOUSE_IDS.every((id) => !reduced.houses[id].active && reduced.houses[id].doorProgress === 0),
    ).toBe(true);
    expect(reduced.passengers).toHaveLength(1);
    state = advance(state, state.passengers[0]!.durationMs + 500);
    expect(passengerFrame(state).passengers[0]!.phase).toBe('queue');
    expect(passengerFrame(state).houses[houseId].active).toBe(false);
    const label =
      houseId === 'aave' ? 'Aave' : houseId === 'uniswap' ? 'Uniswap' : houseId.toUpperCase();
    expect(passengerDescription(initial.passengers[0]!, undefined, false, 'en')).toContain(
      `${label} house`,
    );
  });

  it('uses one protocol-first origin for multiple categories without replaying upgrades', () => {
    const tx: Tx = {
      ...transaction(2, 'uniswap'),
      tokens: [
        { tokenId: 'usdt', operation: 'transfer', evidence: 'call', amount: '1000000' },
        { tokenId: 'usdc', operation: 'transfer', evidence: 'call', amount: '2000000' },
      ],
    };
    let state = reconcilePassengerMotion(empty(), snapshot([tx]));
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).passengers[0]!.houseId).toBe('uniswap');
    state = advance(state, 300);
    const before = passengerFrame(state).passengers[0]!;
    const path = state.passengers[0]!.path;
    const upgraded = {
      ...tx,
      protocols: [{ protocolId: 'aave', operation: 'supply', evidence: 'call' }],
    } as Tx;
    state = reconcilePassengerMotion(state, snapshot([upgraded], { observedAt: now + 3000 }));
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      houseId: 'uniswap',
      x: before.x,
      y: before.y,
    });
    expect(state.passengers[0]!.path).toBe(path);
    expect(passengerFrame(state).houses.aave.active).toBe(false);
    expect(passengerFrame(state).houses.usdt.active).toBe(false);
  });

  it.each(HOUSE_IDS)('does not replay initial stock or late %s block discoveries', (houseId) => {
    const tx = transaction(3, houseId);
    const initial = passengerFrame(createPassengerMotion(snapshot([tx])));
    expect(initial.passengers[0]!.arrivalKind).toBe('initial-stock');
    expect(initial.passengers[0]!.houseId).toBeUndefined();
    expect(HOUSE_IDS.every((id) => !initial.houses[id].active)).toBe(true);
    const mined = block(101);
    const confirmed = { ...tx, status: 'confirmed', blockHash: mined.hash } as Tx;
    const discovered = passengerFrame(
      reconcilePassengerMotion(
        empty(),
        snapshot([confirmed], {
          observedAt: now + 3000,
          blocks: [mined],
          inclusions: [{ block: mined, transactionIds: [tx.id] }],
        }),
      ),
    );
    expect(discovered.passengers).toHaveLength(1);
    expect(discovered.passengers[0]).toMatchObject({
      ...networkBoxExit(),
      arrivalKind: 'late-inclusion',
      phase: 'preparing',
    });
    expect(discovered.passengers[0]!.houseId).toBeUndefined();
    expect(discovered.networkActive).toBe(true);
    expect(HOUSE_IDS.every((id) => !discovered.houses[id].active)).toBe(true);
  });

  it('keeps every ordinary arrival and each house path off other facades and the road at all queue widths', () => {
    for (const scale of [0.5, 1, 2.5]) {
      const layout = createQueueLayout(scale);
      for (let index = 0; index < layout.capacity; index += 1) {
        const ordinary = ordinaryEthereumArrivalPath(index, layout);
        expect(ordinary.at(-1)).toEqual(queuePosition(index, layout));
        expect(
          samples(ordinary).every((point) => !intersectsOtherHouse(point) && point.x > 294),
        ).toBe(true);
        for (const id of HOUSE_IDS) {
          const path = houseArrivalPath(id, index, layout);
          expect(path.at(-1)).toEqual(queuePosition(index, layout));
          expect(
            samples(path).every((point) => !intersectsOtherHouse(point, id) && point.x > 294),
          ).toBe(true);
        }
      }
    }
  });

  it('keeps all network lanes and boarding paths clear of house roofs and walls', () => {
    for (let lane = 0; lane < 4; lane += 1) {
      const path = networkBoxBoardingPath(0, lane);
      expect(samples(path).every((point) => !intersectsOtherHouse(point))).toBe(true);
    }
  });

  it('keeps captured house identity and a safe outer route during a queue resize', () => {
    let state = reconcilePassengerMotion(empty(), snapshot([transaction(4, 'usdc')]));
    state = advance(state, 240);
    state = reflowPassengerQueue(state, createQueueLayout(2.5));
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(state.passengers[0]!.houseId).toBe('usdc');
    expect(
      samples(state.passengers[0]!.path).every(
        (point) => !intersectsOtherHouse(point, 'usdc') && point.x > 294,
      ),
    ).toBe(true);
  });
});
