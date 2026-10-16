import { describe, expect, it } from 'vitest';
import { PENDING_SAMPLE_LIMIT, snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import { generateDemoSnapshot } from '../../server/demo';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  preparationDurationMs,
  reconcilePassengerMotion,
  transactionHeadScale,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { PLATFORM_CORRIDOR_X } from '../../src/lib/streetGeometry';

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
  return snapshotSchema.parse({ ...generateDemoSnapshot('bitcoin', 1_000), transactions, feeRate });
}

function runFor(state: PassengerMotionState, durationMs: number): PassengerMotionState {
  let next = state;
  for (let time = 0; time < durationMs; time += 100)
    next = advancePassengerMotion(next, Math.min(100, durationMs - time));
  return next;
}

function pose(state: PassengerMotionState, id: string) {
  const person = passengerFrame(state).passengers.find(({ tx }) => tx.id === id);
  if (!person) throw new Error(`Voyageur absent : ${id}`);
  return person;
}

const live = (transactions: Tx[], height = 100, inclusions: string[] = []): Snapshot => {
  const head = {
    height,
    hash: height.toString(16).padStart(64, 'a'),
    timestamp: 1_700_000_000 + height,
    txCount: 100,
    used: 500_000,
    capacity: 1_000_000,
  };
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée',
    observedAt: 1_700_000_000_000 + (height - 100) * 3_000,
    coverage: 'Échantillon limité ; preuves exactes séparées.',
    pendingCount: 10_000,
    feeRate: 8,
    feeUnit: 'sat/vB',
    transactions,
    blocks: [head],
    inclusions: inclusions.length ? [{ block: head, transactionIds: inclusions }] : [],
  });
};

describe('Illustrated passenger journeys with native capacity', () => {
  it('packs two native block budgets by fee with deterministic identifier tie-breaks', () => {
    const transactions = [
      transaction('tx-c', 10, 600_000),
      transaction('tx-b', 20, 600_000),
      transaction('tx-a', 20, 600_000),
    ];
    const left = passengerFrame(createPassengerMotion(snapshot(transactions)));
    const right = passengerFrame(createPassengerMotion(snapshot([...transactions].reverse())));
    const accepted = (frame: typeof left) =>
      frame.passengers.filter((p) => p.selectedForCandidate).map(({ tx }) => tx.id);
    expect(accepted(left)).toEqual(accepted(right));
    expect(accepted(left)).toEqual(['tx-a', 'tx-b']);
    expect(left.projectionUsed).toEqual({ next: 600_000, later: 600_000 });
    expect(left.candidateCapacity).toBe(1_000_000);
    expect(left.passengers.find(({ tx }) => tx.id === 'tx-c')?.reason).toBe('capacity');
    const tooLarge = createPassengerMotion(snapshot([transaction('oversized', 1_000, 1_000_001)]));
    expect(passengerFrame(tooLarge).projectionCount).toEqual({ next: 0, later: 0 });
  });

  it('boards Bitcoin below a recommendation without interpreting the recommendation as a rejection', () => {
    const tx = transaction('low-fee', 2);
    let state = createPassengerMotion(snapshot([tx]));
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'queue',
      arrivalKind: 'initial-stock',
      inWagon: false,
    });
    const visited = new Set<string>();
    for (let index = 0; index < 150; index += 1) {
      state = advancePassengerMotion(state, 100);
      const person = pose(state, tx.id);
      visited.add(person.phase);
      if (!person.inWagon && !['boarding', 'exiting'].includes(person.phase))
        expect(person.x).toBeGreaterThanOrEqual(PLATFORM_CORRIDOR_X);
    }
    expect(visited.has('walking')).toBe(true);
    expect(visited.has('boarding')).toBe(true);
    expect(visited.has('exiting')).toBe(false);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      reason: 'accepted',
      tx: { status: 'pending' },
    });
  });

  it('evicts a weaker illustrated candidate only under actual native-capacity pressure', () => {
    const strong = transaction('strong', 20, 600_000);
    const weak = transaction('weak', 10, 600_000);
    let state = runFor(createPassengerMotion(snapshot([strong, weak])), 15_000);
    const before = pose(state, weak.id);
    state = reconcilePassengerMotion(
      state,
      snapshot([strong, weak, transaction('new-high', 100, 600_000)]),
    );
    expect(pose(state, weak.id)).toMatchObject({
      phase: 'exiting',
      reason: 'capacity',
      selectedForCandidate: false,
      x: before.x,
      y: before.y,
    });
    state = runFor(state, 15_000);
    expect(pose(state, weak.id)).toMatchObject({
      phase: 'queue',
      inWagon: false,
      tx: { status: 'pending' },
    });
    expect(pose(state, weak.id).x).toBe(pose(state, weak.id).queueX);
    expect(passengerFrame(state).projectionUsed).toEqual({ next: 600_000, later: 600_000 });
  });

  it('keeps a Bitcoin rider and its source status when only the recommendation changes', () => {
    const tx = Object.freeze(transaction('retained', 10));
    let state = runFor(createPassengerMotion(snapshot([tx])), 15_000);
    const before = pose(state, tx.id);
    state = reconcilePassengerMotion(state, snapshot([tx], 12));
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      x: before.x,
      y: before.y,
      selectedForCandidate: true,
    });
    state = reconcilePassengerMotion(state, snapshot([tx], 8));
    expect(pose(state, tx.id).phase).toBe('boarded');
    expect(tx.status).toBe('pending');
  });

  it('links only head size to an absolute bounded resource size across both chains', () => {
    for (const chain of ['bitcoin', 'ethereum'] as const) {
      const scales = [0, 200, 1_000, 21_000, 1_000_000, Number.MAX_VALUE].map((size) =>
        transactionHeadScale({ chain, size }),
      );
      expect(scales).toEqual([...scales].sort((left, right) => left - right));
      expect(scales.every((scale) => scale >= 0.8 && scale <= 2.5)).toBe(true);
      expect(new Set(scales).size).toBeGreaterThan(2);
    }
    // Common small/large pairs must remain visibly different, independently of their peers.
    for (const [chain, small, large] of [
      ['bitcoin', 140, 1_140],
      ['ethereum', 21_000, 240_000],
    ] as const) {
      expect(transactionHeadScale({ chain, size: large })).toBeGreaterThanOrEqual(
        transactionHeadScale({ chain, size: small }) * 2,
      );
      for (const size of [-1, Number.NaN, Number.POSITIVE_INFINITY])
        expect(transactionHeadScale({ chain, size })).toBe(0.8);
    }
    const tx = transaction('fixed-head', 20, 400);
    expect(
      pose(createPassengerMotion(snapshot([tx, transaction('giant', 21, 2_000_000)])), tx.id)
        .headScale,
    ).toBe(pose(createPassengerMotion(snapshot([tx])), tx.id).headScale);
  });

  it('accumulates no paused or hidden time and bounds a long resume frame', () => {
    const state = createPassengerMotion(snapshot([transaction('clock')]));
    expect(advancePassengerMotion(state, 60_000, { paused: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000, { hidden: true })).toBe(state);
    expect(advancePassengerMotion(state, 60_000).elapsedMs).toBe(100);
    for (const [speed, expected] of [
      [5, 500],
      [10, 1_000],
      [100, 1_000],
      [0.5, 50],
      [-10, 50],
    ])
      expect(advancePassengerMotion(state, 100, { speed }).elapsedMs).toBe(expected);
    expect(advancePassengerMotion(state, 60_000, { speed: 10 }).elapsedMs).toBe(1_000);
    expect(advancePassengerMotion(state, Number.NaN)).toBe(state);
  });

  it('settles reduced movement into native projections without a fabricated observed wagon', () => {
    const accepted = transaction('accepted');
    const belowRecommendation = transaction('low-fee', 1);
    const oversized = transaction('oversized', 100, 1_000_001);
    const state = advancePassengerMotion(
      createPassengerMotion(snapshot([accepted, belowRecommendation, oversized])),
      10_000,
      { reducedMotion: true },
    );
    const frame = passengerFrame(state);
    expect(frame.elapsedMs).toBe(0);
    expect(frame.counts).toMatchObject({ boarded: 2, queue: 1, confirmed: 0, walking: 0 });
    expect(pose(state, oversized.id).destination).toBe('queue');
    expect(passengerFrame(advancePassengerMotion(state, 100, { reducedMotion: true }))).toEqual(
      frame,
    );
    expect(accepted.status).toBe('pending');
  });

  it('keeps an absent boarded observation unknown and never infers a confirmation from disappearance', () => {
    const tx = transaction('source-owned');
    let state = runFor(createPassengerMotion(snapshot([tx])), 15_000);
    state = reconcilePassengerMotion(state, snapshot([]));
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).departingPassengers).toEqual([]);
    const lostBeforeBoarding = reconcilePassengerMotion(
      createPassengerMotion(snapshot([tx])),
      snapshot([]),
    );
    expect(pose(runFor(lostBeforeBoarding, 15_000), tx.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      selectedForCandidate: false,
    });
  });

  it('preserves a moving path across refreshes and handles a real canonical confirmation reversal', () => {
    const tx = transaction('b'.repeat(64));
    let state = runFor(createPassengerMotion(live([tx])), 1_000);
    const before = pose(state, tx.id);
    state = reconcilePassengerMotion(state, { ...live([tx]), observedAt: 1_700_000_001_000 });
    expect(pose(state, tx.id)).toMatchObject({ x: before.x, y: before.y, phase: before.phase });
    state = runFor(state, 15_000);
    state = reconcilePassengerMotion(state, live([], 101, [tx.id]));
    expect(state.preparationStartedAt).not.toBeNull();
    const revised = live([tx], 101);
    revised.blocks = [{ ...revised.blocks[0]!, hash: 'd'.repeat(64) }];
    state = reconcilePassengerMotion(state, snapshotSchema.parse(revised));
    expect(state.preparationStartedAt).toBeNull();
    state = runFor(state, 15_000);
    expect(pose(state, tx.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: true,
      tx: { status: 'pending' },
    });
    expect(passengerFrame(state).departingPassengers).toEqual([]);
  });

  it('prepares exact inclusions before departure, retains unproved riders, and consumes proof in reduced motion', () => {
    const included = Object.freeze(transaction('a'.repeat(64)));
    const waiting = Object.freeze(transaction('b'.repeat(64), 15));
    const baseline = runFor(createPassengerMotion(live([included, waiting])), 15_000);
    const observed = live([waiting], 101, [included.id]);
    const starting = reconcilePassengerMotion(baseline, observed);
    expect(passengerFrame(starting).handoffProgress).toBeNull();
    expect(passengerFrame(starting).preparationProgress).toBe(0);
    expect(pose(starting, waiting.id)).toMatchObject({
      phase: 'exiting',
      tx: { status: 'pending' },
    });
    expect(advancePassengerMotion(starting, 60_000, { paused: true })).toBe(starting);
    expect(advancePassengerMotion(starting, 60_000, { hidden: true })).toBe(starting);
    let state = runFor(starting, preparationDurationMs(observed.chain) + 100);
    expect(passengerFrame(state).handoffProgress).not.toBeNull();
    expect(passengerFrame(state).departingPassengers.map(({ tx }) => tx.id)).toEqual([included.id]);
    const beforeReplay = passengerFrame(state).handoffProgress;
    state = reconcilePassengerMotion(state, {
      ...observed,
      observedAt: observed.observedAt + 1_000,
    });
    expect(passengerFrame(state).handoffProgress).toBe(beforeReplay);
    state = runFor(state, 18_000);
    expect(passengerFrame(state).passengers.some(({ tx }) => tx.id === included.id)).toBe(false);
    expect(pose(state, waiting.id)).toMatchObject({
      phase: 'boarded',
      destination: 'next',
      tx: { status: 'pending' },
    });
    const reduced = passengerFrame(advancePassengerMotion(starting, 100, { reducedMotion: true }));
    expect(reduced.handoffProgress).toBeNull();
    expect(reduced.passengers.some(({ tx }) => tx.id === included.id)).toBe(false);
    expect(reduced.passengers.find(({ tx }) => tx.id === waiting.id)?.tx.status).toBe('pending');
    expect(included.status).toBe('pending');
  });

  it('caps current samples, deduplicates identifiers, and resets across chain or mode', () => {
    const transactions = Array.from({ length: PENDING_SAMPLE_LIMIT + 24 }, (_, index) =>
      transaction(`tx-${index}`),
    );
    const first = createPassengerMotion(snapshot(transactions));
    expect(passengerFrame(first).passengers).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(
      // The public contract rejects duplicates; retain the pure engine's defensive boundary.
      passengerFrame(
        createPassengerMotion({
          ...snapshot([transactions[0]!]),
          transactions: [transactions[0]!, transactions[0]!],
        }),
      ).passengers,
    ).toHaveLength(1);
    const replacement = transaction('c'.repeat(64));
    const newMode = reconcilePassengerMotion(runFor(first, 1_000), live([replacement]));
    expect(newMode.elapsedMs).toBe(0);
    expect(passengerFrame(newMode).passengers.map(({ tx }) => tx.id)).toEqual([replacement.id]);
    expect(reconcilePassengerMotion(first, generateDemoSnapshot('ethereum')).context).toMatch(
      /^ethereum:demo:/,
    );
  });
});
