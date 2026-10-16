import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_SAMPLE_LIMIT,
  MAX_INDIVIDUAL_HISTORY,
  MAX_TRACKED_TRANSACTIONS,
  MAX_TRANSACTIONS,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  snapshotSchema,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import { fetchBitcoinSnapshot } from '../../server/adapters/bitcoin.js';
import { generateDemoSnapshot } from '../../server/demo.js';
import {
  advancePassengerMotion,
  createPassengerMotion,
  MAX_RESIDENT_PASSENGERS,
  passengerFrame,
  reconcilePassengerMotion,
} from '../../src/lib/passengerMotion';
import {
  PLATFORM_CORRIDOR_X,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  arrivalStart,
  queuePosition,
} from '../../src/lib/streetGeometry';
import { bitcoinFetcher, config, now } from './fixtures.js';

function identifier(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function pending(value: number): Tx {
  return {
    id: identifier(value),
    chain: 'bitcoin',
    feeRate: value + 1,
    size: 200,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant non fourni',
  };
}

function observation(transactions: Tx[]): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé',
    observedAt: now,
    coverage: 'Échantillon limité ; les observations conservées ne sont pas un total de mempool.',
    pendingCount: 10_000,
    feeRate: 8,
    feeUnit: 'sat/vB',
    transactions,
    blocks: [
      {
        hash: identifier(1_000_000),
        height: 1_000_000,
        timestamp: now / 1_000,
        txCount: 2_000,
        used: 900_000,
        capacity: 1_000_000,
      },
    ],
  });
}

describe('Expanded bounded transaction sample', () => {
  it('accepts 1920 pending plus 24 confirmed transactions and rejects a larger response', () => {
    expect(PENDING_SAMPLE_LIMIT).toBe(1_920);
    expect(MAX_INDIVIDUAL_HISTORY).toBe(1_920);
    expect(CONFIRMED_SAMPLE_LIMIT).toBe(24);
    const pendingTransactions = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
      pending(index),
    );
    const confirmedTransactions: Tx[] = Array.from({ length: 24 }, (_, index) => ({
      ...pending(10_000 + index),
      status: 'confirmed',
      blockHash: identifier(1_000_000),
    }));
    const complete = observation([...pendingTransactions, ...confirmedTransactions]);
    expect(complete.transactions).toHaveLength(1_944);
    expect(snapshotSchema.safeParse(complete).success).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...complete,
        transactions: [...complete.transactions, pending(20_000)],
      }).success,
    ).toBe(false);
    expect(MAX_TRANSACTIONS).toBe(1_944);
    expect(MAX_TRACKED_TRANSACTIONS).toBe(4_096);
    expect(TRACKED_TRANSACTION_TTL_MS).toBe(30 * 60_000);
  });

  it('keeps the current sample and a fixed historical budget without extending the public response contract', () => {
    const samples = Array.from({ length: 3 }, (_, sampleIndex) =>
      observation(
        Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
          pending(sampleIndex * PENDING_SAMPLE_LIMIT + index),
        ),
      ),
    );
    let state = createPassengerMotion(samples[0]!);
    state = advancePassengerMotion(state, 0, { reducedMotion: true });
    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
      const source = { ...samples[sampleIndex]!, observedAt: now + sampleIndex * 3_000 };
      expect(source.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
      expect(snapshotSchema.safeParse(source).success).toBe(true);
      state = reconcilePassengerMotion(state, source);
      state = advancePassengerMotion(state, 0, { reducedMotion: true });
    }
    const frame = passengerFrame(state);
    expect(MAX_RESIDENT_PASSENGERS).toBe(3_840);
    expect(frame.passengers).toHaveLength(MAX_RESIDENT_PASSENGERS);
    expect(frame.passengers.filter((rider) => rider.sourceObserved)).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );
    expect(frame.passengers.filter((rider) => !rider.sourceObserved && rider.inWagon)).toHaveLength(
      MAX_INDIVIDUAL_HISTORY,
    );
    expect(frame.projectionUsed).toEqual({ next: MAX_RESIDENT_PASSENGERS * 200, later: 0 });
    expect(
      snapshotSchema.safeParse({
        ...samples[2]!,
        transactions: frame.passengers.map(({ tx }) => tx),
      }).success,
    ).toBe(false);
  });

  it('generates the full pending sample for both demonstrations with consistent provider totals', () => {
    for (const chain of ['bitcoin', 'ethereum'] as const) {
      const demo = generateDemoSnapshot(chain, now, 42);
      const pendingTransactions = demo.transactions.filter((tx) => tx.status === 'pending');
      const confirmedTransactions = demo.transactions.filter((tx) => tx.status === 'confirmed');
      expect(pendingTransactions).toHaveLength(PENDING_SAMPLE_LIMIT);
      expect(confirmedTransactions.length).toBeLessThanOrEqual(CONFIRMED_SAMPLE_LIMIT);
      expect(demo.transactions.length).toBeLessThanOrEqual(MAX_TRANSACTIONS);
      expect(demo.pendingCount).toBeGreaterThanOrEqual(pendingTransactions.length);
      expect(demo.mode).toBe('demo');
      expect(demo.transactions.every((tx) => tx.id.startsWith('demo-'))).toBe(true);
      expect(snapshotSchema.safeParse(demo).success).toBe(true);
    }
  });

  it('preserves a smaller Bitcoin recent response without manufacturing transactions to fill the sample', async () => {
    const recent = Array.from({ length: 1_000 }, (_, index) => ({
      txid: identifier(10_000 + index),
      fee: (index + 1) * 200,
      vsize: 200,
    }));
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher({ '/mempool/recent': recent }),
      () => now,
    );
    const pendingTransactions = result.transactions.filter((tx) => tx.status === 'pending');
    expect(pendingTransactions).toHaveLength(1_000);
    expect(pendingTransactions[0]).toMatchObject({ id: identifier(10_999), feeRate: 1_000 });
    expect(pendingTransactions.at(-1)).toMatchObject({ id: identifier(10_000), feeRate: 1 });
    expect(snapshotSchema.safeParse(result).success).toBe(true);
  });

  it('keeps current, retained and historical queue positions on the platform at the expanded limit', () => {
    const indices = Array.from(
      { length: MAX_RESIDENT_PASSENGERS + PENDING_SAMPLE_LIMIT },
      (_, index) => index,
    );
    for (const index of indices) {
      const place = queuePosition(index);
      expect(place.x).toBeGreaterThan(PLATFORM_CORRIDOR_X);
      expect(place.x).toBeLessThan(SCENE_WIDTH);
      expect(place.y).toBeGreaterThan(0);
      expect(place.y).toBeLessThan(SCENE_HEIGHT);
      const arrival = arrivalStart(index);
      expect(arrival.x).toBeGreaterThan(SCENE_WIDTH);
      expect(arrival.y).toBe(place.y);
    }
  });

  it('shows the full current pending sample and labels retained observations separately without duplication', () => {
    const pendingTransactions = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
      pending(index),
    );
    const confirmedTransactions: Tx[] = Array.from(
      { length: CONFIRMED_SAMPLE_LIMIT },
      (_, index) => ({
        ...pending(10_000 + index),
        status: 'confirmed',
        blockHash: identifier(1_000_000),
      }),
    );
    const source = observation([...pendingTransactions, ...confirmedTransactions]);
    let state = advancePassengerMotion(createPassengerMotion(source), 100, { reducedMotion: true });
    expect(passengerFrame(state).passengers).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(
      passengerFrame(state).passengers.every(
        (rider) => rider.sourceObserved && rider.tx.status === 'pending',
      ),
    ).toBe(true);

    state = reconcilePassengerMotion(state, {
      ...source,
      observedAt: now + 3_000,
      transactions: [],
    });
    const retained = passengerFrame(state);
    expect(retained.passengers).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(
      retained.passengers.every(
        (rider) => !rider.sourceObserved && rider.inWagon && rider.tx.status === 'pending',
      ),
    ).toBe(true);
    state = reconcilePassengerMotion(state, { ...source, observedAt: now + 6_000 });
    const restored = passengerFrame(state);
    expect(restored.passengers).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(new Set(restored.passengers.map(({ tx }) => tx.id)).size).toBe(PENDING_SAMPLE_LIMIT);
    expect(restored.passengers.every((rider) => rider.sourceObserved)).toBe(true);
    expect(restored.projectionUsed.next).toBe(PENDING_SAMPLE_LIMIT * 200);
  });
});
