import { describe, expect, it } from 'vitest';
import {
  snapshotSchema,
  type EthereumDependencies,
  type EthereumDependency,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  ethereumNonceDependencies,
  type EthereumNonceObservation,
  type EthereumNoncePlanningContext,
} from '../../src/lib/ethereumNonceDependencies';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { passengerDescription, passengerPlanningReason } from '../../src/lib/passengerPresentation';
import { assessFreshness } from '../../src/lib/freshness';

const T0 = Date.parse('2026-10-15T18:00:00Z');
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const FROM = `0x${'a'.repeat(40)}`;
const SOURCE = 'Pool contrôlé';
const HEAD = {
  hash: hash(100),
  height: 100,
  timestamp: T0 / 1_000,
  txCount: 1,
  used: 21_000,
  capacity: 60_000_000,
};

function transaction(id: number, nonce: string, cap = '20000000000'): Tx {
  return {
    id: hash(id),
    chain: 'ethereum',
    status: 'pending',
    feeRate: Number(cap) / 1e9,
    size: 21_000,
    kind: 'transfer',
    value: 'Non mesurée',
    ethereum: { from: FROM, nonce, maxFeePerGasWei: cap, maxPriorityFeePerGasWei: cap },
  };
}

function entry(tx: Tx, predecessor: EthereumDependency['predecessor']): EthereumDependency {
  return { transactionId: tx.id, from: tx.ethereum!.from, nonce: tx.ethereum!.nonce, predecessor };
}

function dependencies(entries: EthereumDependency[], at = T0, head = HEAD): EthereumDependencies {
  return {
    source: SOURCE,
    observedAt: at,
    parentBlockHash: head.hash,
    height: head.height + 1,
    entries,
  };
}

function planning(
  known: EthereumNonceObservation[],
  overrides: Partial<EthereumNoncePlanningContext> = {},
): EthereumNoncePlanningContext {
  return {
    observedAt: T0,
    healthy: true,
    parentBlockHash: HEAD.hash,
    height: HEAD.height + 1,
    known,
    inclusions: new Map(),
    ...overrides,
  };
}

function snapshot(transactions: Tx[], overrides: Partial<Snapshot> = {}): Snapshot {
  const at = overrides.observedAt ?? T0;
  const head = overrides.blocks?.[0] ?? HEAD;
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt: at,
    coverage: 'Projection contrôlée, sans preuve de confirmation par une place animée.',
    pendingCount: 100,
    feeRate: 10,
    feeUnit: 'Gwei',
    transactions,
    blocks: [head],
    inclusions: [],
    ethereumProjection: {
      parentBlockHash: head.hash,
      height: head.height + 1,
      baseFeePerGasWei: '10000000000',
      source: 'calculated',
      observedAt: at,
    },
    ...overrides,
  });
}

function withPool(
  source: Snapshot,
  context: EthereumDependencies,
  pending: string[],
  queued: string[] = [],
  absent: string[] = [],
): Snapshot {
  return snapshotSchema.parse({
    ...source,
    sampling: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: context.observedAt,
      pendingCount: 100,
      queuedCount: 10,
    },
    poolObservation: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: context.observedAt,
      presentTransactionIds: pending,
      queuedTransactionIds: queued,
      absentTransactionIds: absent,
    },
    ethereumDependencies: context,
  });
}

function settle(state: PassengerMotionState): PassengerMotionState {
  return advancePassengerMotion(state, 0, { reducedMotion: true });
}
function pose(state: PassengerMotionState, id: string) {
  return passengerFrame(state).passengers.find(({ tx }) => tx.id === id)!;
}

describe('Ethereum nonce metadata beyond the animated candidates', () => {
  it('keeps an immediate known predecessor outside the candidates as an actual edge', () => {
    const parent = transaction(1, '9007199254740993', '5000000000');
    const child = transaction(2, '9007199254740994', '100000000000');
    const plan = ethereumNonceDependencies(
      [child],
      planning([
        { tx: parent, observedAt: T0, resident: true },
        { tx: child, observedAt: T0 },
      ]),
    );
    expect(plan.dependencies.get(child.id)).toMatchObject({
      predecessor: { state: 'pending', nonce: parent.ethereum!.nonce, transactionId: parent.id },
    });
    let state = settle(createPassengerMotion(snapshot([parent, child])));
    expect(pose(state, child.id)).toMatchObject({ inWagon: false, reason: 'nonce' });
    state = settle(reconcilePassengerMotion(state, snapshot([child], { observedAt: T0 + 3_000 })));
    expect(pose(state, parent.id).sourceObserved).toBe(false);
    expect(pose(state, child.id)).toMatchObject({ inWagon: false, reason: 'nonce' });
    expect(passengerPlanningReason(pose(state, child.id))).toContain('hors de l’échantillon animé');
  });

  it('includes archived account metadata without restoring an avatar or refreshing its provenance', () => {
    const parent = transaction(3, '4', '5000000000');
    const child = transaction(4, '5', '100000000000');
    let state = createPassengerMotion(snapshot([child]));
    state = {
      ...state,
      waitingArchiveTransactions: new Map([[parent.id, { tx: parent, lastSeenAt: T0 }]]),
    };
    state = settle(reconcilePassengerMotion(state, snapshot([child], { observedAt: T0 + 3_000 })));
    expect(pose(state, child.id)).toMatchObject({ inWagon: false, reason: 'nonce' });
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(state.waitingArchiveTransactions.get(parent.id)?.lastSeenAt).toBe(T0);
  });

  it('uses the full-pool edge to a predecessor outside all individual details', () => {
    const parent = transaction(5, '8', '5000000000');
    const child = transaction(6, '9', '100000000000');
    const context = dependencies([
      entry(child, { state: 'pending', nonce: '8', transactionId: parent.id }),
    ]);
    const state = settle(
      createPassengerMotion(withPool(snapshot([child]), context, [parent.id, child.id])),
    );
    expect(passengerFrame(state).passengers).toHaveLength(1);
    expect(pose(state, child.id)).toMatchObject({
      inWagon: false,
      reason: 'nonce',
      nonceDependency: { coverage: 'current' },
    });
    expect(passengerDescription(pose(state, child.id))).toContain(parent.id.slice(0, 12));
  });

  it('does not turn an expired, disappeared or wrong-parent external edge into a root', () => {
    const parent = transaction(7, '8');
    const child = transaction(8, '9', '100000000000');
    const context = dependencies([
      entry(child, { state: 'pending', nonce: '8', transactionId: parent.id }),
    ]);
    let state = settle(
      createPassengerMotion(withPool(snapshot([child]), context, [parent.id, child.id])),
    );
    state = settle(reconcilePassengerMotion(state, snapshot([child], { observedAt: T0 + 60_001 })));
    expect(pose(state, child.id)).toMatchObject({
      inWagon: false,
      reason: 'nonce',
      nonceDependency: { predecessor: { state: 'unknown', transactionId: parent.id } },
    });
    expect(passengerPlanningReason(pose(state, child.id))).toContain('ancienne ou indisponible');
    const wrongParent = dependencies(context.entries, T0, { ...HEAD, hash: hash(999) });
    const plan = ethereumNonceDependencies(
      [child],
      planning([{ tx: child, observedAt: T0 }], { dependencies: wrongParent }),
    );
    expect(plan.dependencies.get(child.id)).toMatchObject({
      blocked: true,
      predecessor: { state: 'unknown' },
    });
  });

  it('keeps a remembered edge when a newer partial observation simply has no predecessor', () => {
    const parent = transaction(9, '1');
    const child = transaction(10, '2');
    const first = ethereumNonceDependencies(
      [child],
      planning([{ tx: child, observedAt: T0 }], {
        dependencies: dependencies([
          entry(child, { state: 'pending', nonce: '1', transactionId: parent.id }),
        ]),
      }),
    ).dependencies.get(child.id)!;
    const plan = ethereumNonceDependencies(
      [child],
      planning([{ tx: child, observedAt: T0 + 3_000, dependency: first }], {
        observedAt: T0 + 3_000,
        dependencies: dependencies([entry(child, { state: 'unobserved', nonce: '1' })], T0 + 3_000),
      }),
    );
    expect(plan.dependencies.get(child.id)).toMatchObject({
      blocked: true,
      predecessor: { state: 'unknown', transactionId: parent.id },
    });
  });

  it('expires remembered pool coverage while the same snapshot keeps its original receipt time', () => {
    const parent = transaction(26, '8', '5000000000');
    const child = transaction(27, '9', '100000000000');
    const source = withPool(
      snapshot([parent, child]),
      dependencies([
        entry(parent, { state: 'unobserved', nonce: '7' }),
        entry(child, { state: 'pending', nonce: '8', transactionId: parent.id }),
      ]),
      [parent.id, child.id],
    );
    let state = settle(createPassengerMotion(source));
    const expired = assessFreshness(source, false, T0 + 60_001);
    expect(expired.status).toBe('ok');
    expect(expired.observedAt).toBe(T0);
    expect(expired.ethereumDependencies).toBeNull();
    expect(expired.poolObservation).toBeNull();
    state = settle(reconcilePassengerMotion(state, expired));
    expect(pose(state, child.id)).toMatchObject({
      inWagon: false,
      nonceDependency: {
        coverage: 'stale',
        predecessor: { state: 'unknown', transactionId: parent.id },
      },
    });
    state = settle(reconcilePassengerMotion(state, expired));
    expect(pose(state, child.id).nonceDependency?.predecessor.state).toBe('unknown');
    expect(passengerPlanningReason(pose(state, child.id))).toContain('ancienne ou indisponible');
  });

  it('switches a same-nonce parent edge to the newer replacement without confirming its old hash', () => {
    const original = transaction(11, '12', '5000000000');
    const replacement = transaction(12, '12', '30000000000');
    const child = transaction(13, '13', '100000000000');
    let state = settle(createPassengerMotion(snapshot([original, child])));
    state = settle(
      reconcilePassengerMotion(state, snapshot([replacement, child], { observedAt: T0 + 3_000 })),
    );
    expect(pose(state, original.id)).toMatchObject({
      tx: { status: 'pending' },
      poolState: 'replaced',
      inWagon: false,
    });
    expect(pose(state, replacement.id).inWagon).toBe(true);
    expect(pose(state, child.id)).toMatchObject({
      inWagon: true,
      tx: { status: 'pending' },
      nonceDependency: { predecessor: { transactionId: replacement.id } },
    });
    expect(passengerFrame(state).departingPassengers).toHaveLength(0);
  });

  it('releases only a proved exact predecessor and becomes unknown again on a contradicted block', () => {
    const parent = transaction(14, '20', '5000000000');
    const child = transaction(15, '21', '100000000000');
    let state = settle(createPassengerMotion(snapshot([parent, child])));
    const mined = { ...HEAD, hash: hash(101), height: 101 };
    const observedAt = T0 + 3_000;
    const proof = snapshot([child], {
      observedAt,
      blocks: [mined],
      inclusions: [{ block: mined, transactionIds: [parent.id] }],
    });
    state = settle(
      reconcilePassengerMotion(
        state,
        withPool(
          proof,
          dependencies(
            [
              entry(child, {
                state: 'confirmed',
                nonce: '20',
                transactionId: parent.id,
                blockHash: mined.hash,
                blockHeight: mined.height,
              }),
            ],
            observedAt,
            mined,
          ),
          [child.id],
          [],
          [parent.id],
        ),
      ),
    );
    expect(pose(state, child.id)).toMatchObject({
      inWagon: true,
      tx: { status: 'pending' },
      nonceDependency: { predecessor: { state: 'confirmed' } },
    });
    expect(passengerPlanningReason(pose(state, child.id))).toContain(
      'elle ne confirme pas cette transaction',
    );
    const revised = { ...mined, hash: hash(102) };
    state = settle(
      reconcilePassengerMotion(
        state,
        snapshot([child], { observedAt: T0 + 6_000, blocks: [revised] }),
      ),
    );
    expect(pose(state, child.id)).toMatchObject({
      inWagon: false,
      reason: 'nonce',
      tx: { status: 'pending' },
      nonceDependency: { predecessor: { state: 'unknown' } },
    });
  });

  it('does not accept an unproved confirmed claim or the hash of another nonce replacement', () => {
    const parent = transaction(16, '2');
    const child = transaction(17, '3');
    const context = dependencies([
      entry(child, {
        state: 'confirmed',
        nonce: '2',
        transactionId: parent.id,
        blockHash: HEAD.hash,
        blockHeight: HEAD.height,
      }),
    ]);
    const plan = ethereumNonceDependencies(
      [child],
      planning([{ tx: child, observedAt: T0 }], {
        dependencies: context,
        inclusions: new Map([[hash(18), { blockHash: HEAD.hash, blockHeight: HEAD.height }]]),
      }),
    );
    expect(plan.dependencies.get(child.id)).toMatchObject({
      blocked: true,
      predecessor: { state: 'unknown' },
    });
  });

  it('distinguishes known sequence gaps and queued parents from an unobserved first pending nonce', () => {
    const first = transaction(19, '1');
    const child = transaction(20, '3', '100000000000');
    let state = settle(createPassengerMotion(snapshot([first, child])));
    expect(pose(state, child.id)).toMatchObject({
      inWagon: false,
      reason: 'nonce',
      nonceDependency: { predecessor: { state: 'gap', nonce: '2' } },
    });
    const context = dependencies([
      entry(child, { state: 'queued', nonce: '2', transactionId: hash(21) }),
    ]);
    state = settle(
      createPassengerMotion(withPool(snapshot([child]), context, [child.id], [hash(21)])),
    );
    expect(pose(state, child.id)).toMatchObject({ inWagon: false, reason: 'nonce' });
    expect(passengerPlanningReason(pose(state, child.id))).toContain('différé (queued)');
    state = settle(createPassengerMotion(snapshot([child])));
    expect(pose(state, child.id)).toMatchObject({
      inWagon: true,
      tx: { status: 'pending' },
      nonceDependency: { predecessor: { state: 'unobserved' } },
    });
    expect(passengerPlanningReason(pose(state, child.id))).toContain('Projection incertaine');
    expect(passengerDescription(pose(state, child.id))).toContain(
      'ne prouve pas que cette transaction peut être exécutée',
    );
  });

  it.each(['confirmed', 'absent', 'stale', 'ambiguous'] as const)(
    'does not invent a gap from a lower %s historical nonce',
    (kind) => {
      const low = transaction(22, '1');
      const child = transaction(23, '3');
      const known: EthereumNonceObservation[] = [
        { tx: child, observedAt: T0 },
        {
          tx: kind === 'confirmed' ? { ...low, status: 'confirmed', blockHash: HEAD.hash } : low,
          observedAt: kind === 'stale' ? T0 - 60_001 : T0,
          ...(kind === 'absent' ? { poolState: 'absent' as const } : {}),
        },
      ];
      if (kind === 'ambiguous') known.push({ tx: transaction(24, '1'), observedAt: T0 });
      const plan = ethereumNonceDependencies(
        [child],
        planning(known, {
          inclusions:
            kind === 'confirmed'
              ? new Map([[low.id, { blockHash: HEAD.hash, blockHeight: HEAD.height }]])
              : new Map(),
        }),
      );
      expect(plan.dependencies.get(child.id)).toMatchObject({
        blocked: false,
        predecessor: { state: 'unobserved' },
      });
    },
  );

  it('treats nonce zero as a known root and does not convert missing metadata into execution proof', () => {
    const root = transaction(25, '0');
    const state = settle(createPassengerMotion(snapshot([root])));
    expect(pose(state, root.id)).toMatchObject({
      inWagon: true,
      tx: { status: 'pending' },
      nonceDependency: { predecessor: { state: 'root' } },
    });
    expect(passengerPlanningReason(pose(state, root.id))).toBe('');
    expect(passengerFrame(state).departingPassengers).toHaveLength(0);
  });
});
