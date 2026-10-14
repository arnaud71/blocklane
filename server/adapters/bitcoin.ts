import { z } from 'zod';
import { MAX_BLOCKS, MAX_TRANSACTIONS, snapshotSchema, type Snapshot } from '../../shared/model.js';
import type { ServerConfig } from '../config.js';
import { parsePayload, ratioToNumber, requestJson, type Fetcher } from '../network.js';

const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().safe();
export const bitcoinRecentSchema = z
  .array(
    z.object({
      txid: hashSchema,
      fee: safeInteger.max(2_100_000_000_000_000),
      vsize: z.number().int().positive().max(1_000_000),
    }),
  )
  .max(1_000);
export const bitcoinBlocksSchema = z
  .array(
    z.object({
      id: hashSchema,
      height: safeInteger,
      timestamp: safeInteger.max(32_503_680_000),
      tx_count: safeInteger.max(5_000_000),
      weight: z.number().int().nonnegative().max(4_000_000),
    }),
  )
  .min(1)
  .max(100);
export const bitcoinMempoolSchema = z.object({
  count: safeInteger,
  vsize: safeInteger,
  total_fee: safeInteger,
});
export const bitcoinFeesSchema = z.object({
  fastestFee: z.number().finite().nonnegative().max(100_000_000),
  halfHourFee: z.number().finite().nonnegative().max(100_000_000),
  hourFee: z.number().finite().nonnegative().max(100_000_000),
});

export async function fetchBitcoinSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): Promise<Snapshot> {
  const paths = ['/v1/blocks', '/mempool/recent', '/mempool', '/v1/fees/recommended'];
  const [blocksRaw, recentRaw, mempoolRaw, feesRaw] = await Promise.all(
    paths.map((path) =>
      requestJson(`${config.bitcoinApiUrl}${path}`, fetcher === undefined ? {} : { fetcher }),
    ),
  );
  const blocks = parsePayload(bitcoinBlocksSchema, blocksRaw);
  const transactions = parsePayload(bitcoinRecentSchema, recentRaw);
  const mempool = parsePayload(bitcoinMempoolSchema, mempoolRaw);
  const fees = parsePayload(bitcoinFeesSchema, feesRaw);
  return parsePayload(snapshotSchema, {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: config.bitcoinSource,
    observedAt: now(),
    coverage:
      'Vue du mempool du fournisseur Bitcoin : les passagers montrent un échantillon de ses transactions récentes. Chaque nœud peut observer un mempool différent. Taille des blocs en octets virtuels.',
    pendingCount: mempool.count,
    feeRate: fees.halfHourFee,
    feeUnit: 'sat/vB',
    transactions: transactions.slice(0, MAX_TRANSACTIONS).map((tx) => ({
      id: tx.txid.toLowerCase(),
      chain: 'bitcoin',
      feeRate: ratioToNumber(BigInt(tx.fee), BigInt(tx.vsize)),
      size: tx.vsize,
      status: 'pending',
      kind: 'transfer',
      value: 'Montant non fourni',
    })),
    blocks: blocks.slice(0, MAX_BLOCKS).map((block) => ({
      height: block.height,
      hash: block.id.toLowerCase(),
      timestamp: block.timestamp,
      txCount: block.tx_count,
      used: block.weight / 4,
      capacity: 1_000_000,
    })),
    message:
      'Indicateur de frais : estimation du fournisseur pour environ 30 minutes, sans garantie de confirmation.',
  });
}
