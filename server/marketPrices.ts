import { z } from 'zod';
import { usdQuoteSchema, type ChainId, type UsdQuote } from '../shared/model.js';
import { parsePayload, requestJson, type Fetcher } from './network.js';

export const USD_QUOTE_CACHE_TTL_MS = 60_000;
export const USD_QUOTE_MAX_STALE_MS = 5 * 60_000;
const USD_QUOTE_MAX_RESPONSE_BYTES = 16 * 1024;

// Fixed, public read-only endpoints. No browser input or credentials influence these URLs.
const PRICE_ENDPOINTS: Record<ChainId, { url: string; base: 'BTC' | 'ETH' }> = {
  bitcoin: { url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot', base: 'BTC' },
  ethereum: { url: 'https://api.coinbase.com/v2/prices/ETH-USD/spot', base: 'ETH' },
};

export interface UsdQuoteReader {
  get(chain: ChainId): Promise<UsdQuote | null>;
}

export interface MarketPricesOptions {
  fetcher?: Fetcher;
  now?: () => number;
}

interface PriceCacheEntry {
  quote?: UsdQuote;
  nextRefreshAt: number;
  failed: boolean;
  inFlight?: Promise<void>;
}

/** Two demand-driven caches, shared by visitors, with one bounded request per chain. */
export class MarketPrices implements UsdQuoteReader {
  private readonly now: () => number;
  private readonly fetcher: Fetcher | undefined;
  private readonly cache: Record<ChainId, PriceCacheEntry> = {
    bitcoin: { nextRefreshAt: 0, failed: false },
    ethereum: { nextRefreshAt: 0, failed: false },
  };

  constructor(options: MarketPricesOptions = {}) {
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetcher;
  }

  async get(chain: ChainId): Promise<UsdQuote | null> {
    const entry = this.cache[chain];
    if (!entry.inFlight && this.now() >= entry.nextRefreshAt) {
      // Assignment precedes even an immediately failing injected request.
      entry.inFlight = Promise.resolve().then(() => this.refresh(chain, entry));
    }
    // Optional prices refresh in the background; never hold a blockchain response for them.
    const quote = entry.quote;
    if (!quote) return null;
    const age = this.now() - quote.observedAt;
    if (!Number.isFinite(age) || age < 0 || age > USD_QUOTE_MAX_STALE_MS) return null;
    return {
      ...quote,
      status: entry.failed || age > USD_QUOTE_CACHE_TTL_MS ? 'stale' : 'ok',
    };
  }

  private async refresh(chain: ChainId, entry: PriceCacheEntry): Promise<void> {
    try {
      const endpoint = PRICE_ENDPOINTS[chain];
      const payload = parsePayload(
        z.object({
          data: z.object({
            base: z.literal(endpoint.base),
            currency: z.literal('USD'),
            amount: z
              .string()
              .min(1)
              .max(40)
              .regex(/^\d+(?:\.\d+)?$/),
          }),
        }),
        await requestJson(endpoint.url, {
          fetcher: this.fetcher,
          maxBytes: USD_QUOTE_MAX_RESPONSE_BYTES,
        }),
      );
      entry.quote = usdQuoteSchema.parse({
        usdPerCoin: Number(payload.data.amount),
        observedAt: this.now(),
        source: 'Coinbase',
        status: 'ok',
      });
      entry.failed = false;
    } catch {
      // A quote failure never changes the chain's availability or leaks an upstream body.
      entry.failed = true;
    } finally {
      entry.nextRefreshAt = this.now() + USD_QUOTE_CACHE_TTL_MS;
      delete entry.inFlight;
    }
  }
}
