import { describe, expect, it } from 'vitest';
import type { Snapshot, Tx } from '../../shared/model';
import { generateDemoSnapshot } from '../../server/demo';
import {
  advancePassengerMotion,
  CANDIDATE_CAPACITY,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  transactionHeadScale,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';

function transaction(id: string, feeRate = 20, size = 200): Tx {
  return {
    id,
    chain: 'bitcoin',
    status: 'pending',
    feeRate,
    size,
    kind: 'transfer',
    value: '0.01 BTC',
  };
}

function snapshot(transactions: Tx[], feeRate: number | null = 8): Snapshot {
  return { ...generateDemoSnapshot('bitcoin', 1_000), transactions, feeRate };
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let time = 0; time < durationMs; time += 100) {
    next = advancePassengerMotion(next, 100);
  }
  return next;
}

describe('Illustrated passenger journeys', () => {
  it('packs a bounded illustrative budget by fee and deterministic identifier tie-breaks', () => {
    const transactions = Array.from({ length: 14 }, (_, index) =>
      transaction(`tx-${String(index).padStart(2, '0')}`),
    );
    const left = passengerFrame(createPassengerMotion(snapshot(transactions)));
    const right = passengerFrame(createPassengerMotion(snapshot([...transactions].reverse())));
    const acceptedIds = (frame: typeof left) =>
      frame.passengers.filter((passenger) => passenger.selectedForCandidate).map(({ tx }) => tx.id);
    expect(acceptedIds(left)).toEqual(acceptedIds(right));
    expect(acceptedIds(left)).toHaveLength(12);
    expect(left.candidateUsed).toBe(CANDIDATE_CAPACITY);
    expect(left.passengers.find(({ tx }) => tx.id === 'tx-13')?.reason).toBe('capacity');

    const large = passengerFrame(
      createPassengerMotion(snapshot(transactions.map((tx) => ({ ...tx, size: 900 })))),
    );
    expect(large.candidateCount).toBe(4);
    expect(large.candidateUsed).toBe(12);
  });

  it('walks low-fee travellers to the door and returns them to their original queue', () => {
    let state = createPassengerMotion(snapshot([transaction('low-fee', 2)]));
    const initial = passengerFrame(state).passengers[0]!;
    const visited = new Set<string>();
    let furthestX = initial.x;
    for (let index = 0; index < 120; index += 1) {
      state = advancePassengerMotion(state, 100);
      const pose = passengerFrame(state).passengers[0]!;
      visited.add(pose.phase);
      furthestX = Math.max(furthestX, pose.x);
    }
    const final = passengerFrame(state).passengers[0]!;
    expect(visited).toEqual(new Set(['walking', 'exiting', 'returning', 'queue']));
    expect(furthestX).toBeGreaterThan(1_000);
    expect(final).toMatchObject({ phase: 'queue', x: initial.x, y: initial.y, reason: 'fee' });
    expect(final.tx.status).toBe('pending');
  });

  it('disembarks an illustrated candidate when a higher-fee arrival consumes its budget', () => {
    const transactions = Array.from({ length: 12 }, (_, index) =>
      transaction(`tx-${String(index).padStart(2, '0')}`, 20 - index),
    );
    let state = runFor(createPassengerMotion(snapshot(transactions)), 9_000);
    const before = passengerFrame(state).passengers.find(({ tx }) => tx.id === 'tx-11')!;
    expect(before.phase).toBe('boarded');
    state = reconcilePassengerMotion(
      state,
      snapshot([...transactions, transaction('new-high', 100)]),
    );
    const evicted = passengerFrame(state).passengers.find(({ tx }) => tx.id === 'tx-11')!;
    expect(evicted).toMatchObject({
      phase: 'exiting',
      reason: 'capacity',
      selectedForCandidate: false,
    });
    expect(evicted.x).toBe(before.x);
    state = runFor(state, 6_000);
    const returned = passengerFrame(state).passengers.find(({ tx }) => tx.id === 'tx-11')!;
    expect(returned.phase).toBe('queue');
    expect(returned.x).toBe(returned.queueX);
    expect(returned.tx.status).toBe('pending');
    expect(passengerFrame(state).candidateUsed).toBe(12);
  });

  it('replans threshold changes without moving the actual transaction status', () => {
    const tx = Object.freeze(transaction('retained', 10));
    let state = runFor(createPassengerMotion(snapshot([tx])), 9_000);
    state = reconcilePassengerMotion(state, snapshot([tx], 12));
    expect(passengerFrame(state).passengers[0]).toMatchObject({ phase: 'exiting', reason: 'fee' });
    expect(tx.status).toBe('pending');
    state = runFor(state, 6_000);
    state = reconcilePassengerMotion(state, snapshot([tx], 8));
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      phase: 'walking',
      selectedForCandidate: true,
    });
    expect(tx.status).toBe('pending');
  });

  it('links only head size to an absolute bounded resource size, across both chains', () => {
    for (const chain of ['bitcoin', 'ethereum'] as const) {
      const sizes = [0, 200, 1_000, 21_000, 1_000_000, Number.MAX_VALUE];
      const scales = sizes.map((size) => transactionHeadScale({ chain, size }));
      expect(scales).toEqual([...scales].sort((left, right) => left - right));
      expect(scales.every((scale) => scale >= 0.8 && scale <= 1.85)).toBe(true);
      expect(new Set(scales).size).toBeGreaterThan(2);
    }
    const tx = transaction('fixed-head', 20, 400);
    const before = passengerFrame(createPassengerMotion(snapshot([tx]))).passengers[0]!;
    const after = passengerFrame(
      createPassengerMotion(snapshot([tx, transaction('giant', 21, 2_000_000)])),
    ).passengers.find(({ tx: candidate }) => candidate.id === tx.id)!;
    expect(after.headScale).toBe(before.headScale);
  });

  it('accumulates no paused or hidden time and bounds a long resume frame', () => {
    const state = createPassengerMotion(snapshot([transaction('clock')]));
    expect(advancePassengerMotion(state, 60_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000, { hidden: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000).elapsedMs).toBe(100);
    expect(advancePassengerMotion(state, 100, { speed: 100 }).elapsedMs).toBe(200);
    expect(advancePassengerMotion(state, 100, { speed: -10 }).elapsedMs).toBe(50);
    expect(advancePassengerMotion(state, Number.NaN)).toBe(state);
  });

  it('places reduced-motion passengers at semantic destinations without traversing paths', () => {
    const pending = transaction('accepted');
    const lowFee = transaction('waiting', 1);
    const observed = { ...transaction('observed'), status: 'confirmed' as const };
    let state = createPassengerMotion(snapshot([pending, lowFee, observed]));
    state = advancePassengerMotion(state, 10_000, { reducedMotion: true });
    const frame = passengerFrame(state);
    expect(frame.elapsedMs).toBe(0);
    expect(frame.counts).toMatchObject({ boarded: 1, confirmed: 1, queue: 1, walking: 0 });
    expect(frame.passengers.find(({ tx }) => tx.id === 'observed')?.destination).toBe('observed');
    const repeated = advancePassengerMotion(state, 100, { reducedMotion: true });
    expect(passengerFrame(repeated)).toEqual(frame);
    expect(pending.status).toBe('pending');
    expect(lowFee.status).toBe('pending');
  });

  it('only sends source-confirmed transactions to the observed wagon and removes missing samples', () => {
    const tx = transaction('source-owned');
    let state = runFor(createPassengerMotion(snapshot([tx])), 9_000);
    expect(passengerFrame(state).counts.confirmed).toBe(0);
    state = reconcilePassengerMotion(state, snapshot([]));
    expect(passengerFrame(state).passengers).toEqual([]);
    expect(tx.status).toBe('pending');

    state = createPassengerMotion(snapshot([tx]));
    state = reconcilePassengerMotion(state, snapshot([{ ...tx, status: 'confirmed' }]));
    expect(passengerFrame(state).passengers[0]?.destination).toBe('observed');
    state = runFor(state, 9_000);
    expect(passengerFrame(state).counts.confirmed).toBe(1);
  });

  it('preserves paths across refreshes and reflects a source confirmation reversal', () => {
    const tx = transaction('stable-path');
    let state = runFor(createPassengerMotion(snapshot([tx])), 1_000);
    const before = passengerFrame(state).passengers[0]!;
    state = reconcilePassengerMotion(state, { ...snapshot([tx]), observedAt: 2_000 });
    const refreshed = passengerFrame(state).passengers[0]!;
    expect(refreshed).toMatchObject({ x: before.x, y: before.y, phase: before.phase });

    state = reconcilePassengerMotion(state, snapshot([{ ...tx, status: 'confirmed' }]));
    state = runFor(state, 9_000);
    expect(passengerFrame(state).passengers[0]?.phase).toBe('confirmed');
    state = reconcilePassengerMotion(state, snapshot([{ ...tx, feeRate: 1 }]));
    expect(passengerFrame(state).passengers[0]).toMatchObject({
      phase: 'returning',
      destination: 'queue',
      inWagon: false,
    });
    expect(passengerFrame(state).counts.confirmed).toBe(0);
  });

  it('transfers only source-confirmed passengers on a new block and replans the remaining candidate', () => {
    const included = Object.freeze(transaction('a'.repeat(64)));
    const waiting = Object.freeze(transaction('b'.repeat(64), 15));
    const demo = snapshot([included, waiting]);
    const first = demo.blocks[0];
    if (!first) throw new Error('Un bloc est requis par le scénario de transfert.');
    const baseline: Snapshot = {
      ...demo,
      mode: 'live',
      source: 'Source contrôlée de test',
      blocks: [{ ...first, hash: 'c'.repeat(64) }],
    };
    let state = runFor(createPassengerMotion(baseline), 9_000);
    expect(passengerFrame(state).counts.boarded).toBe(2);
    expect(passengerFrame(state).handoffProgress).toBeNull();
    state = reconcilePassengerMotion(state, { ...baseline, observedAt: 2_000 });
    expect(passengerFrame(state).handoffProgress).toBeNull();

    const observed: Snapshot = {
      ...baseline,
      observedAt: 3_000,
      blocks: [{ ...first, hash: 'd'.repeat(64) }],
      transactions: [{ ...included, status: 'confirmed' }, waiting],
    };
    const starting = reconcilePassengerMotion(state, observed);
    const frame = passengerFrame(starting);
    expect(frame.handoffProgress).toBe(0);
    expect(frame.passengers.find(({ tx }) => tx.id === included.id)).toMatchObject({
      inHandoff: true,
      inWagon: true,
      destination: 'observed',
      tx: { status: 'confirmed' },
    });
    expect(frame.passengers.find(({ tx }) => tx.id === waiting.id)).toMatchObject({
      phase: 'exiting',
      inHandoff: false,
      inWagon: false,
      tx: { status: 'pending' },
    });
    expect(advancePassengerMotion(starting, 60_000, { paused: true })).toBe(starting);
    expect(advancePassengerMotion(starting, 60_000, { hidden: true })).toBe(starting);
    state = runFor(starting, 1_000);
    expect(passengerFrame(state).handoffProgress).toBeGreaterThan(0);
    expect(passengerFrame(state).handoffProgress).toBeLessThan(1);
    const replayed = reconcilePassengerMotion(state, { ...observed, observedAt: 4_000 });
    expect(passengerFrame(replayed).handoffProgress).toBe(passengerFrame(state).handoffProgress);
    state = runFor(replayed, 3_000);
    const arrived = passengerFrame(state);
    expect(arrived.handoffProgress).toBeNull();
    expect(arrived.passengers.find(({ tx }) => tx.id === included.id)).toMatchObject({
      phase: 'confirmed',
      inHandoff: false,
      inWagon: true,
      destination: 'observed',
    });
    expect(arrived.passengers.find(({ tx }) => tx.id === waiting.id)?.destination).not.toBe(
      'observed',
    );
    state = runFor(state, 14_000);
    expect(passengerFrame(state).passengers.find(({ tx }) => tx.id === waiting.id)).toMatchObject({
      phase: 'boarded',
      destination: 'candidate',
      tx: { status: 'pending' },
    });

    const reduced = passengerFrame(advancePassengerMotion(starting, 100, { reducedMotion: true }));
    expect(reduced.handoffProgress).toBeNull();
    expect(reduced.passengers.find(({ tx }) => tx.id === included.id)).toMatchObject({
      phase: 'confirmed',
      destination: 'observed',
      inHandoff: false,
    });
    expect(reduced.passengers.find(({ tx }) => tx.id === waiting.id)?.tx.status).toBe('pending');
    const reversed = passengerFrame(
      reconcilePassengerMotion(starting, {
        ...observed,
        transactions: [included, waiting],
      }),
    );
    expect(reversed.passengers.find(({ tx }) => tx.id === included.id)).toMatchObject({
      inHandoff: false,
      inWagon: false,
      tx: { status: 'pending' },
    });
    expect(included.status).toBe('pending');
    expect(waiting.status).toBe('pending');
  });

  it('caps visible source samples, removes duplicate identifiers, and resets across chain or mode', () => {
    const transactions = Array.from({ length: 120 }, (_, index) => transaction(`tx-${index}`));
    const first = createPassengerMotion(snapshot(transactions));
    expect(passengerFrame(first).passengers).toHaveLength(80);
    const duplicates = createPassengerMotion(snapshot([transactions[0]!, transactions[0]!]));
    expect(passengerFrame(duplicates).passengers).toHaveLength(1);
    const newMode = reconcilePassengerMotion(runFor(first, 1_000), {
      ...snapshot([transaction('replacement')]),
      mode: 'live',
    });
    expect(newMode.elapsedMs).toBe(0);
    expect(passengerFrame(newMode).passengers.map(({ tx }) => tx.id)).toEqual(['replacement']);
    expect(reconcilePassengerMotion(first, generateDemoSnapshot('ethereum')).context).toBe(
      'ethereum:demo',
    );
  });
});
