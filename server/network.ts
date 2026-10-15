import { z } from 'zod';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS, validateUpstreamUrl } from './config.js';

export type Fetcher = typeof fetch;
export type UpstreamFailureKind =
  'timeout' | 'network' | 'http' | 'too-large' | 'invalid' | 'rpc' | 'wrong-chain';

/** Error messages intentionally exclude URL, provider body, and RPC credentials. */
export class UpstreamError extends Error {
  constructor(public readonly kind: UpstreamFailureKind) {
    super(`Upstream request failed (${kind}).`);
    this.name = 'UpstreamError';
  }
}

export interface JsonRequestOptions {
  fetcher?: Fetcher;
  timeoutMs?: number;
  maxBytes?: number;
  body?: string;
}

export async function requestJson(url: string, options: JsonRequestOptions = {}): Promise<unknown> {
  return requestBoundedJson(url, options, MAX_RESPONSE_BYTES);
}

/** Pool snapshots and inventories only; ordinary upstream reads retain their 2 MiB ceiling. */
export async function requestMempoolJson(
  url: string,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  return requestBoundedJson(
    url,
    {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS),
    },
    32 * 1024 * 1024,
  );
}

async function requestBoundedJson(
  url: string,
  options: JsonRequestOptions,
  ceilingBytes: number,
): Promise<unknown> {
  validateUpstreamUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers:
        options.body === undefined
          ? { accept: 'application/json' }
          : {
              accept: 'application/json',
              'content-type': 'application/json',
            },
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError('http');
    }
    const maxBytes = Math.min(options.maxBytes ?? ceilingBytes, ceilingBytes);
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      await response.body?.cancel();
      throw new UpstreamError('too-large');
    }
    if (!response.body) throw new UpstreamError('invalid');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maxBytes) {
          await reader.cancel();
          throw new UpstreamError('too-large');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown;
    } catch {
      throw new UpstreamError('invalid');
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePayload<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UpstreamError('invalid');
  return result.data;
}

/** Integer arithmetic until the final display conversion. */
export function ratioToNumber(numerator: bigint, denominator: bigint, digits = 3): number {
  if (
    numerator < 0n ||
    denominator <= 0n ||
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > 9
  ) {
    throw new UpstreamError('invalid');
  }
  const scale = 10n ** BigInt(digits);
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new UpstreamError('invalid');
  return Number(scaled) / Number(scale);
}

export function bigintToSafeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new UpstreamError('invalid');
  return Number(value);
}
