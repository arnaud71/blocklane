import { z } from 'zod';
import {
  CONFIRMED_SAMPLE_LIMIT,
  MAX_BLOCKS,
  MAX_CATCHUP_BLOCKS,
  MAX_INCLUSION_BLOCKS,
  MAX_TRACKED_TRANSACTIONS,
  MAX_TRANSACTIONS,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  blockSchema,
  ethereumMempoolSchema,
  latestBlockValueSchema,
  snapshotSchema,
  type Block,
  type BlockInclusions,
  type EthereumMempool,
  type LatestBlockValue,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import type { ServerConfig } from '../config.js';
import {
  createEthereumDependencyTracker,
  ethereumNonceKey,
  type EthereumNonceMetadata,
  type EthereumPoolNonceEntry,
  type EthereumPoolNonceIndex,
} from './ethereumDependencies.js';
import { createPoolFlowTracker } from './poolFlow.js';
import {
  bigintToSafeNumber,
  parsePayload,
  ratioToNumber,
  requestJson,
  requestMempoolJson,
  UpstreamError,
  type Fetcher,
} from '../network.js';

export const hexQuantitySchema = z
  .string()
  .max(66)
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const ethereumTransactionSchema = z
  .object({
    hash: hashSchema,
    from: addressSchema,
    nonce: hexQuantitySchema.optional(),
    to: addressSchema.nullable(),
    value: hexQuantitySchema,
    gas: hexQuantitySchema,
    gasPrice: hexQuantitySchema.optional(),
    maxFeePerGas: hexQuantitySchema.optional(),
    maxPriorityFeePerGas: hexQuantitySchema.optional(),
    input: z
      .string()
      .max(524_288)
      .regex(/^0x(?:[a-fA-F0-9]{2})*$/),
  })
  .superRefine((tx, context) => {
    const hasMaxFee = tx.maxFeePerGas !== undefined;
    const hasPriorityFee = tx.maxPriorityFeePerGas !== undefined;
    if (hasMaxFee !== hasPriorityFee || (!hasMaxFee && tx.gasPrice === undefined)) {
      context.addIssue({ code: 'custom', message: 'Transaction has incomplete gas fee fields' });
    }
    if (
      hasMaxFee &&
      hasPriorityFee &&
      BigInt(tx.maxPriorityFeePerGas!) > BigInt(tx.maxFeePerGas!)
    ) {
      context.addIssue({ code: 'custom', message: 'Priority fee exceeds the transaction fee cap' });
    }
  });
type EthereumTransaction = z.infer<typeof ethereumTransactionSchema>;

const blockFields = {
  hash: hashSchema.nullable(),
  parentHash: hashSchema.optional(),
  number: hexQuantitySchema.nullable(),
  timestamp: hexQuantitySchema,
  gasUsed: hexQuantitySchema,
  gasLimit: hexQuantitySchema,
  baseFeePerGas: hexQuantitySchema.optional(),
};
export const ethereumFullBlockSchema = z
  .object({
    ...blockFields,
    transactions: z.array(ethereumTransactionSchema).max(50_000),
  })
  .refine(
    (block) => BigInt(block.gasLimit) > 0n && BigInt(block.gasUsed) <= BigInt(block.gasLimit),
    {
      message: 'Invalid block gas usage',
    },
  )
  .refine(
    (block) =>
      new Set(block.transactions.map((tx) => tx.hash.toLowerCase())).size ===
      block.transactions.length,
    { message: 'Duplicate transaction identifiers in a block' },
  );
export const ethereumBlockHeaderSchema = z
  .object({
    ...blockFields,
    transactions: z.array(hashSchema).max(50_000),
  })
  .refine(
    (block) => BigInt(block.gasLimit) > 0n && BigInt(block.gasUsed) <= BigInt(block.gasLimit),
    {
      message: 'Invalid block gas usage',
    },
  )
  .refine(
    (block) =>
      new Set(block.transactions.map((id) => id.toLowerCase())).size === block.transactions.length,
    { message: 'Duplicate transaction identifiers in a block' },
  );
type EthereumBlock = z.infer<typeof ethereumFullBlockSchema>;
type EthereumBlockHeader = z.infer<typeof ethereumBlockHeaderSchema>;
const MEMPOOL_REFRESH_MS = 30_000;
const MEMPOOL_MAX_AGE_MS = 120_000;
const POOL_REFRESH_MS = 30_000;
const POOL_FAILURE_RETRY_MS = 60_000;
const POOL_RPC_RETRY_MS = 5 * 60_000;
const MAX_POOL_TRANSACTIONS = 50_000;
const MAX_RECENT_BLOCK_TRANSACTION_IDS = 65_536;
const RECEIPT_BATCH_SIZE = 16;
const RECEIPT_CONCURRENCY = 2;
const RECEIPT_REFRESH_MS = 15_000;
const RECEIPT_RETRY_MS = 60_000;
const RECEIPT_PENDING_AGE_MS = 30_000;
const ethereumReceiptSchema = z.object({
  transactionHash: hashSchema,
  blockHash: hashSchema,
  blockNumber: hexQuantitySchema,
  // A reverted execution is nevertheless included in its block.
  status: z.enum(['0x0', '0x1']).optional(),
});
type EthereumPoolFailure = 'rpc' | 'too-large' | 'timeout' | 'invalid' | 'unavailable';
interface EthereumPool extends EthereumPoolNonceIndex {
  pending: EthereumTransaction[];
  pendingIds: Set<string>;
  queuedIds: Set<string>;
  pendingCount: number;
  queuedCount: number;
  observedAt: number;
  parentBlockHash: string;
  height: number;
  generation: number;
}

function poolRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UpstreamError('invalid');
  }
  return value as Record<string, unknown>;
}

/** Accept the complete Geth txpool_content account/nonce maps, without truncating them. */
function parseEthereumPool(
  value: unknown,
  observedAt: number,
  head: Block,
  generation: number,
): EthereumPool {
  const content = poolRecord(value);
  const pending: EthereumTransaction[] = [];
  const pendingIds = new Set<string>();
  const queuedIds = new Set<string>();
  const identifiers = new Set<string>();
  const byNonce = new Map<string, EthereumPoolNonceEntry>();
  const minimumNonce = new Map<string, bigint>();
  let pendingCount = 0;
  let queuedCount = 0;
  for (const category of ['pending', 'queued'] as const) {
    const accounts = poolRecord(content[category]);
    const accountEntries = Object.entries(accounts);
    if (accountEntries.length > MAX_POOL_TRANSACTIONS) throw new UpstreamError('too-large');
    const seenAccounts = new Set<string>();
    for (const [account, nonces] of accountEntries) {
      if (!addressSchema.safeParse(account).success || seenAccounts.has(account.toLowerCase())) {
        throw new UpstreamError('invalid');
      }
      seenAccounts.add(account.toLowerCase());
      const nonceEntries = Object.entries(poolRecord(nonces));
      if (nonceEntries.length > MAX_POOL_TRANSACTIONS - identifiers.size) {
        throw new UpstreamError('too-large');
      }
      const seenNonces = new Set<bigint>();
      for (const [nonceKey, raw] of nonceEntries) {
        if (!/^(?:0|[1-9][0-9]{0,77}|0x[0-9a-fA-F]{1,64})$/.test(nonceKey)) {
          throw new UpstreamError('invalid');
        }
        const transaction = parsePayload(ethereumTransactionSchema, raw);
        const nonce = parsePayload(hexQuantitySchema, poolRecord(raw).nonce);
        const nonceNumber = BigInt(nonce);
        const from = transaction.from.toLowerCase();
        const key = ethereumNonceKey(from, nonceNumber.toString());
        if (
          transaction.from.toLowerCase() !== account.toLowerCase() ||
          nonceNumber !== BigInt(nonceKey) ||
          seenNonces.has(nonceNumber) ||
          byNonce.has(key) ||
          identifiers.has(transaction.hash.toLowerCase())
        ) {
          throw new UpstreamError('invalid');
        }
        // Validate resources before retaining a compact transaction representation.
        if (bigintToSafeNumber(BigInt(transaction.gas)) === 0) {
          throw new UpstreamError('invalid');
        }
        seenNonces.add(nonceNumber);
        identifiers.add(transaction.hash.toLowerCase());
        byNonce.set(key, {
          transactionId: transaction.hash.toLowerCase(),
          from,
          nonce: nonceNumber.toString(),
          state: category,
        });
        if (!minimumNonce.has(from) || nonceNumber < minimumNonce.get(from)!)
          minimumNonce.set(from, nonceNumber);
        if (identifiers.size > MAX_POOL_TRANSACTIONS) throw new UpstreamError('too-large');
        if (category === 'pending') {
          pending.push({ ...transaction, input: transaction.input.length > 2 ? '0x00' : '0x' });
          pendingIds.add(transaction.hash.toLowerCase());
          pendingCount += 1;
        } else {
          queuedIds.add(transaction.hash.toLowerCase());
          queuedCount += 1;
        }
      }
    }
  }
  return {
    pending,
    pendingIds,
    queuedIds,
    pendingCount,
    queuedCount,
    observedAt,
    byNonce,
    minimumNonce,
    parentBlockHash: head.hash,
    height: head.height + 1,
    generation,
  };
}

function* dependencyMetadata(
  transactions: readonly EthereumTransaction[],
): Iterable<EthereumNonceMetadata> {
  for (const transaction of transactions) {
    if (transaction.nonce === undefined) continue;
    yield {
      transactionId: transaction.hash.toLowerCase(),
      from: transaction.from.toLowerCase(),
      nonce: BigInt(transaction.nonce).toString(),
    };
  }
}

const ethereumTxpoolStatusSchema = z.object({
  pending: hexQuantitySchema,
  queued: hexQuantitySchema,
});

/** EIP-1559 effective price is min(maxFeePerGas, baseFeePerGas + maxPriorityFeePerGas). */
export function effectiveGasPriceWei(tx: EthereumTransaction, baseFeeWei: bigint): bigint {
  if (baseFeeWei < 0n) throw new UpstreamError('invalid');
  if (tx.maxFeePerGas !== undefined && tx.maxPriorityFeePerGas !== undefined) {
    const feeCap = BigInt(tx.maxFeePerGas);
    const candidatePrice = baseFeeWei + BigInt(tx.maxPriorityFeePerGas);
    return feeCap < candidatePrice ? feeCap : candidatePrice;
  }
  if (tx.gasPrice === undefined) throw new UpstreamError('invalid');
  return BigInt(tx.gasPrice);
}

/** EIP-1559's exact next-block base fee, using the validated execution parent. */
export function nextBaseFeeWei(baseFeeWei: bigint, gasUsed: bigint, gasLimit: bigint): bigint {
  const target = gasLimit / 2n;
  if (baseFeeWei < 0n || gasUsed < 0n || gasUsed > gasLimit || target <= 0n)
    throw new UpstreamError('invalid');
  if (gasUsed === target) return baseFeeWei;
  if (gasUsed > target) {
    const delta = (baseFeeWei * (gasUsed - target)) / target / 8n;
    return baseFeeWei + (delta > 0n ? delta : 1n);
  }
  return baseFeeWei - (baseFeeWei * (target - gasUsed)) / target / 8n;
}

export function formatEther(wei: bigint): string {
  const unit = 10n ** 18n;
  const integer = wei / unit;
  const fraction = (wei % unit).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  if (wei > 0n && wei < 10n ** 12n) return '< 0.000001 ETH';
  const approximate = wei % 10n ** 12n !== 0n;
  return `${approximate ? '≈ ' : ''}${integer}${fraction ? `.${fraction}` : ''} ETH`;
}

let nextRpcId = 0;

async function rpc(
  config: ServerConfig,
  method:
    | 'eth_chainId'
    | 'eth_getBlockByNumber'
    | 'eth_getTransactionReceipt'
    | 'txpool_status'
    | 'txpool_content',
  params: unknown[],
  fetcher?: Fetcher,
): Promise<unknown> {
  nextRpcId = (nextRpcId % 1_000_000_000) + 1;
  const id = nextRpcId;
  const request = method === 'txpool_content' ? requestMempoolJson : requestJson;
  const raw = await request(config.ethereumRpcUrl, {
    ...(fetcher === undefined ? {} : { fetcher }),
    ...(method === 'txpool_status' ? { maxBytes: 64 * 1_024 } : {}),
    ...(method === 'eth_getTransactionReceipt' ? { maxBytes: 256 * 1_024 } : {}),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const envelope = parsePayload(
    z.object({
      jsonrpc: z.literal('2.0'),
      id: z.literal(id),
      result: z.unknown().optional(),
      error: z.object({ code: z.number().int(), message: z.string().max(2_048) }).optional(),
    }),
    raw,
  );
  if (envelope.error) throw new UpstreamError('rpc');
  if (!Object.hasOwn(envelope, 'result')) throw new UpstreamError('invalid');
  return envelope.result;
}

function toBlock(block: EthereumBlock | EthereumBlockHeader): Block {
  if (block.hash === null || block.number === null) throw new UpstreamError('invalid');
  return parsePayload(blockSchema, {
    height: bigintToSafeNumber(BigInt(block.number)),
    hash: block.hash.toLowerCase(),
    timestamp: bigintToSafeNumber(BigInt(block.timestamp)),
    txCount: block.transactions.length,
    used: bigintToSafeNumber(BigInt(block.gasUsed)),
    capacity: bigintToSafeNumber(BigInt(block.gasLimit)),
  });
}

function latestEthereumBlockValue(
  block: EthereumBlock,
  latest: Block,
  observedAt: number,
): LatestBlockValue {
  // Sum the complete validated block before the displayed sample is truncated.
  // Declared top-level native values include failed calls; receipts/traces are not fetched.
  const amount = block.transactions.reduce(
    (total, transaction) => total + BigInt(transaction.value),
    0n,
  );
  return parsePayload(latestBlockValueSchema, {
    blockHash: latest.hash,
    blockHeight: latest.height,
    amount: amount.toString(),
    unit: 'wei',
    method: 'ethereum-transaction-value-sum',
    transactionCount: block.transactions.length,
    observedAt,
  });
}

function toTransactions(block: EthereumBlock, status: Tx['status'], limit: number): Tx[] {
  if (status === 'confirmed' && block.hash === null) throw new UpstreamError('invalid');
  if (
    block.baseFeePerGas === undefined &&
    block.transactions.some((tx) => tx.maxFeePerGas !== undefined)
  ) {
    throw new UpstreamError('invalid');
  }
  const baseFeeWei = BigInt(block.baseFeePerGas ?? '0x0');
  const pricedTransactions = block.transactions.map((tx) => ({
    tx,
    priceWei: effectiveGasPriceWei(tx, baseFeeWei),
  }));
  // Rank the complete provider block before truncation or rounded display conversion.
  pricedTransactions.sort(
    (left, right) =>
      (left.priceWei > right.priceWei ? -1 : left.priceWei < right.priceWei ? 1 : 0) ||
      left.tx.hash.localeCompare(right.tx.hash),
  );
  return pricedTransactions.slice(0, limit).map(({ tx, priceWei }) => ({
    id: tx.hash.toLowerCase(),
    chain: 'ethereum',
    feeRate: ratioToNumber(priceWei, 1_000_000_000n),
    // This is the declared transaction gas limit, not a measured receipt gas usage.
    size: bigintToSafeNumber(BigInt(tx.gas)),
    status,
    ...(status === 'confirmed' ? { blockHash: block.hash!.toLowerCase() } : {}),
    kind: tx.to === null || tx.input.length > 2 ? 'contract' : 'transfer',
    value: formatEther(BigInt(tx.value)),
    ...(tx.nonce === undefined
      ? {}
      : {
          ethereum: {
            from: tx.from.toLowerCase(),
            nonce: BigInt(tx.nonce).toString(),
            ...(tx.maxFeePerGas !== undefined && tx.maxPriorityFeePerGas !== undefined
              ? {
                  maxFeePerGasWei: BigInt(tx.maxFeePerGas).toString(),
                  maxPriorityFeePerGasWei: BigInt(tx.maxPriorityFeePerGas).toString(),
                }
              : { gasPriceWei: BigInt(tx.gasPrice!).toString() }),
          },
        }),
  }));
}

interface ObservedEthereumBlock {
  block: Block;
  parentHash: string | undefined;
  transactionIds: string[];
}

interface CheckedEthereumBlock {
  block: Block;
  parentHash: string | undefined;
  /** Complete IDs, independently bounded; absent when this block's ID set was evicted. */
  transactionIds?: string[];
}

interface ReceiptInclusion {
  observed: ObservedEthereumBlock;
  transactionId: string;
  generation: number;
}

function observedBlock(block: EthereumBlock | EthereumBlockHeader): ObservedEthereumBlock {
  return {
    block: toBlock(block),
    parentHash: block.parentHash?.toLowerCase(),
    transactionIds: block.transactions.map((transaction) =>
      (typeof transaction === 'string' ? transaction : transaction.hash).toLowerCase(),
    ),
  };
}

/** One bounded tracker and replay journal shared by the server's Ethereum cache. */
export function createEthereumProvider(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): () => Promise<Snapshot> {
  const tracked = new Map<string, number>();
  const dependencies = createEthereumDependencyTracker();
  const poolFlow = createPoolFlowTracker({
    source: config.ethereumSource,
    method: 'txpool_content',
    maxTransactions: MAX_POOL_TRANSACTIONS,
  });
  let poolFlowEpoch = 0;
  let poolFlowContext: { observedAt: number; generation: number; epoch: number } | null = null;
  let lastPoolFlowClock: number | null = null;
  const checked = new Map<number, CheckedEthereumBlock>();
  const journal = new Map<number, BlockInclusions>();
  const journalPriority = new Map<number, number>();
  const firstTrackedAt = new Map<string, number>();
  const receiptRetryAt = new Map<string, number>();
  let receiptResults: ReceiptInclusion[] = [];
  let receiptInFlight: Promise<void> | null = null;
  let receiptNextRefreshAt = 0;
  let branchGeneration = 0;
  let proofSequence = 0;
  let lastHead: Block | null = null;
  let cursor: number | null = null;
  let skippedHistory = false;
  let lastMempool: EthereumMempool | null = null;
  let mempoolRefreshFailed = false;
  let mempoolNextRefreshAt = 0;
  let mempoolInFlight: Promise<void> | null = null;
  let lastPool: EthereumPool | null = null;
  let poolFailure: EthereumPoolFailure | null = null;
  let poolNextRefreshAt = 0;
  let poolInFlight: Promise<void> | null = null;

  function invalidatePoolFlow(): void {
    poolFlow.invalidate();
    poolFlowContext = null;
    poolFlowEpoch += 1;
  }

  function poolFlowTime(): number {
    const time = now();
    if (
      !Number.isSafeInteger(time) ||
      time < 0 ||
      (lastPoolFlowClock !== null && time < lastPoolFlowClock)
    )
      invalidatePoolFlow();
    lastPoolFlowClock = Number.isSafeInteger(time) && time >= 0 ? time : null;
    return time;
  }

  async function refreshPool(head: Block, generation: number, flowEpoch: number): Promise<void> {
    try {
      const raw = await rpc(config, 'txpool_content', [], fetcher);
      const observedAt = poolFlowTime();
      lastPool = parseEthereumPool(raw, observedAt, head, generation);
      if (generation === branchGeneration && flowEpoch === poolFlowEpoch) {
        // Moving between queued and pending changes eligibility, never pool membership.
        poolFlow.observe([...lastPool.pendingIds, ...lastPool.queuedIds], observedAt);
        poolFlowContext = { observedAt, generation, epoch: flowEpoch };
      }
      poolFailure = null;
      poolNextRefreshAt = now() + POOL_REFRESH_MS;
    } catch (error) {
      invalidatePoolFlow();
      poolFailure =
        error instanceof UpstreamError &&
        ['rpc', 'too-large', 'timeout', 'invalid'].includes(error.kind)
          ? (error.kind as EthereumPoolFailure)
          : 'unavailable';
      // A refusal is usually a provider capability restriction, not a transient block failure.
      poolNextRefreshAt =
        now() + (poolFailure === 'rpc' ? POOL_RPC_RETRY_MS : POOL_FAILURE_RETRY_MS);
    } finally {
      poolInFlight = null;
    }
  }

  function schedulePoolRefresh(head: Block): void {
    if (poolInFlight !== null || now() < poolNextRefreshAt) return;
    // Drop old contents before a new large response is parsed. They never become a stale top.
    lastPool = null;
    const generation = branchGeneration;
    const flowEpoch = poolFlowEpoch;
    poolInFlight = Promise.resolve().then(() => refreshPool(head, generation, flowEpoch));
  }

  function currentPool(): EthereumPool | null {
    if (lastPool === null) return null;
    const age = now() - lastPool.observedAt;
    if (age < 0 || age > POOL_REFRESH_MS) {
      if (age < 0) invalidatePoolFlow();
      lastPool = null;
      return null;
    }
    return lastPool;
  }

  async function refreshMempool(): Promise<void> {
    try {
      const status = parsePayload(
        ethereumTxpoolStatusSchema,
        await rpc(config, 'txpool_status', [], fetcher),
      );
      const pending = bigintToSafeNumber(BigInt(status.pending));
      const queued = bigintToSafeNumber(BigInt(status.queued));
      lastMempool = parsePayload(ethereumMempoolSchema, {
        pending,
        queued,
        observedAt: now(),
        status: 'ok',
        method: 'txpool_status',
      });
      mempoolRefreshFailed = false;
    } catch {
      // An optional local pool method must not invalidate or delay valid chain data.
      mempoolRefreshFailed = true;
    } finally {
      mempoolNextRefreshAt = now() + MEMPOOL_REFRESH_MS;
      mempoolInFlight = null;
    }
  }

  function scheduleMempoolRefresh(): void {
    if (mempoolInFlight !== null || now() < mempoolNextRefreshAt) return;
    mempoolInFlight = Promise.resolve().then(refreshMempool);
  }

  function currentMempool(): EthereumMempool | null {
    if (lastMempool === null) return null;
    const age = now() - lastMempool.observedAt;
    if (age < 0 || age > MEMPOOL_MAX_AGE_MS) return null;
    return {
      ...lastMempool,
      status: mempoolRefreshFailed || age > MEMPOOL_REFRESH_MS ? 'stale' : 'ok',
    };
  }

  function invalidateReceiptProofs(): void {
    branchGeneration += 1;
    receiptResults = [];
    receiptRetryAt.clear();
  }

  function resetBranch(): void {
    invalidatePoolFlow();
    checked.clear();
    journal.clear();
    journalPriority.clear();
    invalidateReceiptProofs();
    cursor = null;
  }

  function discardUntrackedReceiptState(): void {
    for (const id of firstTrackedAt.keys()) if (!tracked.has(id)) firstTrackedAt.delete(id);
    for (const id of receiptRetryAt.keys()) if (!tracked.has(id)) receiptRetryAt.delete(id);
    receiptResults = receiptResults.filter((result) => tracked.has(result.transactionId));
  }

  function scheduleReceiptRefresh(head: Block, pendingIds: Set<string>): void {
    if (receiptInFlight !== null || now() < receiptNextRefreshAt) return;
    const provenIds = new Set([...journal.values()].flatMap((entry) => entry.transactionIds));
    const generation = branchGeneration;
    const candidates = [...tracked.keys()]
      .filter(
        (id) =>
          firstTrackedAt.has(id) &&
          !provenIds.has(id) &&
          !receiptResults.some((result) => result.transactionId === id) &&
          now() >= (receiptRetryAt.get(id) ?? 0) &&
          (!pendingIds.has(id) ||
            now() - (firstTrackedAt.get(id) ?? now()) >= RECEIPT_PENDING_AGE_MS),
      )
      // Probe every retained ID before retrying the same prefix of unavailable receipts.
      .sort((left, right) => (receiptRetryAt.get(left) ?? 0) - (receiptRetryAt.get(right) ?? 0))
      .slice(0, RECEIPT_BATCH_SIZE);
    if (candidates.length === 0) return;
    candidates.forEach((id) => receiptRetryAt.set(id, now() + RECEIPT_RETRY_MS));
    receiptInFlight = Promise.resolve()
      .then(async () => {
        let next = 0;
        async function worker(): Promise<void> {
          while (next < candidates.length && generation === branchGeneration) {
            const id = candidates[next++];
            if (id === undefined || !tracked.has(id)) continue;
            try {
              const raw = await rpc(config, 'eth_getTransactionReceipt', [id], fetcher);
              if (raw === null) continue;
              const receipt = parsePayload(ethereumReceiptSchema, raw);
              const height = bigintToSafeNumber(BigInt(receipt.blockNumber));
              if (
                receipt.transactionHash.toLowerCase() !== id ||
                height > head.height ||
                generation !== branchGeneration
              )
                continue;
              const canonical = observedBlock(
                parsePayload(
                  ethereumBlockHeaderSchema,
                  await rpc(config, 'eth_getBlockByNumber', [receipt.blockNumber, false], fetcher),
                ),
              );
              if (
                canonical.block.height !== height ||
                canonical.block.hash !== receipt.blockHash.toLowerCase() ||
                !canonical.transactionIds.includes(id) ||
                generation !== branchGeneration ||
                !tracked.has(id)
              )
                continue;
              const known = checked.get(height);
              if (known !== undefined && known.block.hash !== canonical.block.hash) continue;
              if (receiptResults.length < RECEIPT_BATCH_SIZE)
                receiptResults.push({
                  observed: { ...canonical, transactionIds: [id] },
                  transactionId: id,
                  generation,
                });
            } catch {
              // An absent, malformed, failed or noncanonical receipt never proves inclusion.
            } finally {
              if (generation === branchGeneration && tracked.has(id))
                receiptRetryAt.set(id, now() + RECEIPT_RETRY_MS);
            }
          }
        }
        await Promise.all(Array.from({ length: RECEIPT_CONCURRENCY }, () => worker()));
      })
      .finally(() => {
        receiptNextRefreshAt = now() + RECEIPT_REFRESH_MS;
        receiptInFlight = null;
      });
  }

  function retainRecentBlockIds(): void {
    let remaining = MAX_RECENT_BLOCK_TRANSACTION_IDS;
    const entries = [...checked.values()].sort(
      (left, right) => right.block.height - left.block.height,
    );
    for (const entry of entries) {
      if (entry.transactionIds === undefined) continue;
      if (entry.transactionIds.length > remaining) delete entry.transactionIds;
      else remaining -= entry.transactionIds.length;
    }
  }

  function retainProof(observed: ObservedEthereumBlock): void {
    const previous = journal.get(observed.block.height);
    const identifiers = new Set(
      previous?.block.hash === observed.block.hash ? previous.transactionIds : [],
    );
    observed.transactionIds.forEach((id) => {
      if (tracked.has(id)) identifiers.add(id);
    });
    if (identifiers.size > (previous?.transactionIds.length ?? 0))
      journalPriority.set(observed.block.height, ++proofSequence);
    journal.set(observed.block.height, {
      block: observed.block,
      transactionIds: [...identifiers],
    });
  }

  function boundedJournal(head: Block): BlockInclusions[] {
    const entries = [...journal.values()].sort(
      (left, right) =>
        (journalPriority.get(right.block.height) ?? 0) -
          (journalPriority.get(left.block.height) ?? 0) || right.block.height - left.block.height,
    );
    // The current head must remain present even if old recovery proofs fill the journal.
    // Its explicit empty entry also lets clients distinguish a verified new block from a gap.
    const latestEntry = journal.get(head.height);
    const retained =
      latestEntry === undefined
        ? entries.slice(0, MAX_INCLUSION_BLOCKS)
        : [
            latestEntry,
            ...entries
              .filter((entry) => entry.block.height !== head.height)
              .slice(0, MAX_INCLUSION_BLOCKS - 1),
          ];
    journal.clear();
    let remaining = MAX_TRACKED_TRANSACTIONS;
    const seen = new Set<string>();
    for (const entry of retained) {
      const transactionIds = entry.transactionIds.filter((id) => {
        if (remaining === 0 || seen.has(id)) return false;
        seen.add(id);
        remaining -= 1;
        return true;
      });
      journal.set(entry.block.height, { block: entry.block, transactionIds });
    }
    for (const height of journalPriority.keys())
      if (!journal.has(height)) journalPriority.delete(height);
    return [...journal.values()];
  }

  const collect = async (): Promise<Snapshot> => {
    poolFlowTime();
    const [chainIdRaw, latestRaw, pendingResult] = await Promise.all([
      rpc(config, 'eth_chainId', [], fetcher),
      rpc(config, 'eth_getBlockByNumber', ['latest', true], fetcher),
      rpc(config, 'eth_getBlockByNumber', ['pending', true], fetcher).then(
        (value) => ({ value, failed: false }),
        () => ({ value: null, failed: true }),
      ),
    ]);
    let latest: EthereumBlock;
    let latestObserved: ObservedEthereumBlock;
    let confirmedTransactions: Tx[];
    let projectionBaseFeeWei: bigint | null;
    try {
      const chainId = parsePayload(hexQuantitySchema, chainIdRaw);
      if (BigInt(chainId) !== 1n) throw new UpstreamError('wrong-chain');
      latest = parsePayload(ethereumFullBlockSchema, latestRaw);
      latestObserved = observedBlock(latest);
      confirmedTransactions = toTransactions(latest, 'confirmed', CONFIRMED_SAMPLE_LIMIT);
      projectionBaseFeeWei =
        latest.baseFeePerGas === undefined
          ? null
          : nextBaseFeeWei(
              BigInt(latest.baseFeePerGas),
              BigInt(latest.gasUsed),
              BigInt(latest.gasLimit),
            );
    } catch (error) {
      // Do not apply work started against a chain/head that is no longer verifiable.
      resetBranch();
      throw error;
    }
    const latestBlock = latestObserved.block;
    if (
      [...checked.values()].some(
        (entry) =>
          entry.block.height !== latestBlock.height && entry.block.hash === latestBlock.hash,
      )
    ) {
      throw new UpstreamError('invalid');
    }
    // The complete required latest observation was validated before tracker mutation.
    // Background refresh on the same fixed, chain-verified RPC; never await this optional call.
    scheduleMempoolRefresh();
    const collectedAt = now();
    const latestBlockValue = latestEthereumBlockValue(latest, latestBlock, collectedAt);
    for (const [id, lastObservedAt] of tracked) {
      if (collectedAt - lastObservedAt >= TRACKED_TRANSACTION_TTL_MS) tracked.delete(id);
    }
    dependencies.prune(tracked);

    const knownAtHeight = checked.get(latestBlock.height)?.block;
    const knownParent = checked.get(latestBlock.height - 1)?.block;
    let branchChanged =
      (lastHead !== null && latestBlock.height < lastHead.height) ||
      (knownAtHeight !== undefined && knownAtHeight.hash !== latestBlock.hash) ||
      (latestObserved.parentHash !== undefined &&
        knownParent !== undefined &&
        latestObserved.parentHash !== knownParent.hash);
    if (branchChanged) resetBranch();
    schedulePoolRefresh(latestBlock);
    discardUntrackedReceiptState();
    // Apply only work completed before this collection. No optional receipt is awaited.
    const recovered = receiptResults;
    receiptResults = [];
    for (const result of recovered) {
      const known = checked.get(result.observed.block.height);
      if (
        result.generation !== branchGeneration ||
        !tracked.has(result.transactionId) ||
        result.observed.block.height > latestBlock.height ||
        (known !== undefined && known.block.hash !== result.observed.block.hash)
      )
        continue;
      retainProof({ ...result.observed, transactionIds: [result.transactionId] });
    }
    for (const entry of checked.values())
      if (entry.transactionIds?.some((id) => tracked.has(id)))
        retainProof({ ...entry, transactionIds: entry.transactionIds });

    const pendingParsed = ethereumFullBlockSchema.safeParse(pendingResult.value);
    const pending = pendingParsed.success ? pendingParsed.data : null;
    const confirmedIds = new Set(latestObserved.transactionIds);
    for (const entry of checked.values())
      entry.transactionIds?.forEach((id) => confirmedIds.add(id));
    for (const inclusion of journal.values()) {
      inclusion.transactionIds.forEach((id) => confirmedIds.add(id));
    }
    // Some providers resolve the "pending" tag to the latest confirmed block.
    let hasCandidates =
      pending !== null &&
      projectionBaseFeeWei !== null &&
      pending.parentHash?.toLowerCase() === latestBlock.hash &&
      (pending.hash === null || pending.hash.toLowerCase() !== latestBlock.hash) &&
      pending.number !== null &&
      BigInt(pending.number) === BigInt(latest.number!) + 1n &&
      pending.baseFeePerGas !== undefined &&
      BigInt(pending.baseFeePerGas) === projectionBaseFeeWei;
    const inconsistentPendingContext =
      pending !== null &&
      (pending.hash === null || pending.hash.toLowerCase() !== latestBlock.hash) &&
      !hasCandidates;
    let pendingTransactions: Tx[] = [];
    if (hasCandidates && pending !== null) {
      try {
        pendingTransactions = toTransactions(
          {
            ...pending,
            transactions: pending.transactions.filter(
              (tx) => !confirmedIds.has(tx.hash.toLowerCase()),
            ),
          },
          'pending',
          PENDING_SAMPLE_LIMIT,
        );
      } catch {
        // An unusable candidate block cannot invalidate a valid confirmed observation.
        hasCandidates = false;
      }
    }
    const pool = currentPool();
    let usingPool = false;
    if (pool !== null && projectionBaseFeeWei !== null) {
      try {
        const baseFeeWei = projectionBaseFeeWei;
        pendingTransactions = toTransactions(
          {
            ...latest,
            hash: null,
            baseFeePerGas: `0x${baseFeeWei.toString(16)}`,
            transactions: pool.pending.filter(
              (transaction) =>
                !confirmedIds.has(transaction.hash.toLowerCase()) &&
                effectiveGasPriceWei(transaction, baseFeeWei) >= baseFeeWei,
            ),
          },
          'pending',
          PENDING_SAMPLE_LIMIT,
        );
        usingPool = true;
        hasCandidates = true;
      } catch {
        // A malformed fee/resource never invalidates valid blocks or the pending-block fallback.
        invalidatePoolFlow();
        lastPool = null;
        poolFailure = 'invalid';
      }
    }
    // Insertion order is an LRU for bounded ID retention; disappearance is never a confirmation.
    for (const transaction of pendingTransactions) {
      tracked.delete(transaction.id);
      tracked.set(transaction.id, collectedAt);
      if (!firstTrackedAt.has(transaction.id)) firstTrackedAt.set(transaction.id, collectedAt);
      if (transaction.ethereum)
        dependencies.remember(
          {
            transactionId: transaction.id,
            from: transaction.ethereum.from,
            nonce: transaction.ethereum.nonce,
          },
          usingPool && pool ? pool.observedAt : collectedAt,
        );
    }
    const windowStart = Math.max(0, latestBlock.height - MAX_CATCHUP_BLOCKS + 1);
    let firstHeight =
      cursor === null ? (branchChanged ? windowStart : latestBlock.height) : cursor + 1;
    if (firstHeight < windowStart) {
      // Explicitly abandon an older gap instead of allocating or requesting unbounded history.
      firstHeight = windowStart;
      cursor = firstHeight - 1;
      skippedHistory = true;
    }
    const catchupHeights = Array.from(
      { length: Math.max(0, latestBlock.height - firstHeight + 1) },
      (_, index) => firstHeight + index,
    );
    const previousHeights = Array.from(
      { length: Math.min(MAX_BLOCKS - 1, latestBlock.height) },
      (_, index) => latestBlock.height - index - 1,
    );
    const neededHeights = [...new Set([...catchupHeights, ...previousHeights])].filter(
      (height) => height !== latestBlock.height && !checked.has(height),
    );
    // One parallel phase: every request keeps the existing 8 s / 2 MiB transport bounds.
    const previousResults = await Promise.all(
      neededHeights.map(async (height) => {
        try {
          const header = parsePayload(
            ethereumBlockHeaderSchema,
            await rpc(config, 'eth_getBlockByNumber', [`0x${height.toString(16)}`, false], fetcher),
          );
          const observed = observedBlock(header);
          if (observed.block.height !== height) throw new UpstreamError('invalid');
          return observed;
        } catch {
          return null;
        }
      }),
    );
    const received = new Map<number, ObservedEthereumBlock>([[latestBlock.height, latestObserved]]);
    const receivedHashes = new Set([latestBlock.hash]);
    let invalidHistory = false;
    for (const observed of previousResults) {
      if (observed === null) continue;
      if (
        receivedHashes.has(observed.block.hash) ||
        [...checked.values()].some(
          (entry) =>
            entry.block.height !== observed.block.height &&
            entry.block.hash === observed.block.hash,
        )
      ) {
        invalidHistory = true;
        continue;
      }
      receivedHashes.add(observed.block.hash);
      received.set(observed.block.height, observed);
    }
    let inconsistentBranch = false;
    for (const observed of received.values()) {
      const parent =
        received.get(observed.block.height - 1) ?? checked.get(observed.block.height - 1);
      if (
        observed.parentHash !== undefined &&
        parent !== undefined &&
        observed.parentHash !== parent.block.hash
      ) {
        inconsistentBranch = true;
        break;
      }
    }
    if (inconsistentBranch) {
      // The provider changed branch during collection. Replay no old-branch evidence and
      // retry the bounded height window; the independently validated latest block remains usable.
      resetBranch();
      branchChanged = true;
      cursor = windowStart - 1;
      received.clear();
      received.set(latestBlock.height, latestObserved);
    }
    for (const observed of received.values()) {
      checked.set(observed.block.height, {
        block: observed.block,
        parentHash: observed.parentHash,
        transactionIds: observed.transactionIds,
      });
    }
    // Also reconcile late/stale candidates against independently verified recent history.
    const proofHeights = new Set([...catchupHeights, latestBlock.height]);
    for (const observed of received.values()) {
      if (
        proofHeights.has(observed.block.height) ||
        observed.transactionIds.some((id) => tracked.has(id))
      )
        retainProof(observed);
    }
    // Verify retained IDs before current arrivals can evict them. The transient map
    // holds retained IDs plus PENDING_SAMPLE_LIMIT arrivals, then returns to the retained cap.
    while (tracked.size > MAX_TRACKED_TRANSACTIONS) {
      const oldest = tracked.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      tracked.delete(oldest);
    }
    dependencies.prune(tracked);
    const dependencyPool =
      usingPool &&
      pool &&
      pool.parentBlockHash === latestBlock.hash &&
      pool.height === latestBlock.height + 1 &&
      pool.generation === branchGeneration
        ? pool
        : null;
    if (dependencyPool) {
      const currentIds = pendingTransactions.map((transaction) => transaction.id);
      const parents = dependencies.parentObservations(
        new Set([...currentIds, ...tracked.keys()]),
        tracked,
        dependencyPool,
        dependencyMetadata(latest.transactions),
        collectedAt,
      );
      const preferred = new Set(currentIds);
      for (const parent of parents)
        if (preferred.size < MAX_TRACKED_TRANSACTIONS) preferred.add(parent.metadata.transactionId);
      for (const id of [...tracked.keys()].reverse())
        if (preferred.size < MAX_TRACKED_TRANSACTIONS) preferred.add(id);
      // Reserve the shared budget before adding parent IDs: the existing temporary
      // bound remains MAX_TRACKED_TRANSACTIONS retained + PENDING_SAMPLE_LIMIT
      // arrivals, never another parent cohort.
      for (const id of tracked.keys()) if (!preferred.has(id)) tracked.delete(id);
      dependencies.prune(tracked);
      const addedParents = new Set<string>();
      for (const parent of parents) {
        const id = parent.metadata.transactionId;
        if (!preferred.has(id)) continue;
        const previous = tracked.get(id);
        if (previous === undefined) addedParents.add(id);
        if (previous === undefined || parent.observedAt > previous) {
          tracked.delete(id);
          tracked.set(id, parent.observedAt);
        }
        dependencies.remember(parent.metadata, parent.observedAt);
      }
      // Reuse checked canonical contents for parents newly admitted to the same
      // watch budget. No receipt, account nonce query or additional block read.
      if (addedParents.size)
        for (const entry of checked.values())
          if (entry.transactionIds?.some((id) => addedParents.has(id)))
            retainProof({ ...entry, transactionIds: entry.transactionIds });
    }
    dependencies.prune(tracked);
    if (!inconsistentBranch) {
      for (const height of catchupHeights) {
        if (!checked.has(height)) break;
        cursor = height;
      }
    }
    lastHead = latestBlock;
    // Header metadata and inclusion replay have independent fixed retention bounds.
    const checkedHeights = [...checked.keys()].sort((left, right) => right - left);
    checkedHeights.slice(MAX_INCLUSION_BLOCKS).forEach((height) => checked.delete(height));
    retainRecentBlockIds();
    discardUntrackedReceiptState();
    const inclusions = boundedJournal(latestBlock);
    const newlyConfirmedIds = new Set(inclusions.flatMap((entry) => entry.transactionIds));
    pendingTransactions = pendingTransactions.filter(
      (transaction) => !newlyConfirmedIds.has(transaction.id),
    );
    scheduleReceiptRefresh(latestBlock, new Set(pendingTransactions.map((tx) => tx.id)));
    const transactions = [...pendingTransactions, ...confirmedTransactions].slice(
      0,
      MAX_TRANSACTIONS,
    );
    const blocks = [
      latestBlock,
      ...previousHeights.flatMap((height) => {
        const previous = checked.get(height);
        return previous === undefined ? [] : [previous.block];
      }),
    ];
    const candidateCoverage =
      usingPool && pool !== null
        ? `Top ${PENDING_SAMPLE_LIMIT} maximum du pending local couvrant la base fee calculée du prochain bloc : ${pool.pendingCount} pending reçues, ${pool.queuedCount} queued exclues via txpool_content. Prix effectif exact avant limitation ; collecte ≤30 s. Aucun classement mondial.`
        : hasCandidates
          ? `Jusqu’à ${PENDING_SAMPLE_LIMIT} candidats aux meilleurs prix de gas effectifs du bloc pending fourni, ancré au parent et à la base fee calculée, classés avant limitation. Ce repli n’est pas le top du mempool.`
          : 'Transactions confirmées du dernier bloc ; aucun candidat distinct exploitable.';
    const poolAttempt = usingPool
      ? ''
      : poolFailure === 'rpc'
        ? ' txpool_content refusé par le fournisseur ; nouvel essai dans 5 min.'
        : poolFailure === 'too-large'
          ? ' txpool_content dépasse les bornes ; réponse entière écartée.'
          : poolFailure === 'invalid'
            ? ' txpool_content inexploitable ; réponse entière écartée.'
            : poolFailure === 'timeout' || poolFailure === 'unavailable'
              ? ' txpool_content temporairement indisponible.'
              : ' Collecte txpool_content en cours ou expirée.';
    const mempool = currentMempool();
    const mempoolCoverage =
      mempool === null
        ? 'Comptage du mempool local du fournisseur indisponible.'
        : `Mempool local du fournisseur : pending + queued via txpool_status, collecte séparée (~30 s)${mempool.status === 'stale' ? ', dernière valeur conservée' : ''}.`;
    const partialHistory = blocks.length < previousHeights.length + 1 || invalidHistory;
    const incompleteCatchup = cursor === null || cursor < latestBlock.height;
    return parsePayload(snapshotSchema, {
      chain: 'ethereum',
      mode: 'live',
      status: 'ok',
      source: config.ethereumSource,
      observedAt: now(),
      coverage: `${candidateCoverage} ${mempoolCoverage} Taille des blocs en gas ; passagers = limite de gas déclarée. Suivi : ${MAX_TRACKED_TRANSACTIONS} IDs/30 min, journal de 16 blocs, rattrapage de 8 blocs et reçus ciblés en arrière-plan.`,
      pendingCount: mempool === null ? null : mempool.pending + mempool.queued,
      mempool,
      poolFlow:
        pool !== null &&
        poolFlowContext?.observedAt === pool.observedAt &&
        poolFlowContext.generation === branchGeneration &&
        poolFlowContext.epoch === poolFlowEpoch
          ? poolFlow.forSample(new Set(pendingTransactions.map((tx) => tx.id)), pool.observedAt)
          : null,
      sampling:
        usingPool && pool !== null
          ? {
              method: 'txpool_content',
              source: config.ethereumSource,
              observedAt: pool.observedAt,
              pendingCount: pool.pendingCount,
              queuedCount: pool.queuedCount,
            }
          : null,
      poolObservation:
        usingPool && pool !== null
          ? {
              source: config.ethereumSource,
              method: 'txpool_content',
              observedAt: pool.observedAt,
              presentTransactionIds: [...tracked.keys()].filter((id) => pool.pendingIds.has(id)),
              queuedTransactionIds: [...tracked.keys()].filter((id) => pool.queuedIds.has(id)),
              absentTransactionIds: [...tracked.keys()].filter(
                (id) => !pool.pendingIds.has(id) && !pool.queuedIds.has(id),
              ),
            }
          : null,
      ethereumProjection:
        projectionBaseFeeWei === null
          ? null
          : {
              parentBlockHash: latestBlock.hash,
              height: latestBlock.height + 1,
              baseFeePerGasWei: projectionBaseFeeWei.toString(),
              source: hasCandidates && !usingPool ? 'pending' : 'calculated',
              observedAt: collectedAt,
            },
      ethereumDependencies: dependencyPool
        ? dependencies.build(
            tracked,
            dependencyPool,
            inclusions,
            config.ethereumSource,
            latestBlock.hash,
            latestBlock.height + 1,
            collectedAt,
          )
        : null,
      latestBlockValue,
      feeRate:
        latest.baseFeePerGas === undefined
          ? null
          : ratioToNumber(BigInt(latest.baseFeePerGas), 1_000_000_000n),
      feeUnit: 'Gwei',
      transactions,
      blocks,
      inclusions,
      // Even all warnings together remain below the contract's 700-character bound.
      message: `Indicateur de frais : base fee du dernier bloc, sans pourboire.${projectionBaseFeeWei === null ? ' Base fee du parent non fournie : référence du prochain bloc indisponible.' : ' La projection utilise la base fee du prochain bloc calculée depuis ce parent.'}${inconsistentPendingContext ? ' Candidat pending non rattaché au parent, à la hauteur suivante ou à la base fee calculée : ignoré.' : ''}${poolAttempt}${partialHistory ? ' Certains blocs précédents sont temporairement indisponibles.' : ''}${incompleteCatchup ? ' Vérification d’inclusions incomplète ; les hauteurs manquantes seront retentées sans présumer de confirmation.' : ''}${skippedHistory ? ' Une interruption a dépassé la fenêtre : certains blocs plus anciens n’ont pas été vérifiés.' : ''}${branchChanged ? ' Modification de branche observée : journal précédent réinitialisé, sans garantie de finalité.' : ''}`,
    });
  };
  return async () => {
    try {
      return await collect();
    } catch (error) {
      // Do not bridge a required chain-read failure, including a request still in flight.
      invalidatePoolFlow();
      throw error;
    }
  };
}

/** Stateless compatibility entry point; the service uses createEthereumProvider instead. */
export async function fetchEthereumSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): Promise<Snapshot> {
  return createEthereumProvider(config, fetcher, now)();
}
