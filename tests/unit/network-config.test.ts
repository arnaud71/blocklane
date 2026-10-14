import { describe, expect, it, vi } from 'vitest';
import { loadConfig, validateUpstreamUrl } from '../../server/config.js';
import {
  bigintToSafeNumber,
  ratioToNumber,
  requestJson,
  type Fetcher,
} from '../../server/network.js';

describe('deployment settings and bounded upstream requests', () => {
  it('allows administrator HTTPS endpoints and loopback HTTP nodes only', () => {
    for (const url of [
      'https://provider.example/key',
      'http://127.0.0.1:8545',
      'http://localhost:3000',
      'http://[::1]:8545',
    ]) {
      expect(validateUpstreamUrl(url)).toMatch(/^https?:\/\//);
    }
    for (const url of [
      'not a url',
      'http://provider.example',
      'file:///etc/passwd',
      'https://user:secret@provider.example',
      'https://provider.example/#secret',
    ]) {
      expect(() => validateUpstreamUrl(url)).toThrow();
    }
    expect(() => loadConfig({ PORT: '0' })).toThrow();
    expect(() =>
      loadConfig({ BITCOIN_API_URL: 'https://provider.example/api?secret=1' }),
    ).toThrow();
    const config = loadConfig({
      BITCOIN_API_URL: 'https://mempool.space/api/',
      ETHEREUM_RPC_URL: 'https://ethereum-rpc.publicnode.com/',
    });
    expect(config.bitcoinSource).toBe('mempool.space');
    expect(config.ethereumSource).toBe('Ethereum PublicNode');
  });

  it('validates bounded rate limits and exact trusted proxy addresses', () => {
    expect(loadConfig({}).trustedProxyIps).toEqual([]);
    expect(loadConfig({}).apiRateLimitPerMinute).toBe(120);
    expect(
      loadConfig({
        TRUSTED_PROXY_IPS: '127.0.0.1,::1,::ffff:127.0.0.1',
        API_RATE_LIMIT_PER_MINUTE: '500',
      }).trustedProxyIps,
    ).toEqual(['127.0.0.1', '::1']);
    for (const rate of ['0', '10001', '2.5', 'NaN'])
      expect(() => loadConfig({ API_RATE_LIMIT_PER_MINUTE: rate })).toThrow();
    for (const ips of ['*', '127.0.0.0/8', 'proxy.internal', '999.1.1.1'])
      expect(() => loadConfig({ TRUSTED_PROXY_IPS: ips })).toThrow();
    expect(() =>
      loadConfig({ TRUSTED_PROXY_IPS: Array.from({ length: 65 }, () => '127.0.0.1').join(',') }),
    ).toThrow();
  });

  it('bounds bodies even without Content-Length and refuses redirects', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('123456789'));
    await expect(
      requestJson('https://provider.example', { fetcher, maxBytes: 8 }),
    ).rejects.toMatchObject({ kind: 'too-large' });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
    const lengthFetcher = vi.fn<Fetcher>(
      async () => new Response('{}', { headers: { 'content-length': '99999' } }),
    );
    await expect(
      requestJson('https://provider.example', { fetcher: lengthFetcher, maxBytes: 8 }),
    ).rejects.toMatchObject({ kind: 'too-large' });
    const redirectFetcher = vi.fn<Fetcher>(async () => new Response('', { status: 302 }));
    await expect(
      requestJson('https://provider.example', { fetcher: redirectFetcher }),
    ).rejects.toMatchObject({ kind: 'http' });
  });

  it('times out, rejects bad JSON, and redacts network error details', async () => {
    const timeoutFetcher = vi.fn<Fetcher>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('secret URL')), {
            once: true,
          });
        }),
    );
    await expect(
      requestJson('https://provider.example/private-key', {
        fetcher: timeoutFetcher,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await expect(
      requestJson('https://provider.example', { fetcher: async () => new Response('invalid') }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    const error = await requestJson('https://provider.example/private-key', {
      fetcher: async () => {
        throw new Error('private-key');
      },
    }).catch((value: unknown) => value);
    expect(String(error)).not.toContain('private-key');
    expect(String(error)).toContain('network');
  });

  it('rejects values too large for safe display rather than silently losing integer precision', () => {
    expect(ratioToNumber(10n, 3n)).toBe(3.333);
    expect(() => ratioToNumber(10n ** 100n, 1n)).toThrow();
    expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow();
    expect(() => ratioToNumber(1n, 0n)).toThrow();
  });
});
