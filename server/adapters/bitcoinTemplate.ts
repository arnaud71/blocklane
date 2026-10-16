import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PENDING_SAMPLE_LIMIT, type Tx } from '../../shared/model.js';
import { UPSTREAM_TIMEOUT_MS, type ServerConfig } from '../config.js';
import {
  parsePayload,
  ratioToNumber,
  requestJson,
  requestMempoolJson,
  UpstreamError,
  type Fetcher,
  type UpstreamFailureKind,
} from '../network.js';

export const BITCOIN_TEMPLATE_REFRESH_MS = 15_000;
export const BITCOIN_TEMPLATE_MAX_AGE_MS = 30_000;
export const BITCOIN_TEMPLATE_MAX_TRANSACTIONS = 30_000;
export const BITCOIN_TEMPLATE_MAX_BYTES = 16 * 1_024 * 1_024;
const MAX_BLOCK_WEIGHT = 4_000_000;
const MAX_SATOSHIS = 2_100_000_000_000_000;
const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().safe();
const chainSchema = z.object({
  chain: z.string(),
  blocks: safeInteger,
  bestblockhash: hashSchema,
  initialblockdownload: z.boolean(),
});
const templateSchema = z.object({
  previousblockhash: hashSchema,
  height: safeInteger.positive(),
  weightlimit: safeInteger.positive().max(MAX_BLOCK_WEIGHT),
  transactions: z
    .array(
      z.object({
        txid: hashSchema,
        hash: hashSchema,
        data: z
          .string()
          .min(20)
          .max(MAX_BLOCK_WEIGHT * 2)
          .regex(/^(?:[a-fA-F0-9]{2})+$/),
        fee: safeInteger.max(MAX_SATOSHIS),
        weight: safeInteger.positive().max(MAX_BLOCK_WEIGHT),
        depends: z
          .array(safeInteger.positive().max(BITCOIN_TEMPLATE_MAX_TRANSACTIONS))
          .max(BITCOIN_TEMPLATE_MAX_TRANSACTIONS),
      }),
    )
    .max(BITCOIN_TEMPLATE_MAX_TRANSACTIONS),
});

export interface BitcoinTemplateSample {
  readonly transactions: readonly Tx[];
  /** Internal complete membership; this is never a proof of inclusion in a mined block. */
  readonly transactionIds: ReadonlySet<string>;
  /** Non-coinbase transactions in this node's candidate, not its mempool size. */
  readonly count: number;
  readonly observedAt: number;
  readonly source: string;
  readonly height: number;
  readonly previousBlockHash: string;
  /** Sum of the non-coinbase transaction weights; header and coinbase are excluded. */
  readonly weight: number;
  readonly weightLimit: number;
  /** Exact median of the complete candidate's own integer fees; even counts may yield half a satoshi. */
  readonly medianFeeSats: number | null;
}

export type BitcoinTemplateFailure = UpstreamFailureKind | 'not-ready' | 'disabled';
export interface BitcoinTemplateState {
  readonly pending: boolean;
  readonly nextAttemptAt: number;
  readonly failure: BitcoinTemplateFailure | null;
}

/** Reading starts at most one background collection, without awaiting optional mining RPCs. */
export interface BitcoinTemplateReader {
  (): BitcoinTemplateSample | null;
  state(): BitcoinTemplateState;
}

class NodeNotReadyError extends Error {}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new UpstreamError('timeout');
  return remaining;
}

function compareFees(
  left: { id: string; fee: bigint; weight: number },
  right: { id: string; fee: bigint; weight: number },
): number {
  const leftRate = left.fee * BigInt(right.weight);
  const rightRate = right.fee * BigInt(left.weight);
  return leftRate > rightRate ? -1 : leftRate < rightRate ? 1 : left.id.localeCompare(right.id);
}

/** The witness hash commits to the supplied bytes; the node still supplies the SegWit txid. */
function witnessHash(data: Buffer): string {
  return createHash('sha256')
    .update(createHash('sha256').update(data).digest())
    .digest()
    .reverse()
    .toString('hex');
}

function parseTemplate(
  raw: unknown,
  chain: z.infer<typeof chainSchema>,
  source: string,
  observedAt: number,
  deadline: number,
): BitcoinTemplateSample {
  const template = parsePayload(templateSchema, raw);
  if (
    !Number.isSafeInteger(chain.blocks + 1) ||
    template.height !== chain.blocks + 1 ||
    template.previousblockhash.toLowerCase() !== chain.bestblockhash.toLowerCase()
  )
    throw new UpstreamError('invalid');
  const transactionIds = new Set<string>();
  const witnessIds = new Set<string>();
  const ranked: Array<{ id: string; fee: bigint; weight: number }> = [];
  let weight = 0;
  let serializedBytes = 0;
  for (const [index, transaction] of template.transactions.entries()) {
    if (index % 128 === 0) remainingTimeout(deadline);
    const id = transaction.txid.toLowerCase();
    const hash = transaction.hash.toLowerCase();
    const data = Buffer.from(transaction.data, 'hex');
    // BIP141 weight is stripped bytes * 3 + total bytes. These bounds do not
    // reinterpret scripts or claim a complete consensus/SegWit transaction validation.
    if (
      transactionIds.has(id) ||
      witnessIds.has(hash) ||
      transaction.weight < data.length ||
      transaction.weight > data.length * 4 ||
      witnessHash(data) !== hash ||
      // Core emits one dependency per input: spending two outputs of the same
      // parent legitimately repeats its index. Every referenced parent must precede us.
      transaction.depends.some((dependency) => dependency >= index + 1)
    )
      throw new UpstreamError('invalid');
    transactionIds.add(id);
    witnessIds.add(hash);
    weight += transaction.weight;
    serializedBytes += data.length;
    if (weight > template.weightlimit || serializedBytes > MAX_BLOCK_WEIGHT)
      throw new UpstreamError('invalid');
    ranked.push({ id, fee: BigInt(transaction.fee), weight: transaction.weight });
  }
  remainingTimeout(deadline);
  const completeFees = ranked
    .map((transaction) => transaction.fee)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(completeFees.length / 2);
  const upperFee = completeFees[middle];
  const medianFeeSats =
    upperFee === undefined
      ? null
      : completeFees.length % 2 === 0
        ? // Each fee and their doubled median remain safe integers under MAX_SATOSHIS.
          Number(completeFees[middle - 1]! + upperFee) / 2
        : Number(upperFee);
  remainingTimeout(deadline);
  // All candidate members and dependencies were checked before this display-only ranking.
  const transactions: Tx[] = ranked
    .sort(compareFees)
    .slice(0, PENDING_SAMPLE_LIMIT)
    .map((tx) => ({
      id: tx.id,
      chain: 'bitcoin',
      feeRate: ratioToNumber(tx.fee * 4n, BigInt(tx.weight)),
      size: tx.weight / 4,
      status: 'pending',
      kind: 'transfer',
      value: 'Montant non fourni',
    }));
  remainingTimeout(deadline);
  return {
    transactions,
    transactionIds,
    count: transactionIds.size,
    observedAt,
    source,
    height: template.height,
    previousBlockHash: template.previousblockhash.toLowerCase(),
    weight,
    weightLimit: template.weightlimit,
    medianFeeSats,
  };
}

/** Isolated per service instance; source URLs and raw transactions never leave this reader. */
export function createBitcoinTemplateReader(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): BitcoinTemplateReader {
  let sample: BitcoinTemplateSample | null = null;
  let pending = false;
  let nextAttemptAt = 0;
  let failure: BitcoinTemplateFailure | null = config.bitcoinRpcUrl ? null : 'disabled';
  let nextRpcId = 0;
  async function rpc(
    method: 'getblockchaininfo' | 'getblocktemplate',
    deadline: number,
  ): Promise<unknown> {
    if (!config.bitcoinRpcUrl) throw new UpstreamError('network');
    nextRpcId = (nextRpcId % 1_000_000_000) + 1;
    const id = nextRpcId;
    const read = method === 'getblocktemplate' ? requestMempoolJson : requestJson;
    const raw = await read(config.bitcoinRpcUrl, {
      ...(fetcher === undefined ? {} : { fetcher }),
      timeoutMs: remainingTimeout(deadline),
      maxBytes: method === 'getblocktemplate' ? BITCOIN_TEMPLATE_MAX_BYTES : 64 * 1_024,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: method === 'getblocktemplate' ? [{ rules: ['segwit'] }] : [],
      }),
    });
    const response = parsePayload(
      z.object({
        id: z.literal(id),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      }),
      raw,
    );
    if (response.error != null) throw new UpstreamError('rpc');
    if (!Object.hasOwn(response, 'result')) throw new UpstreamError('invalid');
    return response.result;
  }
  async function collect(): Promise<BitcoinTemplateSample> {
    const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
    const chain = parsePayload(chainSchema, await rpc('getblockchaininfo', deadline));
    if (chain.chain !== 'main') throw new UpstreamError('wrong-chain');
    if (chain.initialblockdownload) throw new NodeNotReadyError();
    const raw = await rpc('getblocktemplate', deadline);
    return parseTemplate(
      raw,
      chain,
      config.bitcoinPoolSource ?? 'RPC Bitcoin configuré',
      now(),
      deadline,
    );
  }
  const reader: BitcoinTemplateReader = Object.assign(
    () => {
      const currentTime = now();
      if (
        sample &&
        (currentTime < sample.observedAt ||
          currentTime - sample.observedAt > BITCOIN_TEMPLATE_MAX_AGE_MS)
      )
        sample = null;
      if (config.bitcoinRpcUrl && !pending && currentTime >= nextAttemptAt) {
        pending = true;
        void Promise.resolve()
          .then(collect)
          .then((result) => {
            if (
              now() < result.observedAt ||
              now() - result.observedAt > BITCOIN_TEMPLATE_MAX_AGE_MS
            )
              throw new UpstreamError('timeout');
            sample = result;
            failure = null;
          })
          .catch((error: unknown) => {
            sample = null;
            failure =
              error instanceof NodeNotReadyError
                ? 'not-ready'
                : error instanceof UpstreamError
                  ? error.kind
                  : 'invalid';
          })
          .finally(() => {
            pending = false;
            nextAttemptAt = now() + BITCOIN_TEMPLATE_REFRESH_MS;
          });
      }
      return sample;
    },
    {
      state: (): BitcoinTemplateState => ({ pending, nextAttemptAt, failure }),
    },
  );
  return reader;
}
