import {
  POOL_FLOW_MAX_AGE_MS,
  EVENT_FLOW_MAX_AGE_MS,
  EVENT_FLOW_SILENCE_MS,
  eventFlowSchema,
  snapshotSchema,
  usdQuoteSchema,
  type ChainId,
  type Snapshot,
} from '../shared/model.js';
import { createBitcoinProvider } from './adapters/bitcoin.js';
import { createEthereumProvider } from './adapters/ethereum.js';
import { CACHE_TTL_MS, MAX_STALE_MS, loadConfig, type ServerConfig } from './config.js';
import { generateDemoSnapshot } from './demo.js';
import { MarketPrices, type UsdQuoteReader } from './marketPrices.js';
import { UpstreamError, type Fetcher } from './network.js';
import { createEventStreams, type EventFlowReader } from './eventStreams.js';

export interface SnapshotReader {
  get(chain: ChainId, mode: 'demo' | 'live'): Promise<Snapshot>;
  dispose?(): void;
}
type Provider = () => Promise<Snapshot>;
interface CacheEntry {
  snapshot?: Snapshot;
  nextRefreshAt: number;
  attemptedAt: number;
  lastClockAt?: number;
  clockEpoch: number;
  error?: string;
  inFlight?: Promise<void>;
}
export interface SnapshotServiceOptions {
  config?: ServerConfig;
  fetcher?: Fetcher;
  now?: () => number;
  providers?: Record<ChainId, Provider>;
  usdQuotes?: UsdQuoteReader;
  eventFlows?: EventFlowReader;
}

/** Two bounded caches shared by all clients; at most one refresh per chain at a time. */
export class SnapshotService implements SnapshotReader {
  private readonly config: ServerConfig;
  private readonly now: () => number;
  private readonly providers: Record<ChainId, Provider>;
  private readonly usdQuotes: UsdQuoteReader;
  private readonly eventFlows: EventFlowReader | null;
  private disposed = false;
  private readonly cache: Record<ChainId, CacheEntry> = {
    bitcoin: { nextRefreshAt: 0, attemptedAt: 0, clockEpoch: 0 },
    ethereum: { nextRefreshAt: 0, attemptedAt: 0, clockEpoch: 0 },
  };

  constructor(options: SnapshotServiceOptions = {}) {
    this.config = options.config ?? loadConfig();
    this.now = options.now ?? Date.now;
    // Fixtures and custom transports must never accidentally start public sockets.
    this.eventFlows =
      options.eventFlows ??
      (options.providers || options.fetcher
        ? null
        : createEventStreams({ config: this.config, now: this.now }));
    this.providers = options.providers ?? {
      bitcoin: createBitcoinProvider(
        this.config,
        options.fetcher,
        this.now,
        undefined,
        undefined,
        undefined,
        () => this.eventFlows?.readBitcoinArrivals?.() ?? null,
      ),
      ethereum: createEthereumProvider(this.config, options.fetcher, this.now),
    };
    // Injected chain providers stay fully isolated unless a quote reader is also supplied.
    this.usdQuotes =
      options.usdQuotes ??
      (options.providers
        ? { get: async () => null }
        : new MarketPrices({ fetcher: options.fetcher, now: this.now }));
  }

  async get(chain: ChainId, mode: 'demo' | 'live'): Promise<Snapshot> {
    if (mode === 'demo') return generateDemoSnapshot(chain, this.now());
    const quotePromise = Promise.resolve()
      .then(() => this.usdQuotes.get(chain))
      .then((quote) => (quote === null ? null : usdQuoteSchema.parse(quote)))
      .catch(() => null);
    const entry = this.cache[chain];
    const time = this.clock(entry);
    if (!entry.inFlight && time >= entry.nextRefreshAt) {
      entry.attemptedAt = time;
      entry.nextRefreshAt = time + CACHE_TTL_MS;
      const clockEpoch = entry.clockEpoch;
      // Defer execution until after assignment, including providers that throw synchronously.
      entry.inFlight = Promise.resolve().then(() => this.refresh(chain, entry, clockEpoch));
    }
    const [, usdQuote] = await Promise.all([entry.inFlight, quotePromise]);
    const snapshot = this.current(chain, entry);
    if (!this.eventFlows || this.disposed || snapshot.status === 'unavailable')
      return { ...snapshot, usdQuote };
    try {
      const observed = this.eventFlows.read(
        chain,
        new Set(
          snapshot.transactions
            .filter((tx) => tx.status === 'pending')
            .map((tx) => tx.id.toLowerCase()),
        ),
      );
      if (observed === null) return { ...snapshot, usdQuote, eventFlow: null };
      const eventFlow = eventFlowSchema.parse(observed);
      if (
        (eventFlow.method !== 'newPendingTransactions') !== (chain === 'bitcoin') ||
        eventFlow.observedAt > this.now() ||
        (eventFlow.lastMessageAt !== null && eventFlow.lastMessageAt > this.now())
      )
        return { ...snapshot, usdQuote, eventFlow: null };
      const active = eventFlow.state === 'live' || eventFlow.state === 'warming';
      const expired =
        active &&
        (this.now() - eventFlow.observedAt > EVENT_FLOW_MAX_AGE_MS ||
          eventFlow.lastMessageAt === null ||
          this.now() - eventFlow.lastMessageAt > EVENT_FLOW_SILENCE_MS);
      return {
        ...snapshot,
        usdQuote,
        eventFlow: expired ? { ...eventFlow, state: 'interrupted', history: [] } : eventFlow,
      };
    } catch {
      // Optional stream failure must not hide otherwise valid blocks or expose transport details.
      return { ...snapshot, usdQuote, eventFlow: null };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventFlows?.dispose();
  }

  /** A wall-clock rollback starts a new cache period without releasing an active refresh. */
  private clock(entry: CacheEntry): number {
    const time = this.now();
    if (entry.lastClockAt !== undefined && time < entry.lastClockAt) {
      delete entry.snapshot;
      entry.nextRefreshAt = time;
      entry.attemptedAt = time;
      entry.clockEpoch += 1;
      entry.error = 'Horloge serveur modifiée. Une nouvelle observation réseau est nécessaire.';
    }
    entry.lastClockAt = time;
    return time;
  }

  private async refresh(chain: ChainId, entry: CacheEntry, clockEpoch: number): Promise<void> {
    try {
      const snapshot = snapshotSchema.parse(await this.providers[chain]());
      const time = this.clock(entry);
      if (
        clockEpoch !== entry.clockEpoch ||
        snapshot.observedAt > time ||
        snapshot.chain !== chain ||
        snapshot.mode !== 'live' ||
        snapshot.status !== 'ok'
      ) {
        throw new UpstreamError('invalid');
      }
      entry.snapshot = snapshot;
      delete entry.error;
    } catch (error) {
      entry.error =
        error instanceof UpstreamError && error.kind === 'wrong-chain'
          ? 'Le fournisseur Ethereum ne pointe pas vers le réseau principal Ethereum. Vérifier la configuration serveur.'
          : 'Le fournisseur ne répond pas ou ses données sont invalides. Nouvelle tentative automatique après le délai de cache.';
    } finally {
      entry.nextRefreshAt = this.clock(entry) + CACHE_TTL_MS;
      delete entry.inFlight;
    }
  }

  private current(chain: ChainId, entry: CacheEntry): Snapshot {
    const time = this.clock(entry);
    if (
      entry.snapshot &&
      entry.snapshot.observedAt <= time &&
      time - entry.snapshot.observedAt <= MAX_STALE_MS
    ) {
      const snapshot =
        entry.snapshot.poolFlow &&
        (time < entry.snapshot.poolFlow.observedAt ||
          time - entry.snapshot.poolFlow.observedAt > POOL_FLOW_MAX_AGE_MS)
          ? { ...entry.snapshot, poolFlow: null }
          : entry.snapshot;
      if (!entry.error) return snapshot;
      return snapshotSchema.parse({
        ...snapshot,
        status: 'stale',
        message: `${entry.error} Dernier instantané valide conservé avec son horodatage d’origine.`,
      });
    }
    return snapshotSchema.parse({
      chain,
      mode: 'live',
      status: 'unavailable',
      source: chain === 'bitcoin' ? this.config.bitcoinSource : this.config.ethereumSource,
      observedAt: entry.attemptedAt,
      coverage:
        'Aucune donnée réseau récente et validée disponible. La démonstration peut être choisie explicitement.',
      pendingCount: null,
      feeRate: null,
      feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
      transactions: [],
      blocks: [],
      message:
        entry.error ?? 'Dernier instantané trop ancien : affichage des données réseau suspendu.',
    });
  }
}
