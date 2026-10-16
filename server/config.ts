import { z } from 'zod';
import { isIP } from 'node:net';

export const CACHE_TTL_MS = 3_000;
export const MAX_STALE_MS = 120_000;
export const UPSTREAM_TIMEOUT_MS = 8_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const BITCOIN_DEFAULT_URL = 'https://mempool.space/api';
export const ETHEREUM_DEFAULT_URL = 'https://ethereum-rpc.publicnode.com';
export const BITCOIN_RPC_DEFAULT_URL = 'https://bitcoin-rpc.publicnode.com';
export const BITCOIN_EVENTS_DEFAULT_URL = 'wss://mempool.space/api/v1/ws';
export const ETHEREUM_EVENTS_DEFAULT_URL = 'wss://ethereum-rpc.publicnode.com';

export interface ServerConfig {
  host: string;
  port: number;
  bitcoinApiUrl: string;
  ethereumRpcUrl: string;
  bitcoinSource: string;
  ethereumSource: string;
  bitcoinRpcUrl?: string;
  bitcoinPoolSource?: string;
  bitcoinEventsWsUrl?: string;
  ethereumEventsWsUrl?: string;
  bitcoinEventsSource?: string;
  ethereumEventsSource?: string;
  trustedProxyIps: string[];
  apiRateLimitPerMinute: number;
}

export function normalizeIp(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  if (!isIP(candidate)) return null;
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) return candidate.slice(7);
  return candidate;
}

/** URLs are deployment settings, never accepted from browser requests. */
export function validateUpstreamUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid upstream URL in server configuration.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Upstream URLs require HTTPS; HTTP is allowed only for loopback nodes.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Upstream URLs cannot contain user credentials or fragments.');
  }
  return url.toString().replace(/\/$/, '');
}

/** Event endpoints remain operator-owned server configuration, never public API arguments. */
export function validateEventStreamUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid event stream URL in server configuration.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      'Event streams require WSS; WS is allowed only for loopback nodes, without credentials or fragments.',
    );
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .parse(env.PORT ?? 3001);
  const host = z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.:[\]-]+$/)
    .parse(env.HOST ?? '127.0.0.1');
  const bitcoinApiUrl = validateUpstreamUrl(env.BITCOIN_API_URL ?? BITCOIN_DEFAULT_URL);
  const ethereumRpcUrl = validateUpstreamUrl(env.ETHEREUM_RPC_URL ?? ETHEREUM_DEFAULT_URL);
  const configuredBitcoinRpc = env.BITCOIN_RPC_URL ?? BITCOIN_RPC_DEFAULT_URL;
  const bitcoinRpcUrl = configuredBitcoinRpc.trim()
    ? validateUpstreamUrl(configuredBitcoinRpc)
    : undefined;
  const bitcoinEvents =
    env.BITCOIN_EVENTS_WS_URL ??
    (bitcoinApiUrl === BITCOIN_DEFAULT_URL ? BITCOIN_EVENTS_DEFAULT_URL : '');
  const ethereumEvents =
    env.ETHEREUM_EVENTS_WS_URL ??
    (ethereumRpcUrl === ETHEREUM_DEFAULT_URL ? ETHEREUM_EVENTS_DEFAULT_URL : '');
  const bitcoinEventsWsUrl = bitcoinEvents.trim()
    ? validateEventStreamUrl(bitcoinEvents)
    : undefined;
  const ethereumEventsWsUrl = ethereumEvents.trim()
    ? validateEventStreamUrl(ethereumEvents)
    : undefined;
  if (new URL(bitcoinApiUrl).search)
    throw new Error('Bitcoin API base URL cannot contain query parameters.');
  const proxyValues = (env.TRUSTED_PROXY_IPS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (proxyValues.length > 64) throw new Error('Too many trusted proxy addresses.');
  const trustedProxyIps = proxyValues.map((value) => {
    const ip = normalizeIp(value);
    if (!ip) throw new Error('Trusted proxy configuration requires exact IPv4 or IPv6 addresses.');
    return ip;
  });
  const apiRateLimitPerMinute = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .parse(env.API_RATE_LIMIT_PER_MINUTE ?? 120);
  return {
    host,
    port,
    bitcoinApiUrl,
    ethereumRpcUrl,
    bitcoinRpcUrl,
    bitcoinEventsWsUrl,
    ethereumEventsWsUrl,
    bitcoinEventsSource:
      bitcoinEventsWsUrl === BITCOIN_EVENTS_DEFAULT_URL
        ? 'mempool.space'
        : 'Flux Bitcoin configuré',
    ethereumEventsSource:
      ethereumEventsWsUrl === ETHEREUM_EVENTS_DEFAULT_URL
        ? 'Ethereum PublicNode'
        : 'Flux Ethereum configuré',
    bitcoinPoolSource:
      bitcoinRpcUrl === BITCOIN_RPC_DEFAULT_URL ? 'Bitcoin PublicNode' : 'RPC Bitcoin configuré',
    bitcoinSource:
      bitcoinApiUrl === BITCOIN_DEFAULT_URL ? 'mempool.space' : 'API Bitcoin configurée',
    ethereumSource:
      ethereumRpcUrl === ETHEREUM_DEFAULT_URL ? 'Ethereum PublicNode' : 'Nœud Ethereum configuré',
    trustedProxyIps: [...new Set(trustedProxyIps)],
    apiRateLimitPerMinute,
  };
}
