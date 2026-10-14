import { z } from 'zod';
import { PENDING_SAMPLE_LIMIT, type Tx } from '../../shared/model.js';
import {
  MAX_RESPONSE_BYTES,
  UPSTREAM_TIMEOUT_MS,
  validateUpstreamUrl,
  type ServerConfig,
} from '../config.js';
import { parsePayload, UpstreamError } from '../network.js';

export const TOP_FEE_SAMPLE_LIMIT = PENDING_SAMPLE_LIMIT;
const safeInteger = z.number().int().nonnegative().safe();
const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

// mempool's compressTx: txid, fee, vsize, value, effective rate, flags, time, acceleration.
// Rank by the transaction's own fee/vsize, not its optional package/acceleration rate.
const compressedTransactionSchema = z.tuple([
  hashSchema,
  safeInteger.max(2_100_000_000_000_000),
  z.number().finite().min(1).max(1_000_000).multipleOf(0.25),
  safeInteger.max(2_100_000_000_000_000),
  z.number().finite().nonnegative(),
  safeInteger,
  safeInteger.optional(),
  z.literal(1).optional(),
]);
const projectedBlockSchema = z.object({
  index: z.literal(0),
  sequence: safeInteger,
  blockTransactions: z.array(compressedTransactionSchema).max(30_000),
});

/** A short read-only request to the configured provider's first projected mempool block. */
export async function fetchBitcoinTopFeeSample(config: ServerConfig): Promise<Tx[]> {
  const url = new URL(`${validateUpstreamUrl(config.bitcoinApiUrl)}/v1/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise<Tx[]>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      reject(new UpstreamError('network'));
      return;
    }
    let settled = false;
    let receivedBytes = 0;
    let receivedMessages = 0;
    const finish = (error?: UpstreamError, transactions?: Tx[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // The connection may already be closed or have failed during its handshake.
      }
      if (error) reject(error);
      else resolve(transactions ?? []);
    };
    const timeout = setTimeout(() => finish(new UpstreamError('timeout')), UPSTREAM_TIMEOUT_MS);
    timeout.unref?.();
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ 'track-mempool-block': 0 }));
      } catch {
        finish(new UpstreamError('network'));
      }
    };
    socket.onerror = () => finish(new UpstreamError('network'));
    socket.onclose = () => finish(new UpstreamError('network'));
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        finish(new UpstreamError('invalid'));
        return;
      }
      receivedMessages += 1;
      receivedBytes += Buffer.byteLength(event.data, 'utf8');
      if (receivedBytes > MAX_RESPONSE_BYTES || receivedMessages > 8) {
        finish(new UpstreamError('too-large'));
        return;
      }
      try {
        const envelope = parsePayload(
          z.object({ 'projected-block-transactions': projectedBlockSchema.optional() }),
          JSON.parse(event.data) as unknown,
        );
        const projected = envelope['projected-block-transactions'];
        if (projected === undefined) return;
        const ids = new Set<string>();
        for (const transaction of projected.blockTransactions) {
          const id = transaction[0].toLowerCase();
          if (ids.has(id)) throw new UpstreamError('invalid');
          ids.add(id);
        }
        // Virtual sizes are multiples of 1/4 byte: compare fee/weight exactly,
        // before rounding any value for the public snapshot.
        projected.blockTransactions.sort((left, right) => {
          const leftValue = BigInt(left[1]) * BigInt(right[2] * 4);
          const rightValue = BigInt(right[1]) * BigInt(left[2] * 4);
          return (
            (leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0) ||
            left[0].localeCompare(right[0])
          );
        });
        const transactions: Tx[] = projected.blockTransactions
          .slice(0, TOP_FEE_SAMPLE_LIMIT)
          .map((transaction) => ({
            id: transaction[0].toLowerCase(),
            chain: 'bitcoin',
            feeRate: Number((transaction[1] / transaction[2]).toFixed(3)),
            size: transaction[2],
            status: 'pending',
            kind: 'transfer',
            value: 'Montant non fourni',
          }));
        finish(undefined, transactions);
      } catch (error) {
        finish(error instanceof UpstreamError ? error : new UpstreamError('invalid'));
      }
    };
  });
}
