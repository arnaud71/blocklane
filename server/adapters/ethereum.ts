import { z } from 'zod';
import {
  MAX_BLOCKS,
  MAX_TRANSACTIONS,
  snapshotSchema,
  type Block,
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
  );
type EthereumBlock = z.infer<typeof ethereumFullBlockSchema>;
type EthereumBlockHeader = z.infer<typeof ethereumBlockHeaderSchema>;
const PENDING_FEE_SAMPLE_LIMIT = 96;

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
  method: 'eth_chainId' | 'eth_getBlockByNumber',
  params: unknown[],
  fetcher?: Fetcher,
): Promise<unknown> {
  nextRpcId = (nextRpcId % 1_000_000_000) + 1;
  const id = nextRpcId;
  const raw = await requestJson(config.ethereumRpcUrl, {
    ...(fetcher === undefined ? {} : { fetcher }),
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
  return {
    height: bigintToSafeNumber(BigInt(block.number)),
    hash: block.hash.toLowerCase(),
    timestamp: bigintToSafeNumber(BigInt(block.timestamp)),
    txCount: block.transactions.length,
    used: bigintToSafeNumber(BigInt(block.gasUsed)),
    capacity: bigintToSafeNumber(BigInt(block.gasLimit)),
  };
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

export async function fetchEthereumSnapshot(
  config: ServerConfig,
  fetcher?: Fetcher,
  now: () => number = Date.now,
): Promise<Snapshot> {
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
  const latestBlock = toBlock(latest);
  const pendingParsed = ethereumFullBlockSchema.safeParse(pendingResult.value);
  const pending = pendingParsed.success ? pendingParsed.data : null;
  // Proven inclusions take precedence over an inconsistent provider candidate,
  // before ranking/truncation so they cannot consume a pending sample slot.
  const confirmedIds = new Set(latest.transactions.map((tx) => tx.hash.toLowerCase()));
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
        PENDING_FEE_SAMPLE_LIMIT,
      );
    } catch {
      // An unusable candidate block cannot invalidate a valid confirmed observation.
      hasCandidates = false;
    }
  }
  const confirmedTransactions = toTransactions(latest, 'confirmed', MAX_TRANSACTIONS);
  const transactions = [...pendingTransactions, ...confirmedTransactions].slice(
    0,
    MAX_TRANSACTIONS,
  );

  const previousHeights = Array.from(
    { length: Math.min(MAX_BLOCKS - 1, latestBlock.height) },
    (_, index) => latestBlock.height - index - 1,
  );
  const previousResults = await Promise.all(
    previousHeights.map(async (height) => {
      try {
        const header = parsePayload(
          ethereumBlockHeaderSchema,
          await rpc(config, 'eth_getBlockByNumber', [`0x${height.toString(16)}`, false], fetcher),
        );
        const block = toBlock(header);
        if (block.height !== height) throw new UpstreamError('invalid');
        return block;
      } catch {
        return null;
      }
    }),
  );
  const blocks = [
    latestBlock,
    ...previousResults.filter((block): block is Block => block !== null),
  ];
  const candidateCoverage = hasCandidates
    ? 'Jusqu’à 96 transactions candidates sélectionnées aux meilleurs prix de gas effectifs dans le bloc pending du fournisseur, classées avant limitation, et confirmations du dernier bloc. Ce classement du fournisseur ne représente pas un top du mempool global.'
    : 'Transactions confirmées du dernier bloc. Ce fournisseur ne fournit pas de bloc candidat distinct et aucun comptage du mempool global n’est disponible.';
  const partialHistory = blocks.length < previousHeights.length + 1;
  return parsePayload(snapshotSchema, {
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: config.ethereumSource,
    observedAt: now(),
    coverage: `${candidateCoverage} Taille des blocs en gas ; taille des passagers = limite de gas déclarée.`,
    pendingCount: null,
    feeRate:
      latest.baseFeePerGas === undefined
        ? null
        : ratioToNumber(BigInt(latest.baseFeePerGas), 1_000_000_000n),
    feeUnit: 'Gwei',
    transactions,
    blocks,
    message: `Indicateur de frais : base fee du dernier bloc, sans pourboire.${partialHistory ? ' Certains blocs précédents sont temporairement indisponibles.' : ''}`,
  });
}
