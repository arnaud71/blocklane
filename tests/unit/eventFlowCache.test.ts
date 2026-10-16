import { describe, expect, it, vi } from 'vitest';
import { SnapshotService } from '../../server/cache.js';
import { eventFlowSchema, type ChainId, type EventFlow } from '../../shared/model.js';
import { config, liveSnapshot, now } from './fixtures.js';

describe('shared event decoration and isolation', () => {
  it('uses the final pending selection, keeps block dates and disposes one shared stream reader', async () => {
    const source = liveSnapshot('bitcoin', now - 1_000);
    const flow = eventFlowSchema.parse({
      source: 'Flux contrôlé',
      method: 'mempool-txids',
      state: 'live',
      epoch: 2,
      startedAt: now - 3_000,
      observedAt: now,
      lastMessageAt: now,
      history: [
        {
          fromObservedAt: now - 3_000,
          observedAt: now,
          enteredCount: 5,
          outsideSampleEnteredCount: 4,
        },
      ],
    });
    const read = vi.fn<(chain: ChainId, selection: ReadonlySet<string>) => EventFlow>(() => flow);
    const dispose = vi.fn();
    const provider = vi.fn(async () => source);
    const service = new SnapshotService({
      config,
      now: () => now,
      providers: { bitcoin: provider, ethereum: provider },
      eventFlows: { read, dispose },
    });
    const result = await service.get('bitcoin', 'live');
    expect(result.eventFlow).toEqual(flow);
    expect(result.observedAt).toBe(source.observedAt);
    expect(read.mock.calls[0]?.[1]).toEqual(
      new Set(source.transactions.filter((tx) => tx.status === 'pending').map((tx) => tx.id)),
    );
    await service.get('bitcoin', 'live');
    expect(provider).toHaveBeenCalledTimes(1);
    const count = read.mock.calls.length;
    expect((await service.get('bitcoin', 'demo')).eventFlow ?? null).toBeNull();
    expect(read).toHaveBeenCalledTimes(count);
    service.dispose();
    service.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await service.get('bitcoin', 'live');
    expect(read).toHaveBeenCalledTimes(count);
  });

  it('keeps optional stream errors, invalid chains and future dates from hiding valid blocks', async () => {
    const source = liveSnapshot('bitcoin', now);
    const read = vi.fn(() => {
      throw new Error('private-transport-key');
    });
    const service = new SnapshotService({
      config,
      now: () => now,
      providers: { bitcoin: async () => source, ethereum: async () => source },
      eventFlows: { read, dispose() {} },
    });
    const result = await service.get('bitcoin', 'live');
    expect(result.status).toBe('ok');
    expect(result.blocks).toEqual(source.blocks);
    expect(result.eventFlow).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-transport-key');
  });

  it('rejects cross-chain or future stream data and interrupts expired publications', async () => {
    const source = liveSnapshot('bitcoin', now);
    for (const [method, time, expected] of [
      ['newPendingTransactions', now, null],
      ['mempool-txids', now + 1, null],
      ['mempool-txids', now - 15_001, 'interrupted'],
    ] as const) {
      const flow = eventFlowSchema.parse({
        source: 'Flux contrôlé',
        method,
        state: 'live',
        epoch: 1,
        startedAt: time - 3_000,
        observedAt: time,
        lastMessageAt: time,
        history: [
          {
            fromObservedAt: time - 3_000,
            observedAt: time,
            enteredCount: 1,
            outsideSampleEnteredCount: 1,
          },
        ],
      });
      const service = new SnapshotService({
        config,
        now: () => now,
        providers: { bitcoin: async () => source, ethereum: async () => source },
        eventFlows: { read: () => flow, dispose() {} },
      });
      const result = await service.get('bitcoin', 'live');
      expect(result.status).toBe('ok');
      expect(result.eventFlow?.state ?? null).toBe(expected);
      expect(result.observedAt).toBe(now);
      service.dispose();
    }
  });

  it('keeps fixture providers isolated even with default public stream URLs configured', async () => {
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    try {
      const source = liveSnapshot('bitcoin', now);
      const service = new SnapshotService({
        config,
        now: () => now,
        providers: { bitcoin: async () => source, ethereum: async () => source },
      });
      expect((await service.get('bitcoin', 'live')).eventFlow ?? null).toBeNull();
      expect(socket).not.toHaveBeenCalled();
      service.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
