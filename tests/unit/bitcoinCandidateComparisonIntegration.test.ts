import { describe, expect, it, vi } from 'vitest';
import { createBitcoinProvider } from '../../server/adapters/bitcoin';
import {
  type BitcoinTemplateReader,
  type BitcoinTemplateSample,
} from '../../server/adapters/bitcoinTemplate';
import { type Fetcher } from '../../server/network';
import {
  MAX_TRANSACTIONS,
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type Tx,
} from '../../shared/model';
import { config, now } from './fixtures';

const id = (number: number) => number.toString(16).padStart(64, '0');

function rawBlock(
  height: number,
  ids: readonly string[],
  hash = id(height),
  parent = id(height - 1),
) {
  return {
    id: hash,
    height,
    previousblockhash: parent,
    timestamp: Math.floor(now / 1_000),
    tx_count: ids.length,
    weight: Math.max(800, ids.length * 800),
  };
}

function template(
  parent: ReturnType<typeof rawBlock>,
  ids: readonly string[],
  observedAt: number,
): BitcoinTemplateSample {
  const transactions: Tx[] = ids.slice(0, PENDING_SAMPLE_LIMIT).map((transactionId) => ({
    id: transactionId,
    chain: 'bitcoin',
    status: 'pending',
    size: 200,
    feeRate: 10,
    kind: 'transfer',
    value: 'Montant non fourni',
  }));
  return {
    transactions,
    transactionIds: new Set(ids),
    count: ids.length,
    source: 'Candidat contrôlé',
    observedAt,
    height: parent.height + 1,
    previousBlockHash: parent.id,
    weight: ids.length * 800,
    weightLimit: 4_000_000,
    medianFeeSats: ids.length ? 2_000 : null,
  };
}

function harness(ids = [id(11), id(12), id(13)]) {
  const initial = rawBlock(900_000, [id(0)]);
  const proofs = new Map<string, readonly string[]>([[initial.id, [id(0)]]]);
  const state = {
    time: now,
    blocks: [initial],
    sample: template(initial, ids, now) as BitcoinTemplateSample | null,
    failedProof: false,
    proofOverride: undefined as unknown,
    feesGate: null as Promise<void> | null,
    nextClockRead: null as (() => void) | null,
    nextProofRead: null as (() => void) | null,
  };
  const fetcher = vi.fn<Fetcher>(async (input) => {
    const path = new URL(String(input)).pathname.replace(/^\/api/, '');
    if (path === '/v1/blocks') return Response.json(state.blocks);
    if (path === '/mempool')
      return Response.json({ count: 20_000, vsize: 4_000_000, total_fee: 2_000_000 });
    if (path === '/v1/fees/recommended') {
      await state.feesGate;
      return Response.json({ fastestFee: 10, halfHourFee: 7, hourFee: 5 });
    }
    if (path === '/mempool/recent') return Response.json([]);
    const matched = /^\/block\/([a-f0-9]{64})\/txids$/.exec(path);
    if (matched) {
      state.nextProofRead?.();
      state.nextProofRead = null;
      if (state.failedProof) return Response.json({}, { status: 503 });
      return Response.json(state.proofOverride ?? proofs.get(matched[1]!));
    }
    throw new Error(`Unexpected fixture route: ${path}`);
  });
  const reader: BitcoinTemplateReader = Object.assign(() => state.sample, {
    state: () => ({ pending: false, nextAttemptAt: state.time + 15_000, failure: null }),
  });
  const projected = vi.fn(async (): Promise<Tx[]> => []);
  const provider = createBitcoinProvider(
    config,
    fetcher,
    () => {
      state.nextClockRead?.();
      state.nextClockRead = null;
      return state.time;
    },
    projected,
    undefined,
    reader,
  );
  function advanceTip(actualIds = [id(0), id(11), id(12), id(14)]) {
    const previous = state.blocks[0]!;
    const latest = rawBlock(previous.height + 1, actualIds, id(previous.height + 1), previous.id);
    state.time += 3_000;
    state.blocks = [latest, previous];
    proofs.set(latest.id, actualIds);
    state.sample = template(latest, [id(99)], state.time);
    return latest;
  }
  return { state, provider, fetcher, projected, advanceTip, proofs, initial };
}

describe('Bitcoin candidate comparison through existing block and inclusion reads', () => {
  it('publishes a full aggregate against the earlier candidate while the reader already offers the next one', async () => {
    const setup = harness();
    const first = await setup.provider();
    expect(first.candidateComparison).toBeNull();
    const latest = setup.advanceTip();
    const result = await setup.provider();
    expect(snapshotSchema.safeParse(result).success).toBe(true);
    expect(result.blockTemplate?.height).toBe(latest.height + 1);
    expect(result.candidateComparison).toMatchObject({
      blockHash: latest.id,
      parentBlockHash: setup.initial.id,
      candidateObservedAt: now,
      blockObservedAt: now + 3_000,
      candidateTransactionCount: 3,
      blockTransactionCount: 3,
      commonCount: 2,
      candidateOnlyCount: 1,
      blockOnlyCount: 1,
    });
    expect(setup.fetcher).toHaveBeenCalledTimes(10);
    expect(setup.projected).not.toHaveBeenCalled();
    const paths = setup.fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(
      paths.every((path) =>
        /\/(?:v1\/blocks|mempool(?:\/recent)?|v1\/fees\/recommended|block\/[a-f0-9]{64}\/txids)$/.test(
          path,
        ),
      ),
    ).toBe(true);
  });

  it('compares every candidate and block ID beyond the limited individually sampled transactions', async () => {
    const candidateCount = PENDING_SAMPLE_LIMIT + 240;
    const commonCount = PENDING_SAMPLE_LIMIT + 140;
    const ids = Array.from({ length: candidateCount }, (_, index) => id(index + 1));
    const setup = harness(ids);
    const initial = await setup.provider();
    expect(initial.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(initial.blockTemplate?.transactionCount).toBe(candidateCount);
    setup.advanceTip([id(0), ...ids.slice(0, commonCount), id(9_999)]);
    const result = await setup.provider();
    expect(result.candidateComparison).toMatchObject({
      candidateTransactionCount: candidateCount,
      blockTransactionCount: commonCount + 1,
      commonCount,
      candidateOnlyCount: 100,
      blockOnlyCount: 1,
    });
    expect(result.transactions.length).toBeLessThanOrEqual(MAX_TRANSACTIONS);
  });

  it('freezes the first detection time before slower REST responses and never substitutes the following candidate', async () => {
    const setup = harness();
    await setup.provider();
    const latest = setup.advanceTip();
    let release!: () => void;
    setup.state.feesGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const detected = new Promise<void>((resolve) => {
      setup.state.nextClockRead = resolve;
    });
    const collecting = setup.provider();
    await detected;
    setup.state.time += 5_000;
    setup.state.sample = template(latest, [id(101), id(102)], setup.state.time);
    release();
    const result = await collecting;
    expect(result.observedAt).toBe(now + 8_000);
    expect(result.blockTemplate?.observedAt).toBe(now + 8_000);
    expect(result.candidateComparison).toMatchObject({
      candidateObservedAt: now,
      blockObservedAt: now + 3_000,
      candidateTransactionCount: 3,
      commonCount: 2,
    });
  });

  it('does not invent a prior candidate when one first arrives after detection, even with an earlier self-reported date', async () => {
    const setup = harness();
    setup.state.sample = null;
    await setup.provider();
    setup.advanceTip();
    setup.state.sample = null;
    let release!: () => void;
    setup.state.feesGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const detected = new Promise<void>((resolve) => {
      setup.state.nextClockRead = resolve;
    });
    const collecting = setup.provider();
    await detected;
    setup.state.time += 5_000;
    setup.state.sample = template(setup.initial, [id(11), id(12), id(13)], now + 1_000);
    release();
    const result = await collecting;
    expect(result.candidateComparison).toBeNull();
    expect(result.blockTemplate).toBeNull();
  });

  it('keeps the chain snapshot usable if the clock briefly rewinds between head detection and evidence completion', async () => {
    const setup = harness();
    await setup.provider();
    setup.advanceTip();
    let release!: () => void;
    setup.state.feesGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const detected = new Promise<void>((resolve) => {
      setup.state.nextClockRead = resolve;
    });
    const collecting = setup.provider();
    await detected;
    setup.state.time = now + 2_000;
    setup.state.nextProofRead = () => {
      setup.state.time = now + 4_000;
    };
    release();
    const result = await collecting;
    expect(result.observedAt).toBe(now + 2_000);
    expect(result.candidateComparison).toBeNull();
    expect(result.status).toBe('ok');
    expect(snapshotSchema.safeParse(result).success).toBe(true);
  });

  it('retries failed existing txid evidence for the same block without replacing its frozen candidate or time', async () => {
    const setup = harness();
    await setup.provider();
    setup.advanceTip();
    setup.state.failedProof = true;
    expect((await setup.provider()).candidateComparison).toBeNull();
    setup.state.time += 3_000;
    setup.state.failedProof = false;
    const result = await setup.provider();
    expect(result.candidateComparison).toMatchObject({
      commonCount: 2,
      candidateObservedAt: now,
      blockObservedAt: now + 3_000,
    });
    expect(
      setup.fetcher.mock.calls.filter(([input]) => String(input).endsWith('/txids')),
    ).toHaveLength(3);
  });

  it.each([
    { proof: [id(0), id(11), id(12)] },
    { proof: [id(0), id(11), id(11), id(14)] },
    { proof: [id(0), id(11), id(12), 'invalid'] },
  ])(
    'does not report a partial/duplicate/invalid full block list as zero overlap (%j)',
    async ({ proof }) => {
      const setup = harness();
      await setup.provider();
      setup.advanceTip();
      setup.state.proofOverride = proof;
      expect((await setup.provider()).candidateComparison).toBeNull();
      setup.state.proofOverride = undefined;
      setup.state.time += 3_000;
      expect((await setup.provider()).candidateComparison?.commonCount).toBe(2);
    },
  );

  it('reuses the existing checked tip and aggregate on subsequent polls without another txid request', async () => {
    const setup = harness();
    await setup.provider();
    setup.advanceTip();
    const first = await setup.provider();
    setup.state.time += 3_000;
    const second = await setup.provider();
    expect(second.candidateComparison).toEqual(first.candidateComparison);
    expect(second.observedAt).toBe(now + 6_000);
    expect(second.candidateComparison?.blockObservedAt).toBe(now + 3_000);
    expect(setup.fetcher).toHaveBeenCalledTimes(14);
    expect(
      setup.fetcher.mock.calls.filter(([input]) => String(input).endsWith('/txids')),
    ).toHaveLength(2);
  });

  it('removes the aggregate for a different latest block with no usable earlier candidate', async () => {
    const setup = harness();
    await setup.provider();
    setup.advanceTip();
    expect((await setup.provider()).candidateComparison).not.toBeNull();
    setup.state.time += 31_000;
    setup.advanceTip([id(0), id(99)]);
    expect((await setup.provider()).candidateComparison).toBeNull();
  });

  it('invalidates old aggregates on a same-height reorganization', async () => {
    const setup = harness();
    await setup.provider();
    const latest = setup.advanceTip();
    expect((await setup.provider()).candidateComparison).not.toBeNull();
    const replacement = { ...latest, id: id(999_000) };
    setup.state.blocks = [replacement, setup.initial];
    setup.proofs.set(replacement.id, [id(0), id(11), id(12), id(14)]);
    setup.state.sample = template(replacement, [id(99)], setup.state.time);
    setup.state.time += 3_000;
    expect((await setup.provider()).candidateComparison).toBeNull();
  });

  it('does not compare at startup without a previously published candidate', async () => {
    const setup = harness();
    setup.advanceTip();
    const result = await setup.provider();
    expect(result.blockTemplate).not.toBeNull();
    expect(result.candidateComparison).toBeNull();
  });

  it('reports known zero counts for an empty valid proposal followed by a coinbase-only block', async () => {
    const setup = harness([]);
    await setup.provider();
    setup.advanceTip([id(0)]);
    expect((await setup.provider()).candidateComparison).toMatchObject({
      candidateTransactionCount: 0,
      blockTransactionCount: 0,
      commonCount: 0,
      candidateOnlyCount: 0,
      blockOnlyCount: 0,
    });
  });
});
