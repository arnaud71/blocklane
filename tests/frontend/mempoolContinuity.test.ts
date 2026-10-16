import { describe, expect, it } from 'vitest';
import {
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type BitcoinBlockTemplate,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { passengerDescription, passengerWaitingReason } from '../../src/lib/passengerPresentation';
import { exitPlatformPoint } from '../../src/lib/streetGeometry';

const T0 = 1_700_000_000_000;
const id = (n: number, chain: ChainId = 'bitcoin') =>
  `${chain === 'ethereum' ? '0x' : ''}${n.toString(16).padStart(64, '0')}`;
function tx(n: number, chain: ChainId = 'bitcoin', overrides: Partial<Tx> = {}): Tx {
  return {
    id: id(n, chain),
    chain,
    feeRate: 20,
    size: chain === 'ethereum' ? 21_000 : 200,
    status: 'pending',
    kind: 'transfer',
    value: chain === 'ethereum' ? '0.01 ETH' : '0.01 BTC',
    ...overrides,
  };
}
function block(chain: ChainId = 'bitcoin', height = 100): Block {
  return {
    hash: id(100_000 + height, chain),
    height,
    timestamp: T0 / 1_000 + (height - 100) * 12,
    txCount: 1_000,
    used: chain === 'ethereum' ? 30_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
  };
}
function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  const chain = overrides.chain ?? transactions[0]?.chain ?? 'bitcoin';
  const pool = overrides.poolObservation;
  const sampling = pool
    ? pool.method === 'getrawmempool'
      ? {
          source: pool.source,
          method: pool.method,
          observedAt: pool.observedAt,
          update: 'full' as const,
          pendingCount: 10_000,
        }
      : {
          source: pool.source,
          method: pool.method,
          observedAt: pool.observedAt,
          pendingCount: Math.max(transactions.length, pool.presentTransactionIds.length),
          queuedCount: pool.queuedTransactionIds.length,
        }
    : undefined;
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    coverage: 'Échantillon limité et preuves séparées.',
    observedAt: T0,
    pendingCount: chain === 'ethereum' ? null : 10_000,
    feeRate: 10,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions,
    blocks: [block(chain)],
    inclusions: [],
    sampling,
    ...overrides,
  });
}
function template(members: Tx[], observedAt: number, parent = block()): BitcoinBlockTemplate {
  return {
    source: 'Nœud contrôlé',
    observedAt,
    height: parent.height + 1,
    previousBlockHash: parent.hash,
    transactionCount: members.length,
    weight: members.reduce((sum, person) => sum + person.size * 4, 0),
    weightLimit: 4_000_000,
    selectedTransactionIds: members.map(({ id }) => id),
  };
}
function runFor(state: PassengerMotionState, ms: number, speed = 1) {
  let next = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 100)
    next = advancePassengerMotion(next, Math.min(100, ms - elapsed), { speed });
  return next;
}
const settle = (state: PassengerMotionState) =>
  advancePassengerMotion(state, 0, { reducedMotion: true });
function pose(state: PassengerMotionState, identity: string) {
  const found = passengerFrame(state).passengers.find(({ tx }) => tx.id === identity.toLowerCase());
  if (!found) throw new Error(`Voyageur absent : ${identity}`);
  return found;
}
function presence(
  chain: ChainId,
  observedAt: number,
  present: Tx[] = [],
  queued: Tx[] = [],
  absent: Tx[] = [],
) {
  return {
    source: 'Pool contrôlé',
    method: chain === 'ethereum' ? ('txpool_content' as const) : ('getrawmempool' as const),
    observedAt,
    presentTransactionIds: present.map(({ id }) => id),
    queuedTransactionIds: queued.map(({ id }) => id),
    absentTransactionIds: absent.map(({ id }) => id),
  };
}
function projection(baseFeePerGasWei: string, observedAt = T0, parent = block('ethereum')) {
  return {
    parentBlockHash: parent.hash,
    height: parent.height + 1,
    baseFeePerGasWei,
    observedAt,
    source: 'calculated' as const,
  };
}
function eth(n: number, nonce: string, cap: string, overrides: Partial<Tx> = {}): Tx {
  return tx(n, 'ethereum', {
    ethereum: {
      from: `0x${'a'.repeat(40)}`,
      nonce,
      maxFeePerGasWei: cap,
      maxPriorityFeePerGasWei: '2000000000',
    },
    ...overrides,
  });
}

describe('Observed pool and animated continuity', () => {
  it('places the initial inventory on the platform without staging fictitious network arrivals', () => {
    const people = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, n) => tx(n + 1));
    const frame = passengerFrame(createPassengerMotion(snapshot(people)));
    expect(frame.passengers).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(frame.counts.arriving).toBe(0);
    expect(
      frame.passengers.every(
        (person) =>
          person.phase === 'queue' && person.arrivalKind === 'initial-stock' && !person.inWagon,
      ),
    ).toBe(true);
    expect(passengerDescription(frame.passengers[0]!)).toContain('stock initial observé');
    expect(frame.lastDepartureStartedAt).toBeNull();
  });

  it('bounds the arrival stagger of a full new sample while preserving old places and unknown provenance', () => {
    const old = tx(1);
    let state = settle(createPassengerMotion(snapshot([old])));
    const before = pose(state, old.id);
    const people = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, n) => tx(n + 2));
    state = reconcilePassengerMotion(state, snapshot(people, { observedAt: T0 + 3_000 }));
    expect(pose(state, old.id)).toMatchObject({
      x: before.x,
      y: before.y,
      sourceObserved: false,
      lastObservedAt: T0,
    });
    expect(
      Math.max(
        ...state.passengers
          .filter(({ arrivalKind }) => arrivalKind === 'new-observation')
          .map(({ phaseStartedAt }) => phaseStartedAt),
      ) - state.elapsedMs,
    ).toBeLessThanOrEqual(1_500);
    state = runFor(state, 1_600);
    expect(
      passengerFrame(state)
        .passengers.filter(({ arrivalKind }) => arrivalKind === 'new-observation')
        .every(({ progress }) => progress > 0),
    ).toBe(true);
    expect(passengerFrame(state).passengers.some(({ tx }) => tx.status === 'confirmed')).toBe(
      false,
    );
  });

  it('keeps one identity through case changes, duplicate direct input and exact journal replay', () => {
    const person = tx(0xab);
    const source = snapshot([person]);
    // Deliberately bypass parsing to cover the pure engine boundary as well as the contract.
    let state = settle(
      createPassengerMotion({
        ...source,
        transactions: [{ ...person, id: person.id.toUpperCase() }, person],
      }),
    );
    expect(state.passengers).toHaveLength(1);
    const before = pose(state, person.id);
    state = reconcilePassengerMotion(state, {
      ...source,
      observedAt: T0 + 3_000,
      transactions: [{ ...person, id: person.id.toUpperCase() }],
    });
    expect(state.passengers).toHaveLength(1);
    expect(pose(state, person.id)).toMatchObject({ x: before.x, y: before.y, phase: before.phase });
    const mined = block('bitcoin', 101);
    state = reconcilePassengerMotion(state, {
      ...snapshot([], { observedAt: T0 + 6_000, blocks: [mined] }),
      inclusions: [
        {
          block: { ...mined, hash: mined.hash.toUpperCase() },
          transactionIds: [person.id.toUpperCase()],
        },
      ],
    });
    state = settle(state);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([person], { observedAt: T0 + 9_000, blocks: [mined] }),
      ),
    );
    expect(state.passengers).toHaveLength(0);
    expect(state.waitingArchiveCount).toBe(0);
  });

  it('uses a recent node membership after detail expiry without changing its date, status or source provenance', () => {
    const person = tx(20);
    let state = createPassengerMotion(snapshot([person]));
    state = runFor(
      reconcilePassengerMotion(state, snapshot([], { observedAt: T0 + 3_000 })),
      15_000,
    );
    expect(pose(state, person.id).phase).toBe('parked');
    const observedAt = T0 + TRACKED_TRANSACTION_TTL_MS + 1;
    state = reconcilePassengerMotion(
      state,
      snapshot([], { observedAt, blockTemplate: template([person], observedAt) }),
    );
    state = runFor(state, 15_000);
    expect(pose(state, person.id)).toMatchObject({
      phase: 'boarded',
      sourceObserved: false,
      lastObservedAt: T0,
      tx: person,
    });
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
    state = runFor(
      reconcilePassengerMotion(state, snapshot([], { observedAt: observedAt + 31_000 })),
      15_000,
    );
    expect(pose(state, person.id)).toMatchObject({
      phase: 'parked',
      inWagon: false,
      sourceObserved: false,
      lastObservedAt: T0,
    });
  });

  it('distinguishes an explicit local absence from confirmation and lets a newer node proposal supersede that absence', () => {
    const person = tx(21);
    let state = settle(createPassengerMotion(snapshot([person])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 3_000,
          poolObservation: presence('bitcoin', T0 + 3_000, [], [], [person]),
        }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'absent',
      poolObservedAt: T0 + 3_000,
      sourceObserved: false,
      inWagon: false,
      tx: { status: 'pending' },
    });
    expect(passengerWaitingReason(pose(state, person.id))).toContain(
      'ne prouve aucune confirmation',
    );
    expect(passengerFrame(state).departingPassengers).toEqual([]);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 6_000,
          poolObservation: presence('bitcoin', T0 + 3_000, [], [], [person]),
          blockTemplate: template([person], T0 + 6_000),
        }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      inWagon: true,
      sourceObserved: false,
      lastObservedAt: T0,
    });
  });

  it('does not apply older pool evidence over a newer detail and withdraws expired presence without redating details', () => {
    const person = tx(22);
    let state = settle(createPassengerMotion(snapshot([person], { observedAt: T0 + 3_000 })));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 6_000,
          poolObservation: presence('bitcoin', T0, [], [], [person]),
        }),
      ),
    );
    expect(pose(state, person.id).poolState).not.toBe('absent');
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 9_000,
          poolObservation: presence('bitcoin', T0 + 9_000, [person]),
        }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'pending',
      poolObservedAt: T0 + 9_000,
      sourceObserved: false,
      lastObservedAt: T0 + 3_000,
    });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], { observedAt: T0 + 70_000, poolObservation: null }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'unknown',
      sourceObserved: false,
      lastObservedAt: T0 + 3_000,
    });
  });

  it('keeps an expired exclusion as a planning constraint until newer presence, while reporting the current pool state unknown', () => {
    const person = tx(25);
    let state = settle(createPassengerMotion(snapshot([person])));
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 3_000,
          poolObservation: presence('bitcoin', T0 + 3_000, [], [], [person]),
        }),
      ),
    );
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], { observedAt: T0 + 70_000, poolObservation: null }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      poolState: 'unknown',
      inWagon: false,
      reason: 'absent',
      lastObservedAt: T0,
      tx: { status: 'pending' },
    });
    expect(passengerDescription(pose(state, person.id))).toContain(
      'présence actuelle est inconnue',
    );
    state = settle(
      reconcilePassengerMotion(state, snapshot([person], { observedAt: T0 + 73_000 })),
    );
    expect(pose(state, person.id)).toMatchObject({
      inWagon: true,
      poolState: 'unknown',
      sourceObserved: true,
    });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 76_000,
          poolObservation: presence('bitcoin', T0 + 76_000, [], [], [person]),
        }),
      ),
    );
    const mined = block('bitcoin', 101);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          observedAt: T0 + 79_000,
          blocks: [mined],
          inclusions: [{ block: mined, transactionIds: [person.id] }],
        }),
      ),
    );
    expect(passengerFrame(state).passengers.some(({ tx }) => tx.id === person.id)).toBe(false);
    expect(state.waitingArchiveCount).toBe(0);
  });

  it('uses the sample date rather than poll time and keeps a member date separate from a nonmember pool sample', () => {
    const member = tx(23);
    const nonmember = tx(24);
    const source = snapshot([member, nonmember], {
      observedAt: T0 + 6_000,
      blockTemplate: template([member], T0 + 3_000),
      sampling: {
        source: 'Pool contrôlé',
        method: 'getrawmempool',
        update: 'full',
        observedAt: T0,
        pendingCount: 10_000,
      },
      poolObservation: presence('bitcoin', T0, [member, nonmember]),
    });
    const state = settle(createPassengerMotion(source));
    expect(pose(state, member.id).lastObservedAt).toBe(T0 + 3_000);
    expect(pose(state, nonmember.id).lastObservedAt).toBe(T0);
  });

  it('uses exact next-block Ethereum caps and changes eligibility when the projected base fee changes', () => {
    const person = eth(30, '7', '11000000001', { feeRate: 100 });
    let state = settle(
      createPassengerMotion(
        snapshot([person], { chain: 'ethereum', ethereumProjection: projection('11000000002') }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({ inWagon: false, reason: 'fee' });
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([person], {
          observedAt: T0 + 3_000,
          ethereumProjection: projection('11000000001', T0 + 3_000),
        }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({ inWagon: true, tx: { status: 'pending' } });
    expect(state.ethereumProjection?.baseFeePerGasWei).toBe('11000000001');
  });

  it('withdraws an expired next-block reference rather than comparing known Ethereum caps against the previous block', () => {
    const person = eth(35, '8', '35000000000', { feeRate: 35 });
    let state = settle(
      createPassengerMotion(
        snapshot([person], { feeRate: 40, ethereumProjection: projection('35000000000') }),
      ),
    );
    expect(pose(state, person.id).inWagon).toBe(true);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([person], {
          observedAt: T0 + 30_001,
          feeRate: 40,
          ethereumProjection: projection('35000000000'),
        }),
      ),
    );
    expect(pose(state, person.id)).toMatchObject({
      inWagon: false,
      reason: 'projection',
      tx: { status: 'pending' },
    });
    expect(passengerWaitingReason(pose(state, person.id))).toContain('indisponible ou expirée');
    expect(state.ethereumProjection).toBeNull();
    expect(passengerFrame(state).lastDepartureStartedAt).toBeNull();
  });

  it('does not skip a known blocked nonce and orders a high-fee child after its eligible predecessor', () => {
    const parent = eth(31, '9007199254740993', '5000000000');
    const child = eth(32, '9007199254740994', '100000000000', { feeRate: 100 });
    let state = settle(
      createPassengerMotion(
        snapshot([child, parent], { ethereumProjection: projection('10000000000') }),
      ),
    );
    expect(pose(state, parent.id).reason).toBe('fee');
    expect(pose(state, child.id)).toMatchObject({ inWagon: false, reason: 'nonce' });
    const eligibleParent = {
      ...parent,
      ethereum: { ...parent.ethereum!, maxFeePerGasWei: '12000000000' },
    };
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([child, eligibleParent], {
          observedAt: T0 + 3_000,
          ethereumProjection: projection('10000000000', T0 + 3_000),
        }),
      ),
    );
    expect(pose(state, child.id).inWagon).toBe(true);
    expect(pose(state, parent.id).inWagon).toBe(true);
  });

  it('keeps queued identities out and recognizes a newer same-account nonce replacement without a confirmation', () => {
    const original = eth(33, '12', '20000000000');
    const replacement = eth(34, '12', '30000000000');
    let state = settle(
      createPassengerMotion(
        snapshot([original], { ethereumProjection: projection('10000000000') }),
      ),
    );
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([replacement], {
          observedAt: T0 + 3_000,
          ethereumProjection: projection('10000000000', T0 + 3_000),
          sampling: {
            source: 'Pool contrôlé',
            method: 'txpool_content',
            observedAt: T0 + 3_000,
            pendingCount: 1,
            queuedCount: 0,
          },
        }),
      ),
    );
    expect(pose(state, original.id)).toMatchObject({
      poolState: 'replaced',
      reason: 'replaced',
      inWagon: false,
      sourceObserved: false,
      lastObservedAt: T0,
      tx: { status: 'pending' },
    });
    expect(pose(state, replacement.id).inWagon).toBe(true);
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([], {
          chain: 'ethereum',
          observedAt: T0 + 6_000,
          poolObservation: presence('ethereum', T0 + 6_000, [], [replacement]),
        }),
      ),
    );
    expect(pose(state, replacement.id)).toMatchObject({
      poolState: 'queued',
      inWagon: false,
      sourceObserved: false,
      tx: { status: 'pending' },
    });
    expect(passengerWaitingReason(pose(state, replacement.id))).toContain('queued');
    expect(passengerFrame(state).departingPassengers).toEqual([]);
  });

  it('does not let an older same-nonce sample replace a newer known candidate', () => {
    const recent = eth(36, '9', '30000000000');
    const older = eth(37, '9', '20000000000');
    let state = settle(
      createPassengerMotion(
        snapshot([recent], {
          observedAt: T0 + 3_000,
          ethereumProjection: projection('10000000000', T0 + 3_000),
        }),
      ),
    );
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([older], {
          observedAt: T0 + 6_000,
          ethereumProjection: projection('10000000000', T0 + 6_000),
          sampling: {
            source: 'Ancien pool contrôlé',
            method: 'txpool_content',
            observedAt: T0,
            pendingCount: 1,
            queuedCount: 0,
          },
        }),
      ),
    );
    expect(pose(state, recent.id)).toMatchObject({
      inWagon: true,
      poolState: 'unknown',
      sourceObserved: false,
      lastObservedAt: T0 + 3_000,
      tx: { status: 'pending' },
    });
    expect(pose(state, older.id)).toMatchObject({
      inWagon: false,
      reason: 'nonce',
      sourceObserved: true,
      lastObservedAt: T0,
    });
    expect(passengerFrame(state).projectionCount).toEqual({ next: 1, later: 0 });
    expect(passengerFrame(state).departingPassengers).toEqual([]);
  });

  it('keeps motion continuous through changing samples and a paused tenfold departure without crossing the road', () => {
    const first = tx(40, 'bitcoin', { size: 600_000 });
    const lower = tx(41, 'bitcoin', { size: 600_000, feeRate: 10 });
    let state = runFor(createPassengerMotion(snapshot([first, lower])), 15_000);
    const mined = block('bitcoin', 101);
    const source = snapshot([], {
      observedAt: T0 + 3_000,
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: [first.id] }],
      blockTemplate: template([], T0 + 3_000, mined),
    });
    state = reconcilePassengerMotion(state, source);
    expect(pose(state, lower.id).phase).toBe('exiting');
    const before = pose(state, lower.id);
    state = reconcilePassengerMotion(state, { ...source, observedAt: T0 + 4_000 });
    expect(pose(state, lower.id)).toMatchObject({ x: before.x, y: before.y });
    expect(advancePassengerMotion(state, 60_000, { paused: true, speed: 10 })).toBe(state);
    for (let step = 0; step < 120; step += 1) {
      state = advancePassengerMotion(state, 50, { speed: 10 });
      const person = pose(state, lower.id);
      if (!person.inWagon && !['boarding', 'exiting'].includes(person.phase))
        expect(person.x).toBeGreaterThanOrEqual(exitPlatformPoint('later').x);
      expect(person.inHandoff).toBe(false);
      expect(person.lastObservedAt).toBe(T0);
      expect(person.tx.status).toBe('pending');
    }
    expect(pose(state, lower.id)).toMatchObject({
      phase: 'boarded',
      wagon: 'later',
      sourceObserved: false,
    });
    expect(passengerFrame(state).passengers.some(({ tx }) => tx.id === first.id)).toBe(false);
  });
});
