import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppOptions } from '../../server/app.js';
import { config, liveSnapshot } from './fixtures.js';

const servers: Server[] = [];
const temporaryDirs: string[] = [];
async function start(options: AppOptions = {}) {
  const service = options.service ?? { get: vi.fn(async () => liveSnapshot()) };
  const server = createApp({ config, ...options, service });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}`, service };
}

async function rawGet(origin: string, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(origin, { method: 'GET', path }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(
    temporaryDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('native read-only API and static server', () => {
  it('serves health independently and validates exact query parameters', async () => {
    const { origin, service } = await start();
    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', readOnly: true });
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    for (const query of [
      'chain=solana',
      'mode=invalid',
      'chain=bitcoin&chain=ethereum',
      'url=https://evil.example',
    ]) {
      expect((await fetch(`${origin}/api/snapshot?${query}`)).status).toBe(400);
    }
    expect(service.get).not.toHaveBeenCalled();
    const snapshot = await fetch(`${origin}/api/snapshot`);
    expect(snapshot.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith('bitcoin', 'live');
    expect(snapshot.headers.get('cache-control')).toBe('no-store');
  });

  it('does not expose mutating API methods or upstream errors', async () => {
    const { origin, service } = await start({
      service: {
        get: vi.fn(async () => {
          throw new Error('RPC_API_SECRET');
        }),
      },
    });
    const post = await fetch(`${origin}/api/snapshot`, {
      method: 'POST',
      body: 'signed-transaction',
    });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect(service.get).not.toHaveBeenCalled();
    const error = await fetch(`${origin}/api/snapshot`);
    expect(error.status).toBe(500);
    expect(await error.text()).not.toContain('RPC_API_SECRET');
    expect((await fetch(`${origin}/api/unknown`)).status).toBe(404);
  });

  it('prevents rate-limit evasion using spoofed proxy headers', async () => {
    const { origin } = await start({ rateLimit: 2 });
    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      expect(
        (
          await fetch(`${origin}/api/health`, {
            headers: { 'x-real-ip': ip, 'x-forwarded-for': ip },
          })
        ).status,
      ).toBe(200);
    }
    const response = await fetch(`${origin}/api/health`, {
      headers: { 'x-real-ip': '198.51.100.3' },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
  });

  it('honors a single validated client IP only from an explicitly trusted proxy', async () => {
    const { origin } = await start({
      rateLimit: 1,
      config: { ...config, trustedProxyIps: ['127.0.0.1'] },
    });
    expect(
      (await fetch(`${origin}/api/health`, { headers: { 'x-real-ip': '198.51.100.1' } })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/api/health`, { headers: { 'x-real-ip': '198.51.100.2' } })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/api/health`, { headers: { 'x-real-ip': '198.51.100.1' } })).status,
    ).toBe(429);
    // An invalid or multi-value X-Real-IP falls back to the socket peer bucket.
    expect(
      (
        await fetch(`${origin}/api/health`, {
          headers: { 'x-real-ip': 'invalid', 'x-forwarded-for': '198.51.100.3' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/health`, {
          headers: { 'x-real-ip': '198.51.100.4,198.51.100.5' },
        })
      ).status,
    ).toBe(429);
  });

  it('serves the built application but rejects traversal, hidden files and symlink escape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'blocklane-static-'));
    temporaryDirs.push(directory);
    const dist = join(directory, 'dist');
    await mkdir(dist);
    await writeFile(join(dist, 'index.html'), '<!doctype html><p>Blocklane</p>');
    await writeFile(join(directory, 'secret.txt'), 'SERVER_SECRET');
    await symlink(join(directory, 'secret.txt'), join(dist, 'escape.txt'));
    const { origin } = await start({ distDir: dist });
    expect(await (await fetch(origin)).text()).toContain('Blocklane');
    expect((await fetch(`${origin}/pedagogy`)).status).toBe(200);
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/escape.txt`)).status).toBe(404);
    expect((await rawGet(origin, '/..%2fsecret.txt')).status).toBe(400);
    expect((await rawGet(origin, '/%2e%2e/secret.txt')).status).toBe(400);
    expect((await rawGet(origin, '/.env')).status).toBe(400);
    expect((await rawGet(origin, '/%00secret')).status).toBe(400);
    expect((await rawGet(origin, '/%invalid')).status).toBe(400);
    const head = await fetch(origin, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});
