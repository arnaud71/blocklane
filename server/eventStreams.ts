import type { ChainId, EventFlow } from '../shared/model.js';
import type { ServerConfig } from './config.js';
import { createEventFlowTracker } from './eventFlowTracker.js';
import { createBitcoinLiveArrivals, type BitcoinArrivalSample } from './bitcoinLiveArrivals.js';

/** The native Node WebSocket surface; tests inject a transport without opening a connection. */
export interface EventSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface EventFlowReader {
  read(chain: ChainId, selectedIds: ReadonlySet<string>): EventFlow | null;
  readBitcoinArrivals?(): BitcoinArrivalSample | null;
  dispose(): void;
}

interface EventStreamsOptions {
  config: ServerConfig;
  now?: () => number;
  socketFactory?: (url: string) => EventSocket;
}

const HANDSHAKE_TIMEOUT_MS = 8_000;
const SILENCE_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_ETHEREUM_FRAME_BYTES = 256 * 1_024;
const MAX_BITCOIN_FRAME_BYTES = 2 * 1_024 * 1_024;
const MAX_MINUTE_BYTES = 8 * 1_024 * 1_024;
const MAX_SECOND_MESSAGES = 100;
const MAX_DELTA_IDS = 20_000;
const SOCKET_OPEN = 1;
const hashBitcoin = /^[a-f\d]{64}$/i;
const hashEthereum = /^0x[a-f\d]{64}$/i;
const subscriptionId = /^0x[a-f\d]{1,128}$/i;
const chains: readonly ChainId[] = ['bitcoin', 'ethereum'];
type Tracker = ReturnType<typeof createEventFlowTracker>;
type StopState = 'interrupted' | 'limited';

interface Session {
  socket: EventSocket;
  handlers: Record<'open' | 'message' | 'error' | 'close', EventListener>;
  handshakeAt: number;
  lastMessageAt: number;
  ready: boolean;
  ethereumMainnet: boolean;
  ethereumSubscriptionRequested: boolean;
  ethereumSubscription: string | null;
  bitcoinSequence: number | null;
  bitcoinLoading: boolean;
}

interface Stream {
  chain: ChainId;
  url: string | undefined;
  tracker: Tracker;
  session: Session | null;
  lastReadAt: number | null;
  lastClock: number | null;
  reconnectAt: number;
  backoffMs: number;
  usage: { at: number; bytes: number }[];
  minuteStart: number;
  secondStart: number;
  minuteBytes: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_DELTA_IDS &&
    value.every((id: unknown) => typeof id === 'string' && hashBitcoin.test(id))
  );
}

/** Lazy, shared feeds; Bitcoin retains bounded compact details without individual HTTP calls. */
export function createEventStreams(options: EventStreamsOptions): EventFlowReader {
  const now = options.now ?? Date.now;
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url));
  const streams = new Map<ChainId, Stream>();
  let disposed = false;
  let watcher: ReturnType<typeof setInterval> | null = null;
  const bitcoinArrivals = createBitcoinLiveArrivals({
    source: options.config.bitcoinEventsSource ?? 'Flux Bitcoin configuré',
    now,
  });

  for (const chain of chains) {
    const tracker = createEventFlowTracker({
      source:
        chain === 'bitcoin'
          ? (options.config.bitcoinEventsSource ?? 'Flux Bitcoin configuré')
          : (options.config.ethereumEventsSource ?? 'Flux Ethereum configuré'),
      method: chain === 'bitcoin' ? 'mempool-transactions' : 'newPendingTransactions',
      now,
    });
    const url =
      chain === 'bitcoin' ? options.config.bitcoinEventsWsUrl : options.config.ethereumEventsWsUrl;
    if (!url) tracker.stop('disabled');
    streams.set(chain, {
      chain,
      url,
      tracker,
      session: null,
      lastReadAt: null,
      lastClock: null,
      reconnectAt: 0,
      backoffMs: 1_000,
      usage: [],
      minuteStart: 0,
      secondStart: 0,
      minuteBytes: 0,
    });
  }

  function current(stream: Stream, session: Session): boolean {
    return !disposed && stream.session === session;
  }

  function detach(stream: Stream): void {
    if (stream.chain === 'bitcoin') bitcoinArrivals.reset();
    const session = stream.session;
    stream.session = null;
    if (!session) return;
    for (const [type, listener] of Object.entries(session.handlers)) {
      session.socket.removeEventListener(type, listener);
    }
    try {
      session.socket.close();
    } catch {
      // Failed handshakes and already closed transports still release every listener above.
    }
  }

  function stop(stream: Stream, state: StopState, time: number): void {
    detach(stream);
    stream.tracker.stop(state);
    const previousTime =
      stream.lastClock !== null && Number.isSafeInteger(stream.lastClock) && stream.lastClock >= 0
        ? stream.lastClock
        : 0;
    const validTime = Number.isSafeInteger(time) && time >= 0 ? time : previousTime;
    stream.reconnectAt = validTime + stream.backoffMs;
    stream.backoffMs = Math.min(30_000, stream.backoffMs * 2);
  }

  function heartbeat(stream: Stream, session: Session, time: number): void {
    session.lastMessageAt = time;
    stream.tracker.heartbeat();
  }

  function start(stream: Stream, session: Session): void {
    session.ready = true;
    stream.backoffMs = 1_000;
    stream.tracker.start();
  }

  function receive(stream: Stream, session: Session, ids: readonly string[], time: number): void {
    if (!stream.tracker.receive(ids)) stop(stream, 'limited', time);
    else heartbeat(stream, session, time);
  }

  function ethereumMessage(
    stream: Stream,
    session: Session,
    message: Record<string, unknown>,
    time: number,
  ): void {
    if (message.jsonrpc !== '2.0') {
      stop(stream, 'interrupted', time);
      return;
    }
    if (message.id === 1 || message.id === 2) {
      if (message.id === 2 && !session.ethereumSubscriptionRequested) return;
      if (message.error !== undefined) {
        stop(stream, 'interrupted', time);
        return;
      }
      if (message.id === 1) {
        if (message.result !== '0x1') {
          stop(stream, 'interrupted', time);
          return;
        }
        session.ethereumMainnet = true;
        if (!session.ethereumSubscriptionRequested) {
          session.ethereumSubscriptionRequested = true;
          try {
            session.socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'eth_subscribe',
                params: ['newPendingTransactions', false],
              }),
            );
          } catch {
            stop(stream, 'interrupted', time);
            return;
          }
        }
      } else {
        if (typeof message.result !== 'string' || !subscriptionId.test(message.result)) {
          stop(stream, 'interrupted', time);
          return;
        }
        session.ethereumSubscription = message.result;
      }
      heartbeat(stream, session, time);
      if (!session.ready && session.ethereumMainnet && session.ethereumSubscription) {
        start(stream, session);
      }
      return;
    }
    if (message.method !== 'eth_subscription') return;
    const params = record(message.params);
    if (!session.ready || params?.subscription !== session.ethereumSubscription) return;
    const value = params.result;
    const id = typeof value === 'string' ? value : record(value)?.hash;
    if (typeof id !== 'string' || !hashEthereum.test(id)) {
      stop(stream, 'interrupted', time);
      return;
    }
    receive(stream, session, [id.toLowerCase()], time);
  }

  function bitcoinMessage(
    stream: Stream,
    session: Session,
    message: Record<string, unknown>,
    time: number,
  ): void {
    if (message.loadingIndicators !== undefined) {
      const loading = record(message.loadingIndicators)?.mempool;
      if (loading !== undefined) {
        if (
          typeof loading !== 'number' ||
          !Number.isFinite(loading) ||
          loading < 0 ||
          loading > 100
        ) {
          stop(stream, 'interrupted', time);
          return;
        }
        heartbeat(stream, session, time);
        if (loading < 100) {
          bitcoinArrivals.reset();
          if (!session.bitcoinLoading) {
            stream.tracker.stop('interrupted');
            session.handshakeAt = time;
          }
          session.bitcoinLoading = true;
          session.bitcoinSequence = null;
          session.ready = false;
        } else {
          if (session.bitcoinLoading) session.handshakeAt = time;
          session.bitcoinLoading = false;
        }
      }
    }
    if (message.mempoolInfo !== undefined) {
      const stats = record(message.mempoolInfo);
      if (stats && safeCount(stats.size) && safeCount(stats.bytes))
        heartbeat(stream, session, time);
    }
    if (message['mempool-transactions'] === undefined) return;
    const delta = record(message['mempool-transactions']);
    const added = delta?.added;
    const replaced = delta?.replaced ?? [];
    if (
      !delta ||
      !safeCount(delta.sequence) ||
      !Array.isArray(added) ||
      added.length > MAX_DELTA_IDS ||
      !added.every((tx: unknown) => {
        const id = record(tx)?.txid;
        return typeof id === 'string' && hashBitcoin.test(id);
      }) ||
      !validIds(delta.removed) ||
      !validIds(delta.mined) ||
      !Array.isArray(replaced) ||
      added.length + delta.removed.length + delta.mined.length + replaced.length * 2 > MAX_DELTA_IDS
    ) {
      stop(stream, 'interrupted', time);
      return;
    }
    heartbeat(stream, session, time);
    if (session.bitcoinLoading) return;
    const sequence = delta.sequence;
    const previous = session.bitcoinSequence;
    if (previous === sequence) return;
    session.bitcoinSequence = sequence;
    if (previous === null) return;
    if (sequence !== previous + 1) {
      // This provider counter is not Bitcoin Core's mempool_sequence. Never replay a gap.
      stream.tracker.stop('interrupted');
      bitcoinArrivals.reset();
      session.ready = false;
      session.handshakeAt = time;
      return;
    }
    if (!session.ready) start(stream, session);
    if (
      !bitcoinArrivals.receive(
        { added, removed: delta.removed, mined: delta.mined, replaced },
        time,
      )
    ) {
      stop(stream, 'interrupted', time);
      return;
    }
    receive(
      stream,
      session,
      added.map((tx) => (record(tx)!.txid as string).toLowerCase()),
      time,
    );
  }

  function withinBudget(stream: Stream, time: number, bytes: number): boolean {
    const maxFrameBytes =
      stream.chain === 'bitcoin' ? MAX_BITCOIN_FRAME_BYTES : MAX_ETHEREUM_FRAME_BYTES;
    if (bytes > maxFrameBytes) return false;
    while (stream.usage[stream.minuteStart]?.at !== undefined) {
      const item = stream.usage[stream.minuteStart]!;
      if (item.at > time - 60_000) break;
      stream.minuteBytes -= item.bytes;
      stream.minuteStart += 1;
    }
    stream.secondStart = Math.max(stream.secondStart, stream.minuteStart);
    while (
      stream.usage[stream.secondStart] &&
      stream.usage[stream.secondStart]!.at <= time - 1_000
    ) {
      stream.secondStart += 1;
    }
    if (
      stream.usage.length - stream.secondStart >= MAX_SECOND_MESSAGES ||
      stream.minuteBytes + bytes > MAX_MINUTE_BYTES
    ) {
      return false;
    }
    if (stream.minuteStart > 1_000) {
      stream.usage.splice(0, stream.minuteStart);
      stream.secondStart -= stream.minuteStart;
      stream.minuteStart = 0;
    }
    stream.usage.push({ at: time, bytes });
    stream.minuteBytes += bytes;
    return true;
  }

  function open(stream: Stream, time: number): void {
    if (!stream.url || disposed) return;
    stream.tracker.connecting();
    let socket: EventSocket;
    try {
      socket = socketFactory(stream.url);
    } catch {
      stop(stream, 'interrupted', time);
      return;
    }
    const session: Session = {
      socket,
      handlers: {} as Session['handlers'],
      handshakeAt: time,
      lastMessageAt: time,
      ready: false,
      ethereumMainnet: false,
      ethereumSubscriptionRequested: false,
      ethereumSubscription: null,
      bitcoinSequence: null,
      bitcoinLoading: false,
    };
    stream.session = session;
    session.handlers = {
      open: () => {
        if (!current(stream, session)) return;
        if (socket.readyState !== SOCKET_OPEN) {
          stop(stream, 'interrupted', now());
          return;
        }
        try {
          if (stream.chain === 'ethereum') {
            socket.send(
              JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
            );
          } else {
            socket.send(JSON.stringify({ action: 'init' }));
            socket.send(JSON.stringify({ action: 'want', data: ['stats'] }));
            socket.send(JSON.stringify({ 'track-mempool': true }));
          }
        } catch {
          stop(stream, 'interrupted', now());
        }
      },
      message: (event) => {
        if (!current(stream, session)) return;
        const time = now();
        if (
          !Number.isSafeInteger(time) ||
          time < 0 ||
          (stream.lastClock !== null && time < stream.lastClock)
        ) {
          stop(stream, 'interrupted', time);
          return;
        }
        stream.lastClock = time;
        if (
          (!session.ready && time - session.handshakeAt >= HANDSHAKE_TIMEOUT_MS) ||
          (session.ready && time - session.lastMessageAt >= SILENCE_TIMEOUT_MS)
        ) {
          stop(stream, 'interrupted', time);
          return;
        }
        const value = (event as MessageEvent<unknown>).data;
        if (typeof value !== 'string') {
          stop(stream, 'interrupted', time);
          return;
        }
        if (!withinBudget(stream, time, Buffer.byteLength(value, 'utf8'))) {
          stop(stream, 'limited', time);
          return;
        }
        let message: Record<string, unknown> | null;
        try {
          message = record(JSON.parse(value) as unknown);
        } catch {
          message = null;
        }
        if (!message) {
          stop(stream, 'interrupted', time);
          return;
        }
        if (stream.chain === 'ethereum') ethereumMessage(stream, session, message, time);
        else bitcoinMessage(stream, session, message, time);
      },
      error: () => {
        if (current(stream, session)) stop(stream, 'interrupted', now());
      },
      close: () => {
        if (current(stream, session)) stop(stream, 'interrupted', now());
      },
    };
    for (const [type, listener] of Object.entries(session.handlers)) {
      socket.addEventListener(type, listener);
    }
  }

  function maintain(stream: Stream, time: number): void {
    if (!stream.url || stream.lastReadAt === null) return;
    if (
      !Number.isSafeInteger(time) ||
      time < 0 ||
      (stream.lastClock !== null && time < stream.lastClock)
    ) {
      stop(stream, 'interrupted', time);
      if (Number.isSafeInteger(time) && time >= 0) stream.lastClock = time;
      return;
    }
    stream.lastClock = time;
    if (time - stream.lastReadAt >= IDLE_TIMEOUT_MS) {
      if (stream.session) {
        detach(stream);
        stream.tracker.stop('interrupted');
      }
      return;
    }
    const session = stream.session;
    if (!session) {
      if (time >= stream.reconnectAt) open(stream, time);
    } else if (
      (!session.ready && time - session.handshakeAt >= HANDSHAKE_TIMEOUT_MS) ||
      (session.ready && time - session.lastMessageAt >= SILENCE_TIMEOUT_MS)
    ) {
      stop(stream, 'interrupted', time);
    }
  }

  return {
    readBitcoinArrivals() {
      if (disposed) return null;
      const stream = streams.get('bitcoin')!;
      // Reading compact details never opens another socket or renews the source clock.
      maintain(stream, now());
      return stream.session?.ready ? bitcoinArrivals.read() : null;
    },
    read(chain, selectedIds) {
      if (disposed) return null;
      const stream = streams.get(chain)!;
      const time = now();
      if (Number.isSafeInteger(time) && time >= 0) stream.lastReadAt = time;
      maintain(stream, time);
      if (stream.url && !watcher) {
        watcher = setInterval(() => {
          const time = now();
          for (const stream of streams.values()) maintain(stream, time);
          if (
            Number.isSafeInteger(time) &&
            time >= 0 &&
            ![...streams.values()].some(
              (stream) =>
                stream.url &&
                stream.lastReadAt !== null &&
                time - stream.lastReadAt < IDLE_TIMEOUT_MS,
            )
          ) {
            if (watcher) clearInterval(watcher);
            watcher = null;
          }
        }, 1_000);
        watcher.unref?.();
      }
      return stream.tracker.read(selectedIds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (watcher) clearInterval(watcher);
      watcher = null;
      for (const stream of streams.values()) {
        detach(stream);
        stream.tracker.stop('disabled');
        stream.usage = [];
      }
    },
  };
}
