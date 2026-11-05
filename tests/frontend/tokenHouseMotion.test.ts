import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  TOKEN_HOUSE_DOOR_LEAD_MS,
  MAX_HEAD_SCALE,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { passengerDescription } from '../../src/lib/passengerPresentation';
import {
  createQueueLayout,
  NETWORK_VESTIBULE_Y,
  networkBoxExit,
  queuePosition,
  TOKEN_HOUSE_CLEARANCE_Y,
  tokenHouseArrivalPath,
  USDT_HOUSE_RECT,
  SCENE_WIDTH,
} from '../../src/lib/streetGeometry';

const observedAt = 1_700_000_000_000;
const id = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const transaction = (value: number, usdt = true): Tx => ({
  id: id(value),
  chain: 'ethereum',
  status: 'pending',
  feeRate: 0,
  size: 21_000,
  kind: 'contract',
  value: '0 ETH',
  ...(usdt
    ? { tokens: [{ tokenId: 'usdt', operation: 'transfer', evidence: 'call', amount: '1000000' }] }
    : {}),
});
const block = (height = 100) => ({
  hash: id(10_000 + height),
  height,
  timestamp: observedAt / 1_000 + (height - 100) * 12,
  txCount: 150,
  used: 15_000_000,
  capacity: 30_000_000,
});
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Controlled fixture',
    observedAt,
    coverage: 'Bounded pending observations and exact block inclusions.',
    pendingCount: null,
    feeRate: 20,
    feeUnit: 'Gwei',
    transactions,
    blocks: [block()],
    inclusions: [],
    ...overrides,
  });
}
function runFor(state: PassengerMotionState, duration: number): PassengerMotionState {
  let next = state;
  for (let time = 0; time < duration; time += 100)
    next = advancePassengerMotion(next, Math.min(100, duration - time));
  return next;
}
function emptyScene(): PassengerMotionState {
  return runFor(createPassengerMotion(snapshot([])), 1_000);
}

describe('Identified USDT contract arrivals', () => {
  it('admits one newly observed pending transaction from the house before the regular queue', () => {
    const tx = transaction(1);
    let state = reconcilePassengerMotion(emptyScene(), snapshot([tx]));
    const first = passengerFrame(state);
    expect(first.passengers).toHaveLength(1);
    expect(first.passengers[0]).toMatchObject({
      arrivalKind: 'token-house',
      phase: 'arriving',
      tx: { id: tx.id, status: 'pending' },
      x: USDT_HOUSE_RECT.x + USDT_HOUSE_RECT.width / 2,
      y: USDT_HOUSE_RECT.y + USDT_HOUSE_RECT.height,
      opacity: 0,
      inWagon: false,
    });
    expect(state.passengers[0]!.path).toEqual(tokenHouseArrivalPath(0));
    expect(first.networkActive).toBe(false);
    expect(passengerDescription(first.passengers[0]!, undefined, false, 'en')).toContain(
      'without proving execution or inclusion',
    );
    state = runFor(state, TOKEN_HOUSE_DOOR_LEAD_MS);
    expect(passengerFrame(state).passengers[0]!.opacity).toBe(1);
    const phases = new Set<string>();
    for (let time = 0; time < 5_000; time += 100) {
      state = advancePassengerMotion(state, 100);
      phases.add(passengerFrame(state).passengers[0]!.phase);
    }
    expect(phases.has('queue')).toBe(true);
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      phase: 'queue',
      tx: { status: 'pending' },
    });
    for (let refresh = 0; refresh < 5; refresh += 1)
      state = reconcilePassengerMotion(
        state,
        snapshot([tx], { observedAt: observedAt + refresh * 1_000 }),
      );
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).usdtHouseActive).toBe(false);
  });

  it('keeps initial inventory, retained IDs and classification upgrades at their original places', () => {
    const tx = transaction(2);
    let state = createPassengerMotion(snapshot([tx]));
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      arrivalKind: 'initial-stock',
      phase: 'queue',
      opacity: 1,
    });
    expect(passengerFrame(state).usdtHouseActive).toBe(false);
    state = reconcilePassengerMotion(state, snapshot([tx]));
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(passengerFrame(state).passengers[0]!.arrivalKind).toBe('initial-stock');

    const plain = transaction(3, false);
    state = reconcilePassengerMotion(emptyScene(), snapshot([plain]));
    state = runFor(state, 300);
    const original = passengerFrame(state).passengers[0]!;
    const originalPath = state.passengers[0]!.path;
    state = reconcilePassengerMotion(state, snapshot([transaction(3)]));
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      arrivalKind: 'new-observation',
      x: original.x,
      y: original.y,
    });
    expect(state.passengers[0]!.path).toBe(originalPath);
    expect(passengerFrame(state).usdtHouseDoorProgress).toBe(0);
  });

  it('restores an archived observation without replaying a contract arrival', () => {
    const tx = transaction(4);
    const state = emptyScene();
    const restored = reconcilePassengerMotion(
      {
        ...state,
        waitingArchiveCount: 1,
        waitingArchiveTransactions: new Map([[tx.id, { tx, lastSeenAt: observedAt }]]),
      },
      snapshot([tx]),
    );
    expect(passengerFrame(restored).passengers).toHaveLength(1);
    expect(passengerFrame(restored).passengers[0]!.phase).not.toBe('arriving');
    expect(passengerFrame(restored).passengers[0]!.arrivalKind).not.toBe('token-house');
    expect(passengerFrame(restored).usdtHouseActive).toBe(false);
  });

  it('keeps newly discovered confirmed USDT inclusions at the network station', () => {
    const tx = transaction(5);
    const mined = block(101);
    const state = reconcilePassengerMotion(
      emptyScene(),
      snapshot([{ ...tx, status: 'confirmed', blockHash: mined.hash }], {
        observedAt: observedAt + 3_000,
        blocks: [mined],
        inclusions: [{ block: mined, transactionIds: [tx.id] }],
      }),
    );
    const frame = passengerFrame(state);
    expect(frame.passengers).toHaveLength(1);
    expect(frame.passengers[0]).toMatchObject({
      ...networkBoxExit(),
      arrivalKind: 'late-inclusion',
      phase: 'preparing',
    });
    expect(frame.networkActive).toBe(true);
    expect(frame.usdtHouseActive).toBe(false);
  });

  it('retains an existing house arrival through the queue when an exact inclusion accelerates it', () => {
    const tx = transaction(8);
    let state = reconcilePassengerMotion(emptyScene(), snapshot([tx]));
    state = runFor(state, 80);
    const queue = state.passengers[0]!.queuePoint!;
    const before = passengerFrame(state).passengers[0]!;
    const mined = block(101);
    state = reconcilePassengerMotion(
      state,
      snapshot([{ ...tx, status: 'confirmed', blockHash: mined.hash }], {
        observedAt: observedAt + 3_000,
        blocks: [mined],
        inclusions: [{ block: mined, transactionIds: [tx.id] }],
      }),
    );
    const frame = passengerFrame(state);
    expect(frame.passengers).toHaveLength(1);
    expect(frame.passengers[0]).toMatchObject({
      arrivalKind: 'token-house',
      phase: 'preparing',
      x: before.x,
      y: before.y,
      opacity: 0,
    });
    expect(state.passengers[0]!.path).toContainEqual(queue);
    expect(frame.networkActive).toBe(false);
    expect(frame.usdtHouseActive).toBe(true);
    expect(frame.usdtHouseDoorProgress).toBe(1);
    state = runFor(state, TOKEN_HOUSE_DOOR_LEAD_MS);
    expect(passengerFrame(state).passengers[0]!.opacity).toBe(1);
  });

  it('keeps the main arrival passage straight above the lowered houses', () => {
    const state = reconcilePassengerMotion(emptyScene(), snapshot([transaction(9, false)]));
    const person = passengerFrame(state).passengers[0]!;
    expect(person.arrivalKind).toBe('new-observation');
    expect(state.passengers[0]!.path[0]!.y).toBe(queuePosition(0).y);
    expect(queuePosition(0).y + 8).toBeLessThan(USDT_HOUSE_RECT.y - 8);
    expect(state.passengers[0]!.path.at(-1)).toEqual(queuePosition(0));
    expect(passengerFrame(state).usdtHouseActive).toBe(false);
  });

  it('opens before emergence, closes after clearance and obeys pause, hidden and reduced motion', () => {
    let state = reconcilePassengerMotion(emptyScene(), snapshot([transaction(6)]));
    expect(passengerFrame(state).usdtHouseDoorProgress).toBe(0);
    state = runFor(state, 80);
    expect(passengerFrame(state)).toMatchObject({
      usdtHouseDoorProgress: 1,
      usdtHouseActive: true,
    });
    expect(passengerFrame(state).passengers[0]!.opacity).toBe(0);
    expect(advancePassengerMotion(state, 100, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 100, { hidden: true })).toBe(state);
    const reduced = advancePassengerMotion(state, 100, { reducedMotion: true });
    expect(passengerFrame(reduced)).toMatchObject({
      usdtHouseDoorProgress: 0,
      usdtHouseActive: false,
      elapsedMs: state.elapsedMs,
    });
    expect(passengerFrame(reduced).passengers).toHaveLength(1);
    expect(passengerFrame(reduced).passengers[0]!.phase).not.toBe('arriving');
    state = runFor(state, 1_200);
    expect(passengerFrame(state).usdtHouseDoorProgress).toBe(0);
    expect(passengerFrame(state).passengers[0]!.phase).toBe('arriving');
  });

  it('keeps house routes off the road and below the separate network vestibule', () => {
    expect(USDT_HOUSE_RECT.x + USDT_HOUSE_RECT.width).toBeLessThanOrEqual(SCENE_WIDTH);
    expect(USDT_HOUSE_RECT.x).toBeGreaterThan(queuePosition(2).x + 8 * MAX_HEAD_SCALE);
    for (const scale of [0.5, 1, 2.5]) {
      const layout = createQueueLayout(scale);
      for (let index = 0; index < layout.capacity; index += 1) {
        const path = tokenHouseArrivalPath(index, layout);
        expect(path.at(-1)).toEqual(queuePosition(index, layout));
        expect(path.every((point) => point.x > 294 && point.y >= 190)).toBe(true);
        expect(path[1]!.y).toBeGreaterThanOrEqual(TOKEN_HOUSE_CLEARANCE_Y);
        // The tallest permitted head remains below the network's independent vestibule.
        expect(Math.min(...path.map((point) => point.y)) - 22 - 9 * 2.5).toBeGreaterThan(
          NETWORK_VESTIBULE_Y,
        );
      }
    }
  });
});
