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
  bigintToSafeNumber,
  parsePayload,
  ratioToNumber,
  requestJson,
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
  method: 'eth_chainId' | 'eth_getBlockByNumber' | 'txpool_status',
  params: unknown[],
  fetcher?: Fetcher,
): Promise<unknown> {
  nextRpcId = (nextRpcId % 1_000_000_000) + 1;
  const id = nextRpcId;
  const raw = await requestJson(config.ethereumRpcUrl, {
    ...(fetcher === undefined ? {} : { fetcher }),
    ...(method === 'txpool_status' ? { maxBytes: 64 * 1_024 } : {}),
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
  const checked = new Map<number, CheckedEthereumBlock>();
  const journal = new Map<number, BlockInclusions>();
  let lastHead: Block | null = null;
  let cursor: number | null = null;
  let skippedHistory = false;
  let lastMempool: EthereumMempool | null = null;
  let mempoolRefreshFailed = false;
  let mempoolNextRefreshAt = 0;
  let mempoolInFlight: Promise<void> | null = null;

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

  function resetBranch(): void {
    checked.clear();
    journal.clear();
    cursor = null;
  }

  function retainProof(observed: ObservedEthereumBlock): void {
    const previous = journal.get(observed.block.height);
    const identifiers = new Set(
      previous?.block.hash === observed.block.hash ? previous.transactionIds : [],
    );
    observed.transactionIds.forEach((id) => {
      if (tracked.has(id)) identifiers.add(id);
    });
    journal.set(observed.block.height, {
      block: observed.block,
      transactionIds: [...identifiers],
    });
  }

  function boundedJournal(): BlockInclusions[] {
    const entries = [...journal.values()].sort(
      (left, right) => right.block.height - left.block.height,
    );
    journal.clear();
    let remaining = MAX_TRACKED_TRANSACTIONS;
    const seen = new Set<string>();
    for (const entry of entries.slice(0, MAX_INCLUSION_BLOCKS)) {
      const transactionIds = entry.transactionIds.filter((id) => {
        if (remaining === 0 || seen.has(id)) return false;
        seen.add(id);
        remaining -= 1;
        return true;
      });
      journal.set(entry.block.height, { block: entry.block, transactionIds });
    }
    return [...journal.values()];
  }

  return async () => {
    const [chainIdRaw, latestRaw, pendingResult] = await Promise.all([
      rpc(config, 'eth_chainId', [], fetcher),
      rpc(config, 'eth_getBlockByNumber', ['latest', true], fetcher),
      rpc(config, 'eth_getBlockByNumber', ['pending', true], fetcher).then(
        (value) => ({ value, failed: false }),
        () => ({ value: null, failed: true }),
      ),
    ]);
    const chainId = parsePayload(hexQuantitySchema, chainIdRaw);
    if (BigInt(chainId) !== 1n) throw new UpstreamError('wrong-chain');
    const latest = parsePayload(ethereumFullBlockSchema, latestRaw);
    const latestObserved = observedBlock(latest);
    const latestBlock = latestObserved.block;
    if (
      [...checked.values()].some(
        (entry) =>
          entry.block.height !== latestBlock.height && entry.block.hash === latestBlock.hash,
      )
    ) {
      throw new UpstreamError('invalid');
    }
    // Validate the complete required latest observation before mutating tracker state.
    const confirmedTransactions = toTransactions(latest, 'confirmed', CONFIRMED_SAMPLE_LIMIT);
    // Background refresh on the same fixed, chain-verified RPC; never await this optional call.
    scheduleMempoolRefresh();
    const collectedAt = now();
    const latestBlockValue = latestEthereumBlockValue(latest, latestBlock, collectedAt);
    for (const [id, lastObservedAt] of tracked) {
      if (collectedAt - lastObservedAt >= TRACKED_TRANSACTION_TTL_MS) tracked.delete(id);
    }

    const knownAtHeight = checked.get(latestBlock.height)?.block;
    const knownParent = checked.get(latestBlock.height - 1)?.block;
    let branchChanged =
      (lastHead !== null && latestBlock.height < lastHead.height) ||
      (knownAtHeight !== undefined && knownAtHeight.hash !== latestBlock.hash) ||
      (latestObserved.parentHash !== undefined &&
        knownParent !== undefined &&
        latestObserved.parentHash !== knownParent.hash);
    if (branchChanged) resetBranch();

    const pendingParsed = ethereumFullBlockSchema.safeParse(pendingResult.value);
    const pending = pendingParsed.success ? pendingParsed.data : null;
    const confirmedIds = new Set(latestObserved.transactionIds);
    for (const inclusion of journal.values()) {
      inclusion.transactionIds.forEach((id) => confirmedIds.add(id));
    }
    // Some providers resolve the "pending" tag to the latest confirmed block.
    let hasCandidates =
      pending !== null &&
      (pending.hash === null || pending.hash.toLowerCase() !== latestBlock.hash) &&
      (pending.number === null || BigInt(pending.number) > BigInt(latest.number!));
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
    // Insertion order is an LRU for bounded ID retention; disappearance is never a confirmation.
    for (const transaction of pendingTransactions) {
      tracked.delete(transaction.id);
      tracked.set(transaction.id, collectedAt);
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
      });
    }
    // Only the current head is checked on the first collection, not pre-observation history.
    const proofHeights = new Set([...catchupHeights, latestBlock.height]);
    for (const height of proofHeights) {
      const observed = received.get(height);
      if (observed !== undefined) retainProof(observed);
    }
    // Verify retained IDs before current arrivals can evict them. The transient map
    // holds retained IDs plus PENDING_SAMPLE_LIMIT arrivals, then returns to the retained cap.
    while (tracked.size > MAX_TRACKED_TRANSACTIONS) {
      const oldest = tracked.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      tracked.delete(oldest);
    }
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
    const inclusions = boundedJournal();
    const newlyConfirmedIds = new Set(inclusions.flatMap((entry) => entry.transactionIds));
    pendingTransactions = pendingTransactions.filter(
      (transaction) => !newlyConfirmedIds.has(transaction.id),
    );
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
    const candidateCoverage = hasCandidates
      ? `Jusqu’à ${PENDING_SAMPLE_LIMIT} transactions candidates aux meilleurs prix de gas effectifs du bloc pending du fournisseur, classées avant limitation, et confirmations du dernier bloc. Ce classement ne représente pas un top du mempool global.`
      : 'Transactions confirmées du dernier bloc. Aucun candidat distinct exploitable fourni.';
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
      coverage: `${candidateCoverage} ${mempoolCoverage} Taille des blocs en gas ; passagers = limite de gas déclarée. Suivi borné à 2 048 IDs observés pendant 30 min, journal de 16 blocs ; rattrapage de 8 blocs au maximum.`,
      pendingCount: mempool === null ? null : mempool.pending + mempool.queued,
      mempool,
      latestBlockValue,
      feeRate:
        latest.baseFeePerGas === undefined
          ? null
          : ratioToNumber(BigInt(latest.baseFeePerGas), 1_000_000_000n),
      feeUnit: 'Gwei',
      transactions,
      blocks,
      inclusions,
      message: `Indicateur de frais : base fee du dernier bloc, sans pourboire.${partialHistory ? ' Certains blocs précédents sont temporairement indisponibles.' : ''}${incompleteCatchup ? ' Vérification d’inclusions incomplète ; les hauteurs manquantes seront retentées sans présumer de confirmation.' : ''}${skippedHistory ? ' Une interruption a dépassé la fenêtre : certains blocs plus anciens n’ont pas été vérifiés.' : ''}${branchChanged ? ' Modification de branche observée : journal précédent réinitialisé, sans garantie de finalité.' : ''}`,
    });
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
