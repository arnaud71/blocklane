import { snapshotSchema, type ChainId, type Snapshot } from '../shared/model.js';
import { createBitcoinProvider } from './adapters/bitcoin.js';
import { fetchEthereumSnapshot } from './adapters/ethereum.js';
import { CACHE_TTL_MS, MAX_STALE_MS, loadConfig, type ServerConfig } from './config.js';
import { generateDemoSnapshot } from './demo.js';
import { UpstreamError, type Fetcher } from './network.js';

export interface SnapshotReader {
  get(chain: ChainId, mode: 'demo' | 'live'): Promise<Snapshot>;
}
type Provider = () => Promise<Snapshot>;
interface CacheEntry {
  snapshot?: Snapshot;
  nextRefreshAt: number;
  attemptedAt: number;
  error?: string;
  inFlight?: Promise<void>;
}
export interface SnapshotServiceOptions {
  config?: ServerConfig;
  fetcher?: Fetcher;
  now?: () => number;
  providers?: Record<ChainId, Provider>;
}

/** Two bounded caches shared by all clients; at most one refresh per chain at a time. */
export class SnapshotService implements SnapshotReader {
  private readonly config: ServerConfig;
  private readonly now: () => number;
  private readonly providers: Record<ChainId, Provider>;
  private readonly cache: Record<ChainId, CacheEntry> = {
    bitcoin: { nextRefreshAt: 0, attemptedAt: 0 },
    ethereum: { nextRefreshAt: 0, attemptedAt: 0 },
  };

  constructor(options: SnapshotServiceOptions = {}) {
    this.config = options.config ?? loadConfig();
    this.now = options.now ?? Date.now;
    this.providers = options.providers ?? {
      bitcoin: createBitcoinProvider(this.config, options.fetcher, this.now),
      ethereum: () => fetchEthereumSnapshot(this.config, options.fetcher, this.now),
    };
  }

  async get(chain: ChainId, mode: 'demo' | 'live'): Promise<Snapshot> {
    if (mode === 'demo') return generateDemoSnapshot(chain, this.now());
    const entry = this.cache[chain];
    if (!entry.inFlight && this.now() >= entry.nextRefreshAt) {
      entry.attemptedAt = this.now();
      entry.nextRefreshAt = this.now() + CACHE_TTL_MS;
      // Defer execution until after assignment, including providers that throw synchronously.
      entry.inFlight = Promise.resolve().then(() => this.refresh(chain, entry));
    }
    if (entry.inFlight) await entry.inFlight;
    return this.current(chain, entry);
  }

  private async refresh(chain: ChainId, entry: CacheEntry): Promise<void> {
    try {
      const snapshot = snapshotSchema.parse(await this.providers[chain]());
      if (snapshot.chain !== chain || snapshot.mode !== 'live' || snapshot.status !== 'ok') {
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
      entry.nextRefreshAt = this.now() + CACHE_TTL_MS;
      delete entry.inFlight;
    }
  }

  private current(chain: ChainId, entry: CacheEntry): Snapshot {
    if (entry.snapshot && this.now() - entry.snapshot.observedAt <= MAX_STALE_MS) {
      if (!entry.error) return entry.snapshot;
      return snapshotSchema.parse({
        ...entry.snapshot,
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
