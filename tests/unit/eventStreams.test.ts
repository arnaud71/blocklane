import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEventStreams,
  type EventFlowReader,
  type EventSocket,
} from '../../server/eventStreams';
import { eventFlowSchema } from '../../shared/model';
import { config, now } from './fixtures';

const btcId = (value: number) => value.toString(16).padStart(64, '0');
const ethId = (value: number) => `0x${btcId(value)}`;
const selected = new Set<string>();
const subscription = '0xabcd';

class FakeSocket implements EventSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  listeners = new Map<string, Set<EventListener>>();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  send = vi.fn((data: string) => {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  });

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event = new Event(type)) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }
  message(value: unknown) {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(value) }));
  }
  notification(value: unknown) {
    this.message({
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription, result: value },
    });
  }
  delta(sequence: number, added: string[] = [], extra: Record<string, unknown> = {}) {
    this.message({
      'mempool-transactions': {
        sequence,
        added: added.map((txid) => ({ txid, fee: 400, weight: 800 })),
        removed: [],
        mined: [],
        ...extra,
      },
    });
  }
  ethereumReady() {
    this.open();
    this.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    this.message({ jsonrpc: '2.0', id: 2, result: subscription });
  }
}

const readers: EventFlowReader[] = [];
function setup(overrides: Partial<typeof config> = {}, clock: () => number = Date.now) {
  const sockets: FakeSocket[] = [];
  const socketFactory = vi.fn((): EventSocket => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const reader = createEventStreams({
    config: {
      ...config,
      bitcoinEventsWsUrl: 'wss://bitcoin.test/events',
      ethereumEventsWsUrl: 'wss://ethereum.test/events',
      bitcoinEventsSource: 'Bitcoin test events',
      ethereumEventsSource: 'Ethereum test events',
      ...overrides,
    },
    now: clock,
    socketFactory,
  });
  readers.push(reader);
  return { reader, sockets, socketFactory };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  for (const reader of readers.splice(0)) reader.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Shared provider event streams', () => {
  it('opens lazily, shares each chain connection and keeps disabled custom providers offline', () => {
    const { reader, sockets, socketFactory } = setup();
    expect(socketFactory).not.toHaveBeenCalled();
    expect(reader.read('ethereum', selected)?.state).toBe('connecting');
    reader.read('ethereum', new Set([ethId(1)]));
    expect(sockets).toHaveLength(1);
    reader.read('bitcoin', selected);
    expect(sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
    const disabled = setup({ bitcoinEventsWsUrl: undefined, ethereumEventsWsUrl: undefined });
    expect(disabled.reader.read('bitcoin', selected)?.state).toBe('disabled');
    expect(disabled.reader.read('ethereum', selected)?.state).toBe('disabled');
    expect(disabled.socketFactory).not.toHaveBeenCalled();
  });

  it('labels the event source independently from the HTTP provider', () => {
    const { reader } = setup({
      ethereumSource: 'Other HTTP',
      ethereumEventsSource: 'Separate event source',
    });
    expect(reader.read('ethereum', selected)?.source).toBe('Separate event source');
    const fallback = setup({ ethereumEventsSource: undefined });
    expect(fallback.reader.read('ethereum', selected)?.source).toBe('Flux Ethereum configuré');
  });

  it('requires both Ethereum mainnet and subscription acknowledgement, then counts hashes or objects once', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent).toEqual([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }]);
    // An unsolicited acknowledgement cannot establish an unrequested subscription.
    socket.message({ jsonrpc: '2.0', id: 2, result: subscription });
    socket.notification(ethId(1));
    expect(reader.read('ethereum', selected)?.state).toBe('connecting');
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(socket.sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['newPendingTransactions', false] },
    ]);
    socket.notification(ethId(1));
    expect(reader.read('ethereum', selected)?.state).toBe('connecting');
    socket.message({ jsonrpc: '2.0', id: 2, result: subscription });
    socket.notification(ethId(2));
    socket.notification({ hash: ethId(3), input: 'provider-private-input' });
    socket.notification(ethId(2).toUpperCase().replace('0X', '0x'));
    socket.message({
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription: '0xeeee', result: ethId(4) },
    });
    vi.advanceTimersByTime(3_000);
    const flow = reader.read('ethereum', new Set([ethId(2)]))!;
    expect(flow.state).toBe('live');
    expect(flow.history).toEqual([
      {
        fromObservedAt: now,
        observedAt: now + 3_000,
        enteredCount: 2,
        outsideSampleEnteredCount: 1,
      },
    ]);
    expect(eventFlowSchema.safeParse(flow).success).toBe(true);
    expect(JSON.stringify(flow)).not.toContain(ethId(2));
    expect(JSON.stringify(flow)).not.toContain('provider-private-input');
    expect(reader.read('ethereum', selected)?.history[0]?.outsideSampleEnteredCount).toBe(1);
  });

  it('requests an Ethereum subscription once, after mainnet verification, even with repeated acknowledgements', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent.map((request) => request.method)).toEqual(['eth_chainId']);
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(socket.sent.map((request) => request.method)).toEqual(['eth_chainId', 'eth_subscribe']);
    expect(reader.read('ethereum', selected)?.state).toBe('connecting');
    socket.message({ jsonrpc: '2.0', id: 2, result: subscription });
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(socket.sent).toHaveLength(2);
    expect(reader.read('ethereum', selected)?.state).toBe('warming');
  });

  it.each([
    { jsonrpc: '2.0', id: 1, result: '0xaa36a7' },
    { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'provider-secret' } },
    { jsonrpc: '2.0', id: 2, result: { bad: 'subscription' } },
    { jsonrpc: '1.0', id: 1, result: '0x1' },
  ])('rejects unsafe Ethereum handshakes without publishing raw errors (%j)', (response) => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.open();
    if (response.id === 2) sockets[0]!.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    sockets[0]!.message(response);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    const flow = reader.read('ethereum', selected)!;
    expect(flow.state).toBe('interrupted');
    expect(flow.history).toEqual([]);
    expect(JSON.stringify(flow)).not.toContain('provider-secret');
  });

  it('refuses malformed subscribed payloads instead of inventing observed transactions', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    sockets[0]!.notification({ hash: btcId(1) });
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it('ignores the first Bitcoin delta and repeats, then counts only additions from a real advance', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent).toEqual([
      { action: 'init' },
      { action: 'want', data: ['stats'] },
      { 'track-mempool': true },
    ]);
    socket.delta(10, [btcId(1)]);
    socket.delta(10, [btcId(2)]);
    vi.advanceTimersByTime(3_000);
    expect(reader.read('bitcoin', selected)?.state).toBe('connecting');
    socket.delta(11, [btcId(3)], {
      removed: [btcId(4)],
      mined: [btcId(5)],
      replaced: [{ replaced: btcId(8), by: { txid: btcId(9) } }],
    });
    socket.delta(11, [btcId(6)]);
    socket.delta(12, [btcId(3), btcId(7)]);
    vi.advanceTimersByTime(3_000);
    const flow = reader.read('bitcoin', new Set([btcId(3)]))!;
    expect(flow.state).toBe('live');
    expect(flow.history[0]).toMatchObject({
      enteredCount: 2,
      outsideSampleEnteredCount: 1,
      fromObservedAt: now + 3_000,
    });
    expect(eventFlowSchema.safeParse(flow).success).toBe(true);
  });

  it.each([9, 13])(
    'interrupts Bitcoin coverage at a sequence gap/backstep (%s), discards that base and never replays it',
    (gap) => {
      const { reader, sockets } = setup();
      reader.read('bitcoin', selected);
      const socket = sockets[0]!;
      socket.open();
      socket.delta(10, [btcId(1)]);
      socket.delta(11, [btcId(2)]);
      vi.advanceTimersByTime(3_000);
      const epoch = reader.read('bitcoin', selected)!.epoch;
      socket.delta(gap, [btcId(3)]);
      expect(reader.read('bitcoin', selected)?.state).toBe('interrupted');
      socket.delta(gap, [btcId(4)]);
      socket.delta(gap + 1, [btcId(5)]);
      vi.advanceTimersByTime(3_000);
      const flow = reader.read('bitcoin', selected)!;
      expect(flow.epoch).toBe(epoch + 1);
      expect(flow.history).toHaveLength(1);
      expect(flow.history[0]?.enteredCount).toBe(1);
    },
  );

  it('retains real arrival details from the same full subscription, without replaying stock or keeping mined IDs', () => {
    const { reader, sockets, socketFactory } = setup();
    expect(reader.readBitcoinArrivals?.()).toBeNull();
    expect(socketFactory).not.toHaveBeenCalled();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(10, [btcId(1)]);
    expect(reader.readBitcoinArrivals?.()).toBeNull();
    socket.delta(11, [btcId(2), btcId(3)]);
    expect(reader.readBitcoinArrivals?.()?.transactions).toEqual([
      expect.objectContaining({ id: btcId(3), feeRate: 2, size: 200, status: 'pending' }),
      expect.objectContaining({ id: btcId(2), feeRate: 2, size: 200, status: 'pending' }),
    ]);
    socket.delta(12, [], { mined: [btcId(2)] });
    expect(reader.readBitcoinArrivals?.()?.transactions.map((tx) => tx.id)).toEqual([btcId(3)]);
    socket.delta(14, [btcId(4)]);
    expect(reader.readBitcoinArrivals?.()).toBeNull();
    socket.delta(15, [btcId(5)]);
    expect(reader.readBitcoinArrivals?.()?.transactions.map((tx) => tx.id)).toEqual([btcId(5)]);
    socket.emit('close');
    expect(reader.readBitcoinArrivals?.()).toBeNull();
    expect(socket.sent.filter((request) => request['track-mempool'] === true)).toHaveLength(1);
  });

  it('interrupts malformed full transaction details rather than creating a fake fee or size', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(1);
    socket.message({
      'mempool-transactions': {
        sequence: 2,
        added: [{ txid: btcId(1), fee: 400 }],
        removed: [],
        mined: [],
        replaced: [],
      },
    });
    expect(reader.read('bitcoin', selected)?.state).toBe('interrupted');
    expect(reader.readBitcoinArrivals?.()).toBeNull();
  });

  it('suspends Bitcoin while the provider loads its pool and requires a fresh advancing baseline', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(1);
    socket.delta(2, [btcId(1)]);
    socket.message({ loadingIndicators: { mempool: 25 } });
    socket.delta(3, [btcId(2)]);
    expect(reader.read('bitcoin', selected)?.state).toBe('interrupted');
    socket.message({ loadingIndicators: { mempool: 100 } });
    socket.delta(4, [btcId(3)]);
    expect(reader.read('bitcoin', selected)?.state).toBe('interrupted');
    socket.delta(5, [btcId(4)]);
    vi.advanceTimersByTime(3_000);
    expect(reader.read('bitcoin', selected)?.history[0]?.enteredCount).toBe(1);
  });

  it.each([
    { sequence: 1.5, added: [], removed: [], mined: [] },
    { sequence: 1, added: ['bad-hash'], removed: [], mined: [] },
    { sequence: 1, added: [], removed: [btcId(1)], mined: null },
  ])('rejects invalid Bitcoin deltas as interrupted (%j)', (delta) => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    sockets[0]!.open();
    sockets[0]!.message({ 'mempool-transactions': delta });
    expect(reader.read('bitcoin', selected)?.state).toBe('interrupted');
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it('times out connection/acknowledgement after eight seconds and grows retry backoff until a real handshake', () => {
    const { reader, sockets, socketFactory } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.open();
    vi.advanceTimersByTime(7_999);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    vi.advanceTimersByTime(1_000);
    expect(socketFactory).toHaveBeenCalledTimes(2);
    sockets[1]!.open();
    vi.advanceTimersByTime(8_000);
    expect(sockets[1]!.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(socketFactory).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(socketFactory).toHaveBeenCalledTimes(3);
    sockets[2]!.ethereumReady();
    sockets[2]!.emit('error');
    vi.advanceTimersByTime(1_000);
    expect(socketFactory).toHaveBeenCalledTimes(4);
  });

  it('turns silence into interrupted coverage, while only validated relevant messages keep a stream fresh', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    vi.advanceTimersByTime(20_000);
    sockets[0]!.message({ jsonrpc: '2.0', id: 999, result: 'unrelated' });
    vi.advanceTimersByTime(10_000);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    expect(reader.read('ethereum', selected)?.history).toEqual([]);
  });

  it('keeps the eight-second total handshake deadline after a delayed mainnet response', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    const socket = sockets[0]!;
    socket.open();
    vi.advanceTimersByTime(7_000);
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(socket.sent.map((request) => request.method)).toEqual(['eth_chainId', 'eth_subscribe']);
    vi.advanceTimersByTime(1_000);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
  });

  it('interrupts cleanly if the subscription send fails after valid mainnet verification', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.send.mockImplementationOnce(() => {
      throw new Error('provider-private-failure');
    });
    socket.message({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    expect(JSON.stringify(reader.read('ethereum', selected))).not.toContain(
      'provider-private-failure',
    );
  });

  it('keeps a Bitcoin connection fresh with validated stats without inventing additions', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(1);
    socket.delta(2);
    for (let index = 0; index < 3; index++) {
      vi.advanceTimersByTime(10_000);
      socket.message({ mempoolInfo: { size: 1_000, bytes: 200_000 } });
      expect(reader.read('bitcoin', selected)?.history.at(-1)?.enteredCount).toBe(0);
    }
    expect(socket.close).not.toHaveBeenCalled();
    expect(reader.read('bitcoin', selected)?.state).toBe('live');
  });

  it('closes after sixty seconds without reads and never reconnects outside active usage', () => {
    const { reader, sockets, socketFactory } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    for (let index = 0; index < 2; index++) {
      vi.advanceTimersByTime(20_000);
      sockets[0]!.notification(ethId(index));
    }
    vi.advanceTimersByTime(20_000);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);
    expect(socketFactory).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    reader.read('ethereum', selected);
    expect(socketFactory).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('enforces the UTF-8 frame size and a rolling per-chain message rate', () => {
    const oversized = setup();
    oversized.reader.read('ethereum', selected);
    oversized.sockets[0]!.ethereumReady();
    oversized.sockets[0]!.message({ jsonrpc: '2.0', id: 999, result: 'é'.repeat(131_072) });
    expect(oversized.reader.read('ethereum', selected)?.state).toBe('limited');
    const flooded = setup();
    flooded.reader.read('ethereum', selected);
    flooded.sockets[0]!.ethereumReady();
    for (let index = 0; index < 98; index++)
      flooded.sockets[0]!.message({ jsonrpc: '2.0', id: 999, result: null });
    expect(flooded.sockets[0]!.close).not.toHaveBeenCalled();
    flooded.sockets[0]!.message({ jsonrpc: '2.0', id: 999, result: null });
    expect(flooded.reader.read('ethereum', selected)?.state).toBe('limited');
  });

  it('preserves the per-minute byte budget across reconnects instead of resetting it per socket', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    const padding = { jsonrpc: '2.0', id: 999, result: 'x'.repeat(200_000) };
    for (let index = 0; index < 40; index++) sockets[0]!.message(padding);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    sockets[0]!.emit('close');
    vi.advanceTimersByTime(1_000);
    sockets[1]!.ethereumReady();
    sockets[1]!.message(padding);
    expect(sockets[1]!.close).not.toHaveBeenCalled();
    sockets[1]!.message(padding);
    expect(reader.read('ethereum', selected)?.state).toBe('limited');
  });

  it('closes a stream when the tracker reaches its bounded distinct identifier table', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(1);
    for (let batch = 0; batch < 7; batch++) {
      socket.delta(
        batch + 2,
        Array.from({ length: 3_000 }, (_, index) => btcId(batch * 3_000 + index)),
      );
    }
    expect(reader.read('bitcoin', selected)?.state).toBe('limited');
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('accepts a bounded Bitcoin block delta larger than 256 KiB, while still limiting the frame and list sizes', () => {
    const { reader, sockets } = setup();
    reader.read('bitcoin', selected);
    const socket = sockets[0]!;
    socket.open();
    socket.delta(1);
    socket.delta(2, [btcId(1)], {
      mined: Array.from({ length: 5_000 }, (_, index) => btcId(index + 2)),
    });
    expect(socket.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(reader.read('bitcoin', selected)?.history[0]?.enteredCount).toBe(1);
    socket.message({ ignored: 'x'.repeat(2 * 1_024 * 1_024) });
    expect(reader.read('bitcoin', selected)?.state).toBe('limited');

    const excess = setup();
    excess.reader.read('bitcoin', selected);
    excess.sockets[0]!.open();
    excess.sockets[0]!.delta(
      1,
      Array.from({ length: 20_001 }, (_, index) => btcId(index)),
    );
    expect(excess.reader.read('bitcoin', selected)?.state).toBe('interrupted');
  });

  it('handles socket construction/send failures and malformed frames without leaking provider data', () => {
    const created = setup();
    created.socketFactory.mockImplementationOnce(() => {
      throw new Error('provider-secret-url');
    });
    expect(created.reader.read('ethereum', selected)?.state).toBe('interrupted');
    vi.advanceTimersByTime(1_000);
    const socket = created.sockets[0]!;
    socket.send.mockImplementationOnce(() => {
      throw new Error('provider-secret-key');
    });
    socket.open();
    expect(created.reader.read('ethereum', selected)?.state).toBe('interrupted');
    const invalid = setup();
    invalid.reader.read('ethereum', selected);
    invalid.sockets[0]!.open();
    invalid.sockets[0]!.emit(
      'message',
      new MessageEvent('message', { data: '{provider-secret-invalid-json' }),
    );
    expect(JSON.stringify(invalid.reader.read('ethereum', selected))).not.toContain(
      'provider-secret',
    );
    expect(invalid.reader.read('ethereum', selected)?.state).toBe('interrupted');
  });

  it('ends coverage when the clock moves backwards', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    vi.setSystemTime(now - 1);
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'recovers after an invalid clock without poisoning the reconnect deadline (%s)',
    (invalid) => {
      let time = now;
      const { reader, sockets } = setup({}, () => time);
      reader.read('ethereum', selected);
      sockets[0]!.ethereumReady();
      time = invalid;
      expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
      expect(sockets[0]!.close).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(2_000);
      time = now + 10_000;
      vi.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(2);
      sockets[1]!.ethereumReady();
      expect(reader.read('ethereum', selected)?.state).toBe('warming');
    },
  );

  it('does not hide an elapsed silence gap when a notification beats a delayed watchdog callback', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    sockets[0]!.ethereumReady();
    vi.setSystemTime(now + 31_000);
    sockets[0]!.notification(ethId(1));
    expect(reader.read('ethereum', selected)?.state).toBe('interrupted');
    expect(reader.read('ethereum', selected)?.history).toEqual([]);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it('ignores callbacks queued by a previous socket after reconnecting', () => {
    const { reader, sockets } = setup();
    reader.read('ethereum', selected);
    const old = sockets[0]!;
    old.ethereumReady();
    const queued = [...old.listeners.get('message')!];
    old.emit('close');
    vi.advanceTimersByTime(1_000);
    const current = sockets[1]!;
    current.ethereumReady();
    for (const callback of queued) {
      callback(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: { subscription, result: ethId(1) },
          }),
        }),
      );
    }
    current.notification(ethId(2));
    vi.advanceTimersByTime(3_000);
    expect(reader.read('ethereum', selected)?.history[0]?.enteredCount).toBe(1);
    expect(current.close).not.toHaveBeenCalled();
  });

  it('disposes timers/listeners and guards even callbacks already queued by an old connection', () => {
    const { reader, sockets, socketFactory } = setup();
    reader.read('ethereum', selected);
    const socket = sockets[0]!;
    socket.ethereumReady();
    const queued = [...socket.listeners.get('message')!];
    reader.dispose();
    reader.dispose();
    expect(socket.close).toHaveBeenCalledOnce();
    expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    for (const callback of queued)
      callback(
        new MessageEvent('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }),
        }),
      );
    vi.advanceTimersByTime(120_000);
    expect(socketFactory).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(reader.read('ethereum', selected)).toBeNull();
  });
});
