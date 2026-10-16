import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  bitcoinArrivalObservation,
  isHistoricalPassenger,
  passengerStatus,
} from '../../src/lib/passengerStatus';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
} from '../../src/lib/passengerMotion';
import { assessFreshness } from '../../src/lib/freshness';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const id = (index: number) => index.toString(16).padStart(64, '0');
const transaction = (index: number, size = 250): Tx => ({
  id: id(index),
  chain: 'bitcoin',
  status: 'pending',
  feeRate: index * 2,
  size,
  kind: 'transfer',
  value: '0.01 BTC',
});
function source(
  transactions: Tx[] = [],
  arrivals = transactions,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  const at = overrides.observedAt ?? NOW;
  const parent = {
    hash: id(100),
    height: 100,
    timestamp: NOW / 1_000,
    txCount: 2,
    used: 500_000,
    capacity: 1_000_000,
  };
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Nœud RPC contrôlé',
    observedAt: at,
    coverage: 'Le flux mempool.space et le nœud RPC ont des vues distinctes.',
    pendingCount: 0,
    feeRate: 100,
    feeUnit: 'sat/vB',
    transactions,
    blocks: [parent],
    inclusions: [],
    bitcoinArrivals: {
      source: 'mempool.space contrôlé',
      method: 'mempool-transactions',
      observedAt: at - 500,
      transactionIds: arrivals.map((tx) => tx.id),
    },
    sampling: {
      source: 'Autre nœud RPC',
      method: 'getrawmempool',
      observedAt: at,
      pendingCount: 0,
      update: 'full',
    },
    poolObservation: {
      source: 'Autre nœud RPC',
      method: 'getrawmempool',
      observedAt: at,
      presentTransactionIds: [],
      queuedTransactionIds: [],
      absentTransactionIds: transactions.map((tx) => tx.id),
    },
    ...overrides,
  });
}
function runFor(state: PassengerMotionState, duration: number) {
  for (let at = 0; at < duration; at += 100)
    state = advancePassengerMotion(state, Math.min(100, duration - at));
  return state;
}

describe('independent Bitcoin arrival presence and original transaction details', () => {
  it('identifies the received source without fabricating a full RPC pending inventory', () => {
    const tx = transaction(1);
    const snapshot = source([tx]);
    const proof = bitcoinArrivalObservation(snapshot, tx);
    const observation = {
      tx,
      sourceObserved: true,
      poolState: 'absent' as const,
      bitcoinArrival: proof,
    };
    expect(proof).toEqual({ source: 'mempool.space contrôlé', observedAt: NOW - 500 });
    expect(passengerStatus(observation)).toMatchObject({ kind: 'observed', group: 'current' });
    expect(passengerStatus(observation).description).toContain('mempool.space contrôlé');
    expect(passengerStatus(observation).description).toContain(
      'ne garantit pas sa présence chez un autre fournisseur',
    );
    expect(passengerStatus(observation).description).not.toContain('dernier relevé complet');
    expect(isHistoricalPassenger(observation)).toBe(false);
    expect(bitcoinArrivalObservation({ ...snapshot, status: 'stale' }, tx)).toEqual(proof);
  });
  it('rejects missing, expired, future or mismatched arrival evidence', () => {
    const tx = transaction(1);
    const original = source([tx]);
    for (const snapshot of [
      { ...original, bitcoinArrivals: null },
      { ...original, observedAt: NOW + 60_000 },
      { ...original, bitcoinArrivals: { ...original.bitcoinArrivals!, observedAt: NOW + 1 } },
      { ...original, transactions: [] },
      { ...original, status: 'unavailable' as const },
    ])
      expect(bitcoinArrivalObservation(snapshot, tx)).toBeUndefined();
    expect(bitcoinArrivalObservation(original, transaction(2))).toBeUndefined();
    expect(bitcoinArrivalObservation(original, { ...tx, chain: 'ethereum' })).toBeUndefined();
  });
  it('always gives exact confirmation precedence over a retained arrival proof', () => {
    const tx = transaction(1);
    const snapshot = source([tx]);
    const confirmed: Tx = { ...tx, status: 'confirmed', blockHash: id(101) };
    expect(bitcoinArrivalObservation(snapshot, confirmed)).toBeUndefined();
    expect(
      passengerStatus({
        tx: confirmed,
        sourceObserved: true,
        poolState: 'absent',
        bitcoinArrival: bitcoinArrivalObservation(snapshot, tx),
      }),
    ).toMatchObject({ kind: 'confirmed', group: 'confirmed' });
  });
  it('keeps real new arrivals active despite a conflicting RPC absence and only sends GBT members to the first projection', () => {
    const member = transaction(1, 500);
    const outside = transaction(2, 1_000);
    let state = createPassengerMotion(source());
    const next = source([member, outside], undefined, {
      observedAt: NOW + 3_000,
      blockTemplate: {
        source: 'Candidat du nœud RPC',
        observedAt: NOW + 3_000,
        previousBlockHash: id(100),
        height: 101,
        transactionCount: 1,
        weight: member.size * 4,
        weightLimit: 4_000_000,
        selectedTransactionIds: [member.id],
      },
    });
    state = reconcilePassengerMotion(state, next);
    let frame = passengerFrame(state);
    for (const pose of frame.passengers) {
      expect(pose.arrivalKind).toBe('new-observation');
      expect(pose.phase).toBe('arriving');
      expect(pose.queueZone).toBe('active');
      expect(pose.poolState).toBe('unknown');
      expect(pose.lastObservedAt).toBe(NOW + 2_500);
      expect(passengerStatus(pose).group).toBe('current');
    }
    expect(frame.passengers.find((pose) => pose.tx.id === member.id)?.destination).toBe('next');
    expect(frame.passengers.find((pose) => pose.tx.id === outside.id)?.destination).toBe('later');
    state = runFor(state, 20_000);
    frame = passengerFrame(state);
    expect(frame.passengers.find((pose) => pose.tx.id === member.id)).toMatchObject({
      wagon: 'next',
      phase: 'boarded',
      tx: { status: 'pending', feeRate: member.feeRate, size: member.size },
    });
    expect(frame.passengers.find((pose) => pose.tx.id === outside.id)).toMatchObject({
      wagon: 'later',
      phase: 'boarded',
      tx: { status: 'pending' },
    });
    expect(frame.lastDepartureStartedAt).toBeNull();
  });
  it('removes expired stream presence instead of retaining a current-looking historical traveller', () => {
    const tx = transaction(1);
    let state = createPassengerMotion(source([tx]));
    state = reconcilePassengerMotion(
      state,
      source([], [], {
        observedAt: NOW + 61_000,
        bitcoinArrivals: null,
        poolObservation: {
          source: 'Autre nœud RPC',
          method: 'getrawmempool',
          observedAt: NOW + 61_000,
          presentTransactionIds: [],
          queuedTransactionIds: [],
          absentTransactionIds: [tx.id],
        },
      }),
    );
    const pose = passengerFrame(state).passengers.find((entry) => entry.tx.id === tx.id)!;
    expect(pose.bitcoinArrival).toBeUndefined();
    expect(passengerStatus(pose).kind).toBe('absent');
    expect(isHistoricalPassenger(pose)).toBe(true);
    expect(pose.tx.status).toBe('pending');
  });
  it('retires actual expired arrival details from the active sample while retaining an honest historical avatar', () => {
    const tx = transaction(1);
    const original = source([tx]);
    const state = createPassengerMotion(original);
    const expired = assessFreshness(original, false, NOW + 60_001);
    expect(expired.bitcoinArrivals).toBeNull();
    expect(expired.transactions).toHaveLength(0);
    const reconciled = reconcilePassengerMotion(state, expired);
    const pose = passengerFrame(reconciled).passengers.find((entry) => entry.tx.id === tx.id)!;
    expect(pose).toBeDefined();
    expect(pose.tx).toEqual(tx);
    expect(pose.bitcoinArrival).toBeUndefined();
    expect(pose.sourceObserved).toBe(false);
    expect(pose.lastObservedAt).toBe(NOW - 500);
    expect(passengerStatus(pose).kind).toBe('unknown');
    expect(isHistoricalPassenger(pose)).toBe(true);
  });
});
