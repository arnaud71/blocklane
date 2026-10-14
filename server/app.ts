import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { z } from 'zod';
import { chainIdSchema, snapshotSchema } from '../shared/model.js';
import { SnapshotService, type SnapshotReader } from './cache.js';
import { loadConfig, normalizeIp, type ServerConfig } from './config.js';

const requestSchema = z
  .object({
    chain: chainIdSchema.default('bitcoin'),
    mode: z.enum(['demo', 'live']).default('live'),
  })
  .strict();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface AppOptions {
  config?: ServerConfig;
  service?: SnapshotReader;
  distDir?: string;
  now?: () => number;
  /** Testability override; deployment default is 120 API requests/minute/IP. */
  rateLimit?: number;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
  );
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function safeStaticName(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return null;
  return decoded.slice(1) || 'index.html';
}

function insideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  distDir: string,
  rawPath: string,
): Promise<void> {
  const fileName = safeStaticName(rawPath);
  if (fileName === null) {
    json(response, 400, { error: 'INVALID_PATH' });
    return;
  }
  try {
    const root = await realpath(distDir);
    let target = resolve(root, fileName);
    if (!insideRoot(root, target)) {
      json(response, 400, { error: 'INVALID_PATH' });
      return;
    }
    let file;
    try {
      target = await realpath(target);
      file = await stat(target);
    } catch {
      // SPA fallbacks apply to extensionless routes, never missing assets or secrets.
      if (extname(fileName)) {
        json(response, 404, { error: 'NOT_FOUND' });
        return;
      }
      target = await realpath(resolve(root, 'index.html'));
      file = await stat(target);
    }
    if (!insideRoot(root, target) || !file.isFile()) {
      json(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    const extension = extname(target);
    response.writeHead(200, {
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'content-length': file.size,
      'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    pipeline(createReadStream(target), response, (error) => {
      if (error) response.destroy();
    });
  } catch {
    json(response, 404, { error: 'NOT_FOUND' });
  }
}

/** Native Node HTTP server. Importing this module never opens a port. */
export function createApp(options: AppOptions = {}): Server {
  const config = options.config ?? loadConfig();
  const service = options.service ?? new SnapshotService({ config });
  const distDir = options.distDir ?? resolve(process.cwd(), 'dist');
  const now = options.now ?? Date.now;
  const limit = Math.max(1, Math.min(options.rateLimit ?? config.apiRateLimitPerMinute, 10_000));
  const trustedProxies = new Set(config.trustedProxyIps);
  const clients = new Map<string, { count: number; resetsAt: number }>();
  let nextPrune = 0;

  const server = createServer((request, response) => {
    setSecurityHeaders(response);
    void (async () => {
      const raw = request.url ?? '/';
      if (raw.length > 2_048) {
        json(response, 414, { error: 'URI_TOO_LONG' });
        return;
      }
      if (!raw.startsWith('/')) {
        json(response, 400, { error: 'INVALID_REQUEST' });
        return;
      }
      const url = new URL(raw, 'http://127.0.0.1');
      const rawPath = raw.split('?')[0]!;
      // Validate before URL normalization so encoded/literal traversal is rejected.
      if (safeStaticName(rawPath) === null) {
        json(response, 400, { error: 'INVALID_PATH' });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const time = now();
        if (time >= nextPrune) {
          for (const [address, entry] of clients)
            if (entry.resetsAt <= time) clients.delete(address);
          nextPrune = time + 60_000;
        }
        // Trust only an explicitly configured socket peer and one validated X-Real-IP.
        // X-Forwarded-For is never parsed; the proxy must overwrite X-Real-IP itself.
        const peer = normalizeIp(request.socket.remoteAddress ?? '') ?? 'unknown';
        const realIp = request.headers['x-real-ip'];
        const trustedClient =
          trustedProxies.has(peer) && typeof realIp === 'string' ? normalizeIp(realIp) : null;
        const address = trustedClient ?? peer;
        let client = clients.get(address);
        if (!client || client.resetsAt <= time) {
          if (!client && clients.size >= 10_000) {
            response.setHeader('Retry-After', '60');
            json(response, 429, { error: 'RATE_LIMITED' });
            return;
          }
          client = { count: 0, resetsAt: time + 60_000 };
          clients.set(address, client);
        }
        client.count += 1;
        if (client.count > limit) {
          response.setHeader(
            'Retry-After',
            Math.max(1, Math.ceil((client.resetsAt - time) / 1_000)),
          );
          json(response, 429, { error: 'RATE_LIMITED' });
          return;
        }
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        if (url.pathname === '/api/health') {
          json(response, 200, { status: 'ok', service: 'blockchain-observer', readOnly: true });
          return;
        }
        if (url.pathname === '/api/snapshot') {
          const entries = [...url.searchParams.entries()];
          const uniqueKeys = new Set(entries.map(([key]) => key));
          const query = requestSchema.safeParse(Object.fromEntries(entries));
          if (!query.success || entries.length !== uniqueKeys.size) {
            json(response, 400, {
              error: 'INVALID_REQUEST',
              message: 'Utiliser chain=bitcoin|ethereum et mode=live|demo uniquement.',
            });
            return;
          }
          const snapshot = snapshotSchema.parse(
            await service.get(query.data.chain, query.data.mode),
          );
          json(response, 200, snapshot);
          return;
        }
        json(response, 404, { error: 'NOT_FOUND' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      await serveStatic(request, response, distDir, rawPath);
    })().catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'INTERNAL_ERROR' });
      else response.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.maxRequestsPerSocket = 1_000;
  return server;
}
