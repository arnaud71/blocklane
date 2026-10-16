import { describe, expect, it } from 'vitest';
import { createEventFlowTracker } from '../../server/eventFlowTracker.js';
import {
  eventFlowSchema,
  MAX_EVENT_FLOW_IDS,
  MAX_EVENT_FLOW_POINTS,
  type EventFlow,
} from '../../shared/model.js';

const origin = 1_800_000_000_000;
const bitcoinId = (index: number) => index.toString(16).padStart(64, '0');
const ethereumId = (index: number) => `0x${bitcoinId(index)}`;

function fixture(method: EventFlow['method'] = 'mempool-txids') {
  let time = origin;
  const flow = createEventFlowTracker({
    source: 'Fournisseur observé',
    method,
    now: () => time,
    epochSeed: 0,
  });
  return {
    flow,
    at: (elapsed: number) => {
      time = origin + elapsed;
    },
    id: method !== 'newPendingTransactions' ? bitcoinId : ethereumId,
  };
}

describe.each(['mempool-txids', 'mempool-transactions', 'newPendingTransactions'] as const)(
  '%s connection event measurements',
  (method) => {
    it('keeps disconnected and connecting states distinct from a validated quiet connection', () => {
      const { flow, at } = fixture(method);
      const disabled = flow.read(new Set());
      expect(disabled).toMatchObject({ state: 'disabled', epoch: 0, history: [], startedAt: null });
      at(4_000);
      flow.heartbeat();
      expect(flow.read(new Set())).toEqual(disabled);
      flow.connecting();
      at(8_000);
      expect(flow.receive([])).toBe(false);
      expect(flow.read(new Set())).toMatchObject({
        state: 'connecting',
        observedAt: origin + 4_000,
        lastMessageAt: null,
        history: [],
      });
      flow.start();
      expect(flow.read(new Set())).toMatchObject({
        state: 'warming',
        epoch: 1,
        observedAt: origin + 8_000,
        history: [],
      });
      at(10_999);
      flow.heartbeat();
      expect(flow.read(new Set())).toMatchObject({
        state: 'warming',
        observedAt: origin + 8_000,
        lastMessageAt: origin + 10_999,
        history: [],
      });
      at(11_000);
      const measured = flow.read(new Set());
      expect(measured).toMatchObject({ state: 'live', lastMessageAt: origin + 10_999 });
      expect(measured.history).toEqual([
        {
          fromObservedAt: origin + 8_000,
          observedAt: origin + 11_000,
          enteredCount: 0,
          outsideSampleEnteredCount: 0,
        },
      ]);
      expect(eventFlowSchema.safeParse(measured).success).toBe(true);
    });

    it('counts unique canonical notifications and freezes the outside-sample split at publication', () => {
      const { flow, at, id } = fixture(method);
      flow.start();
      expect(flow.receive([id(0xabcd).toUpperCase(), id(0xabcd), id(2)])).toBe(true);
      at(1_000);
      expect(flow.receive([id(2)])).toBe(true);
      at(3_000);
      const published = flow.read(new Set([id(0xabcd).toUpperCase()]));
      expect(published.history[0]).toMatchObject({ enteredCount: 2, outsideSampleEnteredCount: 1 });
      expect(published.observedAt).toBe(origin + 3_000);
      expect(JSON.stringify(published)).not.toContain(id(2));
      published.history[0]!.enteredCount = 99;
      published.history[0]!.outsideSampleEnteredCount = 99;
      at(4_000);
      expect(flow.read(new Set())).toMatchObject({
        observedAt: origin + 3_000,
        history: [{ enteredCount: 2, outsideSampleEnteredCount: 1 }],
      });
      at(6_000);
      expect(flow.receive([id(2)])).toBe(true);
      expect(flow.read(new Set()).history.at(-1)).toMatchObject({ enteredCount: 0 });
    });

    it('starts a fresh epoch after reconnecting without replaying private backlog or old history', () => {
      const { flow, at, id } = fixture(method);
      flow.start();
      flow.receive([id(1)]);
      at(3_000);
      expect(flow.read(new Set()).history[0]?.enteredCount).toBe(1);
      flow.receive([id(2)]);
      at(4_000);
      flow.stop('interrupted');
      const stopped = flow.read(new Set());
      expect(stopped).toMatchObject({
        state: 'interrupted',
        observedAt: origin + 4_000,
        startedAt: origin,
        lastMessageAt: origin + 3_000,
        history: [],
      });
      at(9_000);
      flow.stop('interrupted');
      expect(flow.read(new Set())).toEqual(stopped);
      flow.connecting();
      flow.start();
      flow.receive([id(1)]);
      at(12_000);
      expect(flow.read(new Set())).toMatchObject({
        epoch: 2,
        startedAt: origin + 9_000,
        history: [{ fromObservedAt: origin + 9_000, enteredCount: 1 }],
      });
    });

    it('discards a long unpublished interval without pretending a read was a transport message', () => {
      const { flow, at, id } = fixture(method);
      flow.start();
      flow.receive([id(1)]);
      at(14_000);
      flow.heartbeat();
      at(15_001);
      const rebased = flow.read(new Set());
      expect(rebased).toMatchObject({
        state: 'warming',
        epoch: 2,
        startedAt: origin + 15_001,
        observedAt: origin + 15_001,
        lastMessageAt: origin + 14_000,
        history: [],
      });
      expect(eventFlowSchema.safeParse(rebased).success).toBe(true);
      at(16_000);
      flow.receive([id(2)]);
      at(18_001);
      expect(flow.read(new Set()).history).toEqual([
        {
          fromObservedAt: origin + 15_001,
          observedAt: origin + 18_001,
          enteredCount: 1,
          outsideSampleEnteredCount: 1,
        },
      ]);
    });

    it('stops on transport silence without converting unknown time to a measured zero', () => {
      const { flow, at } = fixture(method);
      flow.start();
      at(15_000);
      expect(flow.read(new Set()).history[0]).toMatchObject({
        fromObservedAt: origin,
        observedAt: origin + 15_000,
        enteredCount: 0,
      });
      at(30_000);
      expect(flow.read(new Set()).state).toBe('live');
      at(30_001);
      const stopped = flow.read(new Set());
      expect(stopped).toMatchObject({
        state: 'interrupted',
        observedAt: origin + 30_001,
        lastMessageAt: origin,
        history: [],
      });
      at(31_000);
      flow.heartbeat();
      expect(flow.receive([])).toBe(false);
      expect(flow.read(new Set())).toEqual(stopped);
    });

    it('expires deduplication after its real notification TTL and bounds the dated history', () => {
      const { flow, at, id } = fixture(method);
      flow.start();
      flow.receive([id(1)]);
      for (let elapsed = 3_000; elapsed < 60_000; elapsed += 3_000) {
        at(elapsed);
        flow.heartbeat();
        expect(eventFlowSchema.safeParse(flow.read(new Set())).success).toBe(true);
      }
      at(60_000);
      expect(flow.receive([id(1)])).toBe(true);
      const current = flow.read(new Set());
      expect(current.history).toHaveLength(MAX_EVENT_FLOW_POINTS);
      expect(current.history.at(-1)?.enteredCount).toBe(1);
      expect(current.history.every((point) => point.observedAt > origin)).toBe(true);
      expect(eventFlowSchema.safeParse(current).success).toBe(true);
    });

    it('refreshes duplicate notification TTL without counting the same ID again', () => {
      const { flow, at, id } = fixture(method);
      flow.start();
      flow.receive([id(1)]);
      for (let elapsed = 3_000; elapsed <= 63_000; elapsed += 3_000) {
        at(elapsed);
        expect(flow.receive([id(1)])).toBe(true);
        expect(flow.read(new Set()).history.at(-1)?.enteredCount).toBe(elapsed === 3_000 ? 1 : 0);
      }
    });
  },
);

describe('event work limits and interruption safety', () => {
  it('gives new production trackers distinct opaque periods even with the same source and clock', () => {
    const options = {
      source: 'Source stable',
      method: 'mempool-txids' as const,
      now: () => origin,
    };
    const first = createEventFlowTracker(options);
    const second = createEventFlowTracker(options);
    first.start();
    second.start();
    const a = first.read(new Set());
    const b = second.read(new Set());
    expect(a.epoch).not.toBe(b.epoch);
    for (const flow of [a, b]) {
      expect(flow.epoch).toBeGreaterThan(1);
      expect(flow.epoch).toBeLessThanOrEqual(2 ** 48);
      expect(eventFlowSchema.safeParse(flow).success).toBe(true);
      expect(Object.keys(flow).sort()).toEqual([
        'epoch',
        'history',
        'lastMessageAt',
        'method',
        'observedAt',
        'source',
        'startedAt',
        'state',
      ]);
    }
  });

  it('validates deterministic seeds and ends coverage before a period counter can overflow', () => {
    for (const epochSeed of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(() =>
        createEventFlowTracker({
          source: 'Source stable',
          method: 'mempool-txids',
          epochSeed,
        }),
      ).toThrow('Invalid event flow epoch seed');
    }
    let time = origin;
    const flow = createEventFlowTracker({
      source: 'Source stable',
      method: 'mempool-txids',
      now: () => time,
      epochSeed: Number.MAX_SAFE_INTEGER - 1,
    });
    flow.start();
    flow.receive([bitcoinId(1)]);
    time += 3_000;
    expect(flow.read(new Set()).epoch).toBe(Number.MAX_SAFE_INTEGER);
    time += 1;
    flow.start();
    const stopped = flow.read(new Set());
    expect(stopped).toMatchObject({
      state: 'limited',
      epoch: Number.MAX_SAFE_INTEGER,
      observedAt: time,
      history: [],
    });
    expect(eventFlowSchema.safeParse(stopped).success).toBe(true);
    expect(flow.receive([bitcoinId(2)])).toBe(false);
  });

  it('bounds one batch and the retained unique-ID table independently of published points', () => {
    const { flow, at } = fixture();
    const ids = Array.from({ length: MAX_EVENT_FLOW_IDS }, (_, index) => bitcoinId(index));
    flow.start();
    expect(flow.receive(ids)).toBe(true);
    at(3_000);
    expect(flow.read(new Set()).history[0]?.enteredCount).toBe(MAX_EVENT_FLOW_IDS);
    expect(flow.receive([bitcoinId(MAX_EVENT_FLOW_IDS)])).toBe(false);
    expect(flow.read(new Set())).toMatchObject({ state: 'limited', history: [] });
    flow.start();
    expect(flow.receive(Array<string>(MAX_EVENT_FLOW_IDS + 1).fill(bitcoinId(1)))).toBe(false);
    expect(flow.read(new Set()).state).toBe('limited');
  });

  it('rejects malformed payloads and cross-chain identifiers without exposing them', () => {
    for (const bad of [null, [ethereumId(1)], ['not-a-transaction'], [42]]) {
      const { flow } = fixture();
      flow.start();
      expect(flow.receive(bad as unknown as string[])).toBe(false);
      const measured = flow.read(new Set());
      expect(measured).toMatchObject({ state: 'limited', history: [] });
      expect(eventFlowSchema.safeParse(measured).success).toBe(true);
      expect(JSON.stringify(measured)).not.toContain('not-a-transaction');
    }
    const { flow } = fixture('newPendingTransactions');
    flow.start();
    expect(flow.receive([bitcoinId(1)])).toBe(false);
  });

  it('treats a malformed sample partition as unknown while preserving the real entry count', () => {
    const { flow, at } = fixture();
    flow.start();
    flow.receive([bitcoinId(1)]);
    at(3_000);
    expect(flow.read(new Set(['invalid'])).history[0]).toMatchObject({
      enteredCount: 1,
      outsideSampleEnteredCount: null,
    });
    expect(flow.read(new Set()).history[0]?.outsideSampleEnteredCount).toBeNull();
  });

  it('interrupts a backward clock and permits recovery only as a new validated epoch', () => {
    const { flow, at } = fixture();
    flow.start();
    at(3_000);
    flow.read(new Set());
    at(2_000);
    expect(flow.receive([bitcoinId(1)])).toBe(false);
    const stopped = flow.read(new Set());
    expect(stopped).toMatchObject({
      state: 'interrupted',
      history: [],
      observedAt: origin + 3_000,
    });
    expect(eventFlowSchema.safeParse(stopped).success).toBe(true);
    flow.start();
    expect(flow.read(new Set())).toMatchObject({
      epoch: 2,
      state: 'warming',
      startedAt: origin + 2_000,
    });
  });

  it('does not serialize invalid clock readings or accept an unsafe source', () => {
    let time = origin;
    const flow = createEventFlowTracker({
      source: 'Source stable',
      method: 'mempool-txids',
      now: () => time,
    });
    flow.start();
    time = Number.NaN;
    expect(flow.receive([bitcoinId(1)])).toBe(false);
    const stopped = flow.read(new Set());
    expect(stopped).toMatchObject({ state: 'interrupted', observedAt: origin, history: [] });
    expect(eventFlowSchema.safeParse(stopped).success).toBe(true);
    for (const source of ['', ' ', 'x'.repeat(101)]) {
      expect(() => createEventFlowTracker({ source, method: 'mempool-txids' })).toThrow(
        'Invalid event flow source',
      );
    }
  });
});
