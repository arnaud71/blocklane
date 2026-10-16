import { describe, expect, it } from 'vitest';
import {
  BITCOIN_LIVE_ARRIVAL_TTL_MS,
  createBitcoinLiveArrivals,
} from '../../server/bitcoinLiveArrivals.js';
import {
  BITCOIN_ARRIVAL_SAMPLE_LIMIT,
  MAX_EVENT_FLOW_IDS,
  transactionSchema,
} from '../../shared/model.js';

const origin = 1_800_000_000_000;
const id = (index: number) => index.toString(16).padStart(64, '0');
const tx = (index: number, patch: Record<string, unknown> = {}) => ({
  txid: id(index),
  fee: 1_000,
  vsize: 210,
  ...patch,
});
const delta = (added: unknown[] = []) => ({
  added,
  removed: [] as string[],
  mined: [] as string[],
});

function fixture() {
  let now = origin;
  const store = createBitcoinLiveArrivals({ source: 'Flux Bitcoin contrôlé', now: () => now });
  return {
    store,
    at: (elapsed: number) => {
      now = origin + elapsed;
    },
  };
}

describe('compact Bitcoin arrivals from consecutive provider deltas', () => {
  it('starts without evidence and preserves genuine fee and weight-derived size without retaining raw details', () => {
    const { store } = fixture();
    expect(store.read()).toBeNull();
    expect(
      store.receive(
        delta([
          tx(1, {
            txid: id(0xabcd).toUpperCase(),
            weight: 801,
            vsize: 300,
            effectiveFeePerVsize: 999_999,
            feePerVsize: 888_888,
            rate: 777_777,
            value: Number.NaN,
            flags: 'unneeded-flags',
            vin: [{ script: 'provider-private-script' }],
          }),
        ]),
        origin,
      ),
    ).toBe(true);
    const sample = store.read()!;
    expect(sample).toEqual({
      source: 'Flux Bitcoin contrôlé',
      observedAt: origin,
      transactions: [
        {
          id: id(0xabcd),
          chain: 'bitcoin',
          feeRate: 1_000 / 200.25,
          size: 200.25,
          status: 'pending',
          kind: 'transfer',
          value: 'Montant non fourni',
        },
      ],
    });
    expect(transactionSchema.safeParse(sample.transactions[0]).success).toBe(true);
    expect(JSON.stringify(sample)).not.toContain('provider-private-script');
    expect(sample.transactions[0]).not.toHaveProperty('blockHash');
  });

  it('accepts compact quarter-byte sizes or a valid weight alone, including a genuine zero fee', () => {
    const { store } = fixture();
    expect(
      store.receive(
        delta([
          tx(1, { fee: 1_051, vsize: 210.25 }),
          tx(2, { vsize: undefined, weight: 841 }),
          tx(3, { fee: 0 }),
        ]),
        origin,
      ),
    ).toBe(true);
    const byId = new Map(
      store.read()!.transactions.map((transaction) => [transaction.id, transaction]),
    );
    expect(byId.get(id(1))).toMatchObject({ size: 210.25, feeRate: 1_051 / 210.25 });
    expect(byId.get(id(2))).toMatchObject({ size: 210.25, feeRate: 1_000 / 210.25 });
    expect(byId.get(id(3))?.feeRate).toBe(0);
  });

  it('keeps receipt order stable on duplicate metadata updates and isolates caller mutations', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1), tx(2)]), origin);
    at(1_000);
    store.receive(delta([tx(1, { fee: 2_000 }), tx(3), tx(3)]), origin + 1_000);
    const sample = store.read()!;
    expect(sample.transactions.map((transaction) => transaction.id)).toEqual([id(3), id(2), id(1)]);
    expect(sample.transactions[2]?.feeRate).toBe(2_000 / 210);
    sample.transactions[0]!.feeRate = 42;
    at(2_000);
    expect(store.read()!.transactions[0]?.feeRate).toBe(1_000 / 210);
    expect(store.read()!.observedAt).toBe(origin + 1_000);
  });

  it('retains only the latest bounded arrivals without changing the ordering of retained IDs', () => {
    const { store } = fixture();
    const count = BITCOIN_ARRIVAL_SAMPLE_LIMIT + 116;
    expect(
      store.receive(delta(Array.from({ length: count }, (_, index) => tx(index))), origin),
    ).toBe(true);
    const sample = store.read()!;
    expect(sample.transactions).toHaveLength(BITCOIN_ARRIVAL_SAMPLE_LIMIT);
    expect(sample.transactions[0]?.id).toBe(id(count - 1));
    expect(sample.transactions.at(-1)?.id).toBe(id(116));
    expect(store.receive(delta([tx(count - 2, { fee: 2_000 })]), origin)).toBe(true);
    expect(store.read()!.transactions[0]?.id).toBe(id(count - 1));
  });

  it('removes withdrawn, mined and replaced IDs without manufacturing replacements or confirmation evidence', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1), tx(2), tx(3), tx(4), tx(5)]), origin);
    at(1_000);
    expect(
      store.receive(
        {
          added: [tx(6)],
          removed: [id(1).toUpperCase()],
          mined: [id(2)],
          replaced: [
            { replaced: id(3), by: { txid: id(6), vin: ['unneeded'] } },
            { replaced: id(4), by: id(7) },
          ],
        },
        origin + 1_000,
      ),
    ).toBe(true);
    const transactions = store.read()!.transactions;
    expect(transactions.map((transaction) => transaction.id)).toEqual([id(6), id(5)]);
    expect(
      transactions.every(
        (transaction) => transaction.status === 'pending' && transaction.blockHash === undefined,
      ),
    ).toBe(true);
  });

  it('does not preserve a pending passenger withdrawn in that same validated delta', () => {
    const { store } = fixture();
    expect(store.receive({ added: [tx(1)], removed: [], mined: [id(1)] }, origin)).toBe(true);
    expect(store.read()?.transactions).toEqual([]);
  });

  it('only renews presence on a validated consecutive delta, including an empty one', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1)]), origin);
    at(59_000);
    expect(store.read()?.observedAt).toBe(origin);
    expect(store.receive(delta(), origin + 59_000)).toBe(true);
    at(59_000 + BITCOIN_LIVE_ARRIVAL_TTL_MS);
    expect(store.read()).toMatchObject({
      observedAt: origin + 59_000,
      transactions: [{ id: id(1) }],
    });
    at(59_001 + BITCOIN_LIVE_ARRIVAL_TTL_MS);
    expect(store.read()).toBeNull();
  });

  it('never revives expired metadata when the next valid batch finally arrives', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1)]), origin);
    at(BITCOIN_LIVE_ARRIVAL_TTL_MS + 1);
    expect(store.receive(delta([tx(2)]), origin + BITCOIN_LIVE_ARRIVAL_TTL_MS + 1)).toBe(true);
    expect(store.read()?.transactions.map((transaction) => transaction.id)).toEqual([id(2)]);
  });

  it('clears all observations at a connection reset and requires a new validated batch', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1)]), origin);
    store.reset();
    expect(store.read()).toBeNull();
    at(1_000);
    expect(store.receive(delta(), origin + 1_000)).toBe(true);
    expect(store.read()).toEqual({
      source: 'Flux Bitcoin contrôlé',
      observedAt: origin + 1_000,
      transactions: [],
    });
  });
});

describe('Bitcoin arrival validation and bounded failure', () => {
  it.each([
    { txid: 'bad-hash' },
    { txid: `0x${id(1)}` },
    { fee: undefined },
    { fee: -1 },
    { fee: 0.1 },
    { fee: Number.NaN },
    { fee: 2_100_000_000_000_001 },
    { vsize: undefined },
    { vsize: 0 },
    { vsize: 0.75 },
    { vsize: 1_000_001 },
    { vsize: 210.1 },
    { vsize: Number.POSITIVE_INFINITY },
    { weight: 0 },
    { weight: 4.5 },
    { weight: 4_000_001 },
    { vsize: 210, weight: 841 },
  ])(
    'rejects invalid or missing own fee/size evidence and resets the whole sample (%j)',
    (patch) => {
      const { store } = fixture();
      store.receive(delta([tx(1)]), origin);
      expect(store.receive(delta([tx(2), tx(3, patch)]), origin)).toBe(false);
      expect(store.read()).toBeNull();
    },
  );

  it.each([
    { added: null, removed: [], mined: [] },
    { added: [null], removed: [], mined: [] },
    { added: [], removed: ['bad-hash'], mined: [] },
    { added: [], removed: [], mined: [42] },
    { added: [], removed: [], mined: [], replaced: null },
    { added: [], removed: [], mined: [], replaced: [{ replaced: id(1) }] },
    { added: [], removed: [], mined: [], replaced: [{ replaced: id(1), by: { txid: 'bad' } }] },
  ])(
    'refuses malformed deltas without retaining partially processed passengers (%j)',
    (invalid) => {
      const { store } = fixture();
      store.receive(delta([tx(1)]), origin);
      expect(store.receive(invalid as unknown as Parameters<typeof store.receive>[0], origin)).toBe(
        false,
      );
      expect(store.read()).toBeNull();
    },
  );

  it('bounds total delta work even when a malicious batch contains only duplicate IDs', () => {
    const { store } = fixture();
    expect(
      store.receive(delta(Array.from({ length: MAX_EVENT_FLOW_IDS }, () => tx(1))), origin),
    ).toBe(true);
    expect(store.read()?.transactions).toHaveLength(1);
    expect(store.receive(delta(Array(MAX_EVENT_FLOW_IDS + 1).fill(tx(1))), origin)).toBe(false);
    expect(store.read()).toBeNull();
    expect(
      store.receive(
        { added: [tx(1)], removed: Array<string>(MAX_EVENT_FLOW_IDS).fill(id(2)), mined: [] },
        origin,
      ),
    ).toBe(false);
  });

  it('rejects future, unsafe, backward and expired dates without refreshing an older observation', () => {
    for (const time of [
      origin + 1,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      origin - 60_001,
      origin - 0.5,
    ]) {
      const { store } = fixture();
      store.receive(delta([tx(1)]), origin);
      expect(store.receive(delta([tx(2)]), time)).toBe(false);
      expect(store.read()).toBeNull();
    }
    const { store, at } = fixture();
    store.receive(delta([tx(1)]), origin);
    at(2_000);
    store.receive(delta([tx(2)]), origin + 2_000);
    expect(store.receive(delta(), origin + 1_000)).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('drops future evidence after a wall-clock rollback and can start from a new validated batch', () => {
    const { store, at } = fixture();
    store.receive(delta([tx(1)]), origin);
    at(-1);
    expect(store.read()).toBeNull();
    expect(store.receive(delta([tx(2)]), origin - 1)).toBe(true);
    expect(store.read()?.transactions.map((transaction) => transaction.id)).toEqual([id(2)]);
  });

  it('never serializes an invalid clock reading and validates the public source label', () => {
    let now = origin;
    const store = createBitcoinLiveArrivals({ source: 'Source stable', now: () => now });
    store.receive(delta([tx(1)]), origin);
    now = Number.NaN;
    expect(store.read()).toBeNull();
    expect(store.receive(delta(), origin)).toBe(false);
    for (const source of ['', ' ', 'x'.repeat(101)])
      expect(() => createBitcoinLiveArrivals({ source })).toThrow('Invalid Bitcoin arrival source');
  });
});
