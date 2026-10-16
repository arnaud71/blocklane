import { z } from 'zod';

export const chainIdSchema = z.enum(['bitcoin', 'ethereum']);
export type ChainId = z.infer<typeof chainIdSchema>;

export const PENDING_SAMPLE_LIMIT = 1_920;
/** Reserved within the pending sample for actual, detailed Bitcoin stream arrivals. */
export const BITCOIN_ARRIVAL_SAMPLE_LIMIT = 384;
export const BITCOIN_ARRIVALS_MAX_AGE_MS = 60_000;
/** Retained individuals have their own fixed budget, independent of the current sample. */
export const MAX_INDIVIDUAL_HISTORY = 1_920;
export const CONFIRMED_SAMPLE_LIMIT = 24;
export const MAX_TRANSACTIONS = PENDING_SAMPLE_LIMIT + CONFIRMED_SAMPLE_LIMIT;
export const MAX_BLOCKS = 3;
export const MAX_TRACKED_TRANSACTIONS = 4_096;
export const TRACKED_TRANSACTION_TTL_MS = 30 * 60 * 1_000;
export const MAX_INCLUSION_BLOCKS = 16;
export const MAX_CATCHUP_BLOCKS = 8;
export const MAX_POOL_FLOW_POINTS = 12;
export const POOL_FLOW_WINDOW_MS = 60_000;
export const POOL_FLOW_MAX_INTERVAL_MS = 90_000;
export const POOL_FLOW_MAX_AGE_MS = 90_000;
export const EVENT_FLOW_PUBLISH_MS = 3_000;
export const MAX_EVENT_FLOW_INTERVAL_MS = 15_000;
export const EVENT_FLOW_MAX_AGE_MS = 15_000;
export const EVENT_FLOW_SILENCE_MS = 30_000;
export const EVENT_FLOW_WINDOW_MS = 60_000;
export const MAX_EVENT_FLOW_POINTS = 12;
export const MAX_EVENT_FLOW_IDS = 20_000;

const finiteNonnegative = z.number().finite().nonnegative();
const safeNonnegativeInteger = z.number().int().nonnegative().safe();
const canonicalIdentifier = z
  .string()
  .min(1)
  .max(128)
  .transform((value) => (/^(?:0x)?[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : value));
const exactUint256 = z
  .string()
  .max(78)
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .refine((value) => value.length <= 78 && /^[0-9]+$/.test(value) && BigInt(value) < 1n << 256n, {
    message: 'Quantity exceeds an unsigned 256-bit integer',
  });

/** Bounded presence evidence for tracked IDs, independent of the animated sample. */
export const poolObservationSchema = z
  .object({
    source: z.string().min(1).max(100),
    method: z.enum(['getrawmempool', 'txpool_content']),
    observedAt: safeNonnegativeInteger,
    presentTransactionIds: z.array(canonicalIdentifier).max(MAX_TRACKED_TRANSACTIONS),
    queuedTransactionIds: z.array(canonicalIdentifier).max(MAX_TRACKED_TRANSACTIONS),
    absentTransactionIds: z.array(canonicalIdentifier).max(MAX_TRACKED_TRANSACTIONS),
  })
  .superRefine((observation, context) => {
    const ids = [
      ...observation.presentTransactionIds,
      ...observation.queuedTransactionIds,
      ...observation.absentTransactionIds,
    ];
    if (ids.length > MAX_TRACKED_TRANSACTIONS || new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Pool presence identifiers must be disjoint, unique and bounded',
      });
    }
    if (observation.method === 'getrawmempool' && observation.queuedTransactionIds.length) {
      context.addIssue({ code: 'custom', message: 'Bitcoin has no Ethereum queued category' });
    }
  });
export type PoolObservation = z.infer<typeof poolObservationSchema>;

/** Set differences between complete, dated inventories; not net pool growth or a global stream. */
export const poolFlowPointSchema = z
  .object({
    fromObservedAt: safeNonnegativeInteger,
    observedAt: safeNonnegativeInteger,
    previousCount: safeNonnegativeInteger.max(100_000),
    currentCount: safeNonnegativeInteger.max(100_000),
    enteredCount: safeNonnegativeInteger.max(100_000),
    disappearedCount: safeNonnegativeInteger.max(100_000),
    /** Entries outside the pending sample at first publication; never recomputed on later polls. */
    outsideSampleEnteredCount: safeNonnegativeInteger.max(100_000).nullable(),
  })
  .superRefine((point, context) => {
    if (
      point.observedAt <= point.fromObservedAt ||
      point.observedAt - point.fromObservedAt > POOL_FLOW_MAX_INTERVAL_MS ||
      point.enteredCount > point.currentCount ||
      point.disappearedCount > point.previousCount ||
      point.currentCount !== point.previousCount + point.enteredCount - point.disappearedCount ||
      (point.outsideSampleEnteredCount !== null &&
        point.outsideSampleEnteredCount > point.enteredCount)
    ) {
      context.addIssue({ code: 'custom', message: 'Inconsistent inventory flow interval' });
    }
  });
export type PoolFlowPoint = z.infer<typeof poolFlowPointSchema>;

export const poolFlowSchema = z
  .object({
    source: z.string().min(1).max(100),
    method: z.enum(['getrawmempool', 'txpool_content']),
    observedAt: safeNonnegativeInteger,
    inventoryCount: safeNonnegativeInteger.max(100_000),
    state: z.enum(['warming', 'ready']),
    history: z.array(poolFlowPointSchema).max(MAX_POOL_FLOW_POINTS),
  })
  .superRefine((flow, context) => {
    const latest = flow.history.at(-1);
    if (
      (flow.state === 'warming') !== (flow.history.length === 0) ||
      (latest &&
        (latest.observedAt !== flow.observedAt || latest.currentCount !== flow.inventoryCount)) ||
      flow.history.some(
        (point, index) =>
          point.observedAt <= flow.observedAt - POOL_FLOW_WINDOW_MS ||
          (index > 0 &&
            (point.fromObservedAt !== flow.history[index - 1]!.observedAt ||
              point.previousCount !== flow.history[index - 1]!.currentCount)),
      ) ||
      (flow.method === 'txpool_content' &&
        (flow.inventoryCount > 50_000 ||
          flow.history.some(
            (point) => point.previousCount > 50_000 || point.currentCount > 50_000,
          )))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Flow history must describe a bounded dated inventory',
      });
    }
  });
export type PoolFlow = z.infer<typeof poolFlowSchema>;

/** Notifications observed over one uninterrupted connection, never a complete pool inventory. */
export const eventFlowPointSchema = z
  .object({
    fromObservedAt: safeNonnegativeInteger,
    observedAt: safeNonnegativeInteger,
    enteredCount: safeNonnegativeInteger.max(MAX_EVENT_FLOW_IDS),
    outsideSampleEnteredCount: safeNonnegativeInteger.max(MAX_EVENT_FLOW_IDS).nullable(),
  })
  .superRefine((point, context) => {
    if (
      point.observedAt - point.fromObservedAt < EVENT_FLOW_PUBLISH_MS ||
      point.observedAt - point.fromObservedAt > MAX_EVENT_FLOW_INTERVAL_MS ||
      (point.outsideSampleEnteredCount !== null &&
        point.outsideSampleEnteredCount > point.enteredCount)
    )
      context.addIssue({ code: 'custom', message: 'Invalid event observation interval' });
  });
export type EventFlowPoint = z.infer<typeof eventFlowPointSchema>;

export const eventFlowSchema = z
  .object({
    source: z.string().min(1).max(100),
    method: z.enum(['mempool-txids', 'mempool-transactions', 'newPendingTransactions']),
    state: z.enum(['disabled', 'connecting', 'warming', 'live', 'interrupted', 'limited']),
    epoch: safeNonnegativeInteger,
    startedAt: safeNonnegativeInteger.nullable(),
    /** Time of the last published interval or state change, never an HTTP cache-read timestamp. */
    observedAt: safeNonnegativeInteger,
    /** Last validated frame receipt; a heartbeat does not count as a transaction. */
    lastMessageAt: safeNonnegativeInteger.nullable(),
    history: z.array(eventFlowPointSchema).max(MAX_EVENT_FLOW_POINTS),
  })
  .superRefine((flow, context) => {
    const active = flow.state === 'live' || flow.state === 'warming';
    if (
      (active && (flow.startedAt === null || flow.lastMessageAt === null || flow.epoch === 0)) ||
      (flow.state === 'live' && flow.history.length === 0) ||
      (flow.startedAt !== null && flow.startedAt > flow.observedAt) ||
      (flow.history.length > 0 && flow.history.at(-1)!.observedAt !== flow.observedAt) ||
      flow.history.some(
        (point, index) =>
          point.observedAt <= flow.observedAt - EVENT_FLOW_WINDOW_MS ||
          (flow.startedAt !== null && point.fromObservedAt < flow.startedAt) ||
          (index > 0 && point.fromObservedAt !== flow.history[index - 1]!.observedAt),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Event flow must retain its connection coverage and dated history',
      });
  });
export type EventFlow = z.infer<typeof eventFlowSchema>;

/** Presence in one provider's continuous stream; neither a pool inventory nor inclusion proof. */
export const bitcoinArrivalsSchema = z.object({
  source: z.string().min(1).max(100),
  method: z.literal('mempool-transactions'),
  observedAt: safeNonnegativeInteger,
  transactionIds: z
    .array(
      z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .transform((id) => id.toLowerCase()),
    )
    .max(BITCOIN_ARRIVAL_SAMPLE_LIMIT),
});
export type BitcoinArrivals = z.infer<typeof bitcoinArrivalsSchema>;

export const ethereumProjectionSchema = z.object({
  parentBlockHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .transform((value) => value.toLowerCase()),
  height: safeNonnegativeInteger,
  baseFeePerGasWei: exactUint256,
  source: z.enum(['calculated', 'pending']),
  observedAt: safeNonnegativeInteger,
});
export type EthereumProjection = z.infer<typeof ethereumProjectionSchema>;

const ethereumDependencyIdentifier = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .transform((value) => value.toLowerCase());
const ethereumPredecessorFields = {
  nonce: exactUint256,
  transactionId: ethereumDependencyIdentifier,
};
export const ethereumPredecessorSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('root') }),
  z.object({ state: z.literal('unobserved'), nonce: exactUint256 }),
  z.object({ state: z.literal('gap'), nonce: exactUint256 }),
  z.object({
    state: z.literal('unknown'),
    nonce: exactUint256,
    transactionId: ethereumDependencyIdentifier.optional(),
  }),
  z.object({ state: z.literal('pending'), ...ethereumPredecessorFields }),
  z.object({ state: z.literal('queued'), ...ethereumPredecessorFields }),
  z.object({
    state: z.literal('confirmed'),
    ...ethereumPredecessorFields,
    blockHash: ethereumDependencyIdentifier,
    blockHeight: safeNonnegativeInteger,
  }),
]);
export type EthereumPredecessor = z.infer<typeof ethereumPredecessorSchema>;

export const ethereumDependencySchema = z
  .object({
    transactionId: ethereumDependencyIdentifier,
    from: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => value.toLowerCase()),
    nonce: exactUint256,
    predecessor: ethereumPredecessorSchema,
  })
  .superRefine((dependency, context) => {
    if (dependency.nonce.length > 78 || !/^[0-9]+$/.test(dependency.nonce)) return;
    const nonce = BigInt(dependency.nonce);
    const predecessor = dependency.predecessor;
    const valid =
      predecessor.state === 'root'
        ? nonce === 0n
        : predecessor.nonce.length <= 78 &&
          /^[0-9]+$/.test(predecessor.nonce) &&
          nonce > 0n &&
          BigInt(predecessor.nonce) === nonce - 1n;
    if (
      !valid ||
      ('transactionId' in predecessor && predecessor.transactionId === dependency.transactionId)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'An Ethereum dependency must describe the immediate preceding nonce or nonce-zero root',
      });
    }
  });
export type EthereumDependency = z.infer<typeof ethereumDependencySchema>;

/** Dated, bounded account/nonce constraints; neither an account state query nor inclusion by inference. */
export const ethereumDependenciesSchema = z
  .object({
    source: z.string().min(1).max(100),
    observedAt: safeNonnegativeInteger,
    parentBlockHash: ethereumDependencyIdentifier,
    height: safeNonnegativeInteger,
    entries: z.array(ethereumDependencySchema).max(MAX_TRACKED_TRANSACTIONS),
  })
  .superRefine((dependencies, context) => {
    const children = dependencies.entries.map((entry) => entry.transactionId);
    const allIds = new Set(children);
    for (const entry of dependencies.entries)
      if ('transactionId' in entry.predecessor && entry.predecessor.transactionId)
        allIds.add(entry.predecessor.transactionId);
    if (new Set(children).size !== children.length || allIds.size > MAX_TRACKED_TRANSACTIONS) {
      context.addIssue({
        code: 'custom',
        message:
          'Ethereum dependency children must be unique and share one bounded identifier budget with their parents',
      });
    }
  });
export type EthereumDependencies = z.infer<typeof ethereumDependenciesSchema>;

export const ethereumTransactionSchema = z
  .object({
    from: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => value.toLowerCase()),
    nonce: exactUint256,
    gasPriceWei: exactUint256.optional(),
    maxFeePerGasWei: exactUint256.optional(),
    maxPriorityFeePerGasWei: exactUint256.optional(),
  })
  .superRefine((transaction, context) => {
    const hasCap = transaction.maxFeePerGasWei !== undefined;
    const hasTip = transaction.maxPriorityFeePerGasWei !== undefined;
    if (
      hasCap !== hasTip ||
      (!hasCap && transaction.gasPriceWei === undefined) ||
      (hasCap &&
        transaction.maxPriorityFeePerGasWei!.length <= 78 &&
        transaction.maxFeePerGasWei!.length <= 78 &&
        /^[0-9]+$/.test(transaction.maxPriorityFeePerGasWei!) &&
        /^[0-9]+$/.test(transaction.maxFeePerGasWei!) &&
        BigInt(transaction.maxPriorityFeePerGasWei!) > BigInt(transaction.maxFeePerGasWei!))
    ) {
      context.addIssue({ code: 'custom', message: 'Incomplete or inconsistent Ethereum fee caps' });
    }
  });

export const usdQuoteSchema = z.object({
  usdPerCoin: z.number().finite().positive().max(1_000_000_000),
  /** Receipt time in Unix milliseconds; this is not the time of a market trade. */
  observedAt: safeNonnegativeInteger,
  source: z.literal('Coinbase'),
  status: z.enum(['ok', 'stale']),
});
export type UsdQuote = z.infer<typeof usdQuoteSchema>;

/** Counts from the observed Ethereum provider's local pool, never a global total. */
export const ethereumMempoolSchema = z
  .object({
    pending: safeNonnegativeInteger,
    queued: safeNonnegativeInteger,
    /** Receipt time in Unix milliseconds, independent of the block observation. */
    observedAt: safeNonnegativeInteger,
    status: z.enum(['ok', 'stale']),
    method: z.literal('txpool_status'),
  })
  .refine((pool) => Number.isSafeInteger(pool.pending + pool.queued), {
    message: 'The local transaction pool total exceeds the safe integer limit',
  });
export type EthereumMempool = z.infer<typeof ethereumMempoolSchema>;

const samplingFields = {
  source: z.string().min(1).max(100),
  observedAt: safeNonnegativeInteger,
};

/** Only populated after a complete bounded pool or ID reconciliation has been validated. */
export const samplingSchema = z.discriminatedUnion('method', [
  z.object({
    ...samplingFields,
    method: z.literal('getrawmempool'),
    update: z.enum(['full', 'incremental']),
    pendingCount: safeNonnegativeInteger.max(100_000),
  }),
  z
    .object({
      ...samplingFields,
      method: z.literal('txpool_content'),
      pendingCount: safeNonnegativeInteger.max(50_000),
      queuedCount: safeNonnegativeInteger.max(50_000),
    })
    .refine((sample) => sample.pendingCount + sample.queuedCount <= 50_000, {
      message: 'Pool sample exceeds its bounded transaction count',
    }),
]);
export type Sampling = z.infer<typeof samplingSchema>;

/** A node's proposed Bitcoin block, separate from a full-pool sampling observation. */
export const bitcoinBlockTemplateSchema = z
  .object({
    source: z.string().min(1).max(100),
    observedAt: safeNonnegativeInteger,
    height: safeNonnegativeInteger,
    previousBlockHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    /** Complete non-coinbase transaction count, before the scene sample is limited. */
    transactionCount: safeNonnegativeInteger.max(30_000),
    /** Sum of the non-coinbase transaction weights, in weight units. */
    weight: safeNonnegativeInteger,
    weightLimit: z.number().int().positive().safe().max(4_000_000),
    /** Complete non-coinbase candidate fee median in satoshis; optional for older producers. */
    medianFeeSats: z
      .number()
      .finite()
      .nonnegative()
      .max(2_100_000_000_000_000)
      .refine((amount) => Number.isSafeInteger(amount * 2), {
        message: 'A candidate fee median must be an integer or half-integer number of satoshis',
      })
      .nullable()
      .optional(),
    /** Bounded selected IDs; these are proposals, never proof of block inclusion. */
    selectedTransactionIds: z
      .array(z.string().regex(/^[a-fA-F0-9]{64}$/))
      .max(MAX_TRACKED_TRANSACTIONS),
  })
  .superRefine((template, context) => {
    if (
      template.medianFeeSats !== undefined &&
      ((template.transactionCount === 0 && template.medianFeeSats !== null) ||
        (template.transactionCount > 0 && template.medianFeeSats === null))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['medianFeeSats'],
        message: 'Only an empty candidate has a null complete fee median',
      });
    }
    if (
      template.medianFeeSats != null &&
      template.transactionCount % 2 !== 0 &&
      !Number.isInteger(template.medianFeeSats)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['medianFeeSats'],
        message: 'An odd complete transaction count must have an integer fee median',
      });
    }
    if ((template.transactionCount === 0) !== (template.weight === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'Only an empty candidate has zero complete transaction weight',
      });
    }
    if (template.weight > template.weightLimit) {
      context.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'Template transaction weight exceeds its block weight limit',
      });
    }
    if (template.selectedTransactionIds.length > template.transactionCount) {
      context.addIssue({
        code: 'custom',
        path: ['selectedTransactionIds'],
        message: 'Selected template identifiers exceed its complete transaction count',
      });
    }
    const ids = template.selectedTransactionIds.map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['selectedTransactionIds'],
        message: 'Selected template identifiers must be unique',
      });
    }
  });
export type BitcoinBlockTemplate = z.infer<typeof bitcoinBlockTemplateSchema>;

/** Complete, private-ID comparison of an earlier node proposal with the received block. */
export const bitcoinCandidateComparisonSchema = z
  .object({
    scope: z.literal('complete'),
    blockHash: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((hash) => hash.toLowerCase()),
    blockHeight: safeNonnegativeInteger,
    parentBlockHash: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((hash) => hash.toLowerCase()),
    candidateObservedAt: safeNonnegativeInteger,
    /** First detection of this head by this service, not the miner's block timestamp. */
    blockObservedAt: safeNonnegativeInteger,
    candidateSource: z.string().min(1).max(100),
    blockSource: z.string().min(1).max(100),
    candidateTransactionCount: safeNonnegativeInteger.max(30_000),
    blockTransactionCount: safeNonnegativeInteger.max(29_999),
    commonCount: safeNonnegativeInteger.max(29_999),
    candidateOnlyCount: safeNonnegativeInteger.max(30_000),
    blockOnlyCount: safeNonnegativeInteger.max(29_999),
  })
  .superRefine((comparison, context) => {
    if (
      comparison.commonCount + comparison.candidateOnlyCount !==
        comparison.candidateTransactionCount ||
      comparison.commonCount + comparison.blockOnlyCount !== comparison.blockTransactionCount ||
      comparison.candidateObservedAt > comparison.blockObservedAt
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A complete candidate comparison requires exact counts and ordered observations',
      });
    }
  });
export type BitcoinCandidateComparison = z.infer<typeof bitcoinCandidateComparisonSchema>;

const blockValueFields = {
  blockHeight: safeNonnegativeInteger,
  /** Exact nonnegative integer amount in the chain's smallest unit. */
  amount: z
    .string()
    .max(83)
    .regex(/^(?:0|[1-9][0-9]*)$/),
  /** Complete block transaction count, including Bitcoin's excluded coinbase. */
  transactionCount: safeNonnegativeInteger,
  observedAt: safeNonnegativeInteger,
};
/** Full-block native amount; never a sum of the limited passenger sample. */
export const latestBlockValueSchema = z.discriminatedUnion('unit', [
  z.object({
    ...blockValueFields,
    blockHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    unit: z.literal('sat'),
    method: z.literal('bitcoin-output-sum'),
  }),
  z.object({
    ...blockValueFields,
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    unit: z.literal('wei'),
    method: z.literal('ethereum-transaction-value-sum'),
  }),
]);
export type LatestBlockValue = z.infer<typeof latestBlockValueSchema>;

export const transactionSchema = z
  .object({
    id: canonicalIdentifier,
    chain: chainIdSchema,
    feeRate: finiteNonnegative,
    size: finiteNonnegative,
    status: z.enum(['pending', 'confirmed']),
    /** Inclusion evidence from the provider, never inferred from an animation. */
    blockHash: canonicalIdentifier.optional(),
    /** Exact fee caps and account order; size remains the declared gas limit. */
    ethereum: ethereumTransactionSchema.optional(),
    kind: z.enum(['transfer', 'contract']),
    value: z.string().max(100),
  })
  .superRefine((transaction, context) => {
    if (transaction.status === 'pending' && transaction.blockHash !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['blockHash'],
        message: 'Pending transactions cannot carry block inclusion evidence',
      });
    }
    if (transaction.ethereum !== undefined && transaction.chain !== 'ethereum') {
      context.addIssue({
        code: 'custom',
        path: ['ethereum'],
        message: 'Ethereum metadata on another chain',
      });
    }
  });
export type Tx = z.infer<typeof transactionSchema>;

export const blockSchema = z
  .object({
    height: safeNonnegativeInteger,
    hash: canonicalIdentifier,
    /** Unix timestamp in seconds, matching the upstream chain protocols. */
    timestamp: safeNonnegativeInteger.max(32_503_680_000),
    txCount: safeNonnegativeInteger,
    /** Bitcoin: virtual bytes. Ethereum: gas. */
    used: finiteNonnegative,
    capacity: z.number().finite().positive(),
  })
  .refine((block) => block.used <= block.capacity, {
    message: 'Block utilization exceeds its declared capacity',
  });
export type Block = z.infer<typeof blockSchema>;

export const blockInclusionsSchema = z
  .object({
    block: blockSchema,
    /** Previously observed IDs whose inclusion was verified in this exact block. */
    transactionIds: z.array(canonicalIdentifier).max(MAX_TRACKED_TRANSACTIONS),
  })
  .superRefine((inclusions, context) => {
    const ids = inclusions.transactionIds.map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactionIds'],
        message: 'Block inclusion identifiers must be unique',
      });
    }
  });
export type BlockInclusions = z.infer<typeof blockInclusionsSchema>;

export const snapshotSchema = z
  .object({
    chain: chainIdSchema,
    mode: z.enum(['demo', 'live']),
    status: z.enum(['ok', 'stale', 'unavailable']),
    source: z.string().min(1).max(100),
    /** Unix timestamp in milliseconds; stale snapshots retain their original time. */
    observedAt: safeNonnegativeInteger,
    coverage: z.string().min(1).max(700),
    /** Observed provider's local pool total; null when no total is available. */
    pendingCount: safeNonnegativeInteger.nullable(),
    /** Optional Ethereum local pool breakdown with its own observation time. */
    mempool: ethereumMempoolSchema.nullable().optional(),
    /** Full-pool sampling provenance, separate from the chain poll and pool counters. */
    sampling: samplingSchema.nullable().optional(),
    poolObservation: poolObservationSchema.nullable().optional(),
    poolFlow: poolFlowSchema.nullable().optional(),
    eventFlow: eventFlowSchema.nullable().optional(),
    bitcoinArrivals: bitcoinArrivalsSchema.nullable().optional(),
    ethereumProjection: ethereumProjectionSchema.nullable().optional(),
    ethereumDependencies: ethereumDependenciesSchema.nullable().optional(),
    /** Optional Bitcoin node proposal; never a mined block or a pool-wide ranking. */
    blockTemplate: bitcoinBlockTemplateSchema.nullable().optional(),
    candidateComparison: bitcoinCandidateComparisonSchema.nullable().optional(),
    feeRate: finiteNonnegative.nullable(),
    feeUnit: z.enum(['sat/vB', 'Gwei']),
    /** Optional market conversion; its availability is independent of chain data. */
    usdQuote: usdQuoteSchema.nullable().optional(),
    /** Native values from the exact latest block; null if its aggregate is unavailable. */
    latestBlockValue: latestBlockValueSchema.nullable().optional(),
    transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS),
    blocks: z.array(blockSchema).max(MAX_BLOCKS),
    /** Bounded replay journal; its historical blocks need not appear in blocks. */
    inclusions: z.array(blockInclusionsSchema).max(MAX_INCLUSION_BLOCKS).optional(),
    message: z.string().max(700).optional(),
  })
  .superRefine((snapshot, context) => {
    const templateIds = new Set(
      snapshot.blockTemplate?.selectedTransactionIds.map((id) => id.toLowerCase()) ?? [],
    );
    const arrivalIds = new Set(snapshot.bitcoinArrivals?.transactionIds ?? []);
    if (snapshot.bitcoinArrivals != null) {
      const arrivals = snapshot.bitcoinArrivals;
      const pendingIds = new Set(
        snapshot.transactions
          .filter((tx) => tx.status === 'pending')
          .map((tx) => tx.id.toLowerCase()),
      );
      if (
        snapshot.chain !== 'bitcoin' ||
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        arrivals.observedAt > snapshot.observedAt ||
        snapshot.observedAt - arrivals.observedAt > BITCOIN_ARRIVALS_MAX_AGE_MS ||
        arrivalIds.size !== arrivals.transactionIds.length ||
        arrivals.transactionIds.some((id) => !pendingIds.has(id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['bitcoinArrivals'],
          message:
            'Bitcoin arrivals must identify current pending transactions from a recent live stream',
        });
      }
    }
    const transactionIds = snapshot.transactions.map((tx) => tx.id.toLowerCase());
    if (new Set(transactionIds).size !== transactionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactions'],
        message: 'Transaction identities must be unique',
      });
    }
    if (snapshot.transactions.some((tx) => tx.chain !== snapshot.chain)) {
      context.addIssue({
        code: 'custom',
        message: 'Transactions must belong to the snapshot chain',
      });
    }
    if ((snapshot.chain === 'bitcoin') !== (snapshot.feeUnit === 'sat/vB')) {
      context.addIssue({ code: 'custom', message: 'Fee unit does not match the chain' });
    }
    if (snapshot.mode === 'demo' && snapshot.status !== 'ok') {
      context.addIssue({
        code: 'custom',
        message: 'A demo cannot represent upstream availability',
      });
    }
    if (snapshot.mode === 'demo' && snapshot.usdQuote != null) {
      context.addIssue({
        code: 'custom',
        path: ['usdQuote'],
        message: 'Demonstration snapshots cannot carry a live market quote',
      });
    }
    if (snapshot.sampling != null) {
      const sample = snapshot.sampling;
      if (
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        (sample.method === 'getrawmempool') !== (snapshot.chain === 'bitcoin') ||
        (sample.method === 'getrawmempool' && snapshot.pendingCount !== sample.pendingCount) ||
        snapshot.transactions.filter(
          (tx) =>
            tx.status === 'pending' &&
            !templateIds.has(tx.id.toLowerCase()) &&
            !arrivalIds.has(tx.id.toLowerCase()),
        ).length > sample.pendingCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sampling'],
          message: 'Full-pool sampling metadata does not match the snapshot',
        });
      }
    }
    if (snapshot.blockTemplate != null) {
      const template = snapshot.blockTemplate;
      const latest = snapshot.blocks[0];
      if (
        snapshot.chain !== 'bitcoin' ||
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        latest === undefined ||
        template.previousBlockHash.toLowerCase() !== latest.hash.toLowerCase() ||
        template.height !== latest.height + 1 ||
        template.observedAt > snapshot.observedAt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['blockTemplate'],
          message: 'A Bitcoin node template must match the latest live parent and observation',
        });
      }
      const currentPending = new Map(
        snapshot.transactions
          .filter((tx) => tx.status === 'pending')
          .map((tx) => [tx.id.toLowerCase(), tx]),
      );
      const selectedIds = new Set(template.selectedTransactionIds.map((id) => id.toLowerCase()));
      // Older producers may supply ceil(weight / 4) vsize. Preserve that conservative
      // rounding (at most three WU per transaction), while rejecting impossible totals.
      const minimumCurrentWeight = [...currentPending.values()]
        .filter((tx) => selectedIds.has(tx.id.toLowerCase()))
        .reduce(
          (total, tx) =>
            total + (Number.isInteger(tx.size) ? Math.max(0, tx.size * 4 - 3) : tx.size * 4),
          0,
        );
      if (minimumCurrentWeight > template.weight) {
        context.addIssue({
          code: 'custom',
          path: ['blockTemplate', 'weight'],
          message:
            'Complete candidate weight is below the weight represented by current transactions',
        });
      }
      if (
        snapshot.sampling?.method !== 'getrawmempool' &&
        snapshot.transactions.some(
          (tx) =>
            tx.status === 'pending' &&
            !selectedIds.has(tx.id.toLowerCase()) &&
            !arrivalIds.has(tx.id.toLowerCase()),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transactions'],
          message:
            'Pending transactions outside the template require separate pool or arrival evidence',
        });
      }
    }
    if (snapshot.candidateComparison != null) {
      const comparison = snapshot.candidateComparison;
      const latest = snapshot.blocks[0];
      const previous = snapshot.blocks.find((block) => block.height === comparison.blockHeight - 1);
      if (
        snapshot.chain !== 'bitcoin' ||
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        latest === undefined ||
        comparison.blockHash !== latest.hash.toLowerCase() ||
        comparison.blockHeight !== latest.height ||
        comparison.blockTransactionCount !== latest.txCount - 1 ||
        comparison.blockObservedAt > snapshot.observedAt ||
        (previous !== undefined && comparison.parentBlockHash !== previous.hash.toLowerCase())
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidateComparison'],
          message: 'A complete comparison must describe the exact latest live Bitcoin block',
        });
      }
    }
    if (snapshot.eventFlow != null) {
      const flow = snapshot.eventFlow;
      if (
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        (flow.method !== 'newPendingTransactions') !== (snapshot.chain === 'bitcoin')
      )
        context.addIssue({
          code: 'custom',
          path: ['eventFlow'],
          message: 'Event flow must belong to its live chain',
        });
    }
    if (snapshot.poolFlow != null) {
      const flow = snapshot.poolFlow;
      if (
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        (flow.method === 'getrawmempool') !== (snapshot.chain === 'bitcoin') ||
        flow.observedAt > snapshot.observedAt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['poolFlow'],
          message: 'Pool flow requires a dated complete inventory from the live chain',
        });
      }
    }
    if (snapshot.poolObservation != null) {
      const pool = snapshot.poolObservation;
      const pattern = snapshot.chain === 'bitcoin' ? /^[a-f0-9]{64}$/ : /^0x[a-f0-9]{64}$/;
      if (
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        (pool.method === 'getrawmempool') !== (snapshot.chain === 'bitcoin') ||
        pool.observedAt > snapshot.observedAt ||
        snapshot.sampling == null ||
        pool.source !== snapshot.sampling.source ||
        pool.observedAt !== snapshot.sampling.observedAt ||
        pool.presentTransactionIds.length > snapshot.sampling.pendingCount ||
        pool.queuedTransactionIds.length >
          (snapshot.sampling.method === 'txpool_content' ? snapshot.sampling.queuedCount : 0) ||
        [
          ...pool.presentTransactionIds,
          ...pool.queuedTransactionIds,
          ...pool.absentTransactionIds,
        ].some((id) => !pattern.test(id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['poolObservation'],
          message: 'Pool presence must match a dated complete inventory observation',
        });
      }
    }
    if (snapshot.ethereumProjection != null) {
      const projection = snapshot.ethereumProjection;
      const latest = snapshot.blocks[0];
      if (
        snapshot.chain !== 'ethereum' ||
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        latest === undefined ||
        projection.height !== latest.height + 1 ||
        projection.parentBlockHash !== latest.hash.toLowerCase() ||
        projection.observedAt > snapshot.observedAt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['ethereumProjection'],
          message: 'Ethereum projection must match the latest live parent and observation',
        });
      }
    }
    if (snapshot.ethereumDependencies != null) {
      const dependencies = snapshot.ethereumDependencies;
      const latest = snapshot.blocks[0];
      const pool = snapshot.poolObservation;
      const poolIds = new Set(
        pool
          ? [
              ...pool.presentTransactionIds,
              ...pool.queuedTransactionIds,
              ...pool.absentTransactionIds,
            ]
          : [],
      );
      const presentIds = new Set(pool?.presentTransactionIds ?? []);
      const queuedIds = new Set(pool?.queuedTransactionIds ?? []);
      if (
        snapshot.chain !== 'ethereum' ||
        snapshot.mode !== 'live' ||
        snapshot.status === 'unavailable' ||
        !latest ||
        dependencies.parentBlockHash !== latest.hash.toLowerCase() ||
        dependencies.height !== latest.height + 1 ||
        dependencies.observedAt > snapshot.observedAt ||
        snapshot.observedAt - dependencies.observedAt > 60_000 ||
        !pool ||
        pool.method !== 'txpool_content' ||
        dependencies.source !== pool.source ||
        dependencies.observedAt !== pool.observedAt ||
        snapshot.sampling?.method !== 'txpool_content' ||
        dependencies.source !== snapshot.sampling.source ||
        dependencies.observedAt !== snapshot.sampling.observedAt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['ethereumDependencies'],
          message:
            'Ethereum dependencies require the exact current head and a dated complete pool observation',
        });
      }
      const current = new Map(snapshot.transactions.map((tx) => [tx.id.toLowerCase(), tx]));
      const dependencyMetadata = new Map(
        dependencies.entries.map((entry) => [entry.transactionId, entry]),
      );
      for (const [index, dependency] of dependencies.entries.entries()) {
        const transaction = current.get(dependency.transactionId);
        const predecessor = dependency.predecessor;
        const parentMetadata =
          'transactionId' in predecessor && predecessor.transactionId
            ? (current.get(predecessor.transactionId)?.ethereum ??
              dependencyMetadata.get(predecessor.transactionId))
            : undefined;
        if (
          !poolIds.has(dependency.transactionId) ||
          (transaction?.ethereum &&
            (transaction.ethereum.from !== dependency.from ||
              transaction.ethereum.nonce !== dependency.nonce)) ||
          ('transactionId' in predecessor &&
            predecessor.transactionId &&
            !poolIds.has(predecessor.transactionId)) ||
          (parentMetadata &&
            'nonce' in predecessor &&
            (parentMetadata.from !== dependency.from ||
              parentMetadata.nonce !== predecessor.nonce)) ||
          (predecessor.state === 'pending' && !presentIds.has(predecessor.transactionId)) ||
          (predecessor.state === 'queued' && !queuedIds.has(predecessor.transactionId)) ||
          (predecessor.state === 'unobserved' && !presentIds.has(dependency.transactionId)) ||
          (predecessor.state === 'confirmed' &&
            (!latest ||
              predecessor.blockHeight > latest.height ||
              !snapshot.inclusions?.some(
                (inclusion) =>
                  inclusion.block.hash.toLowerCase() === predecessor.blockHash &&
                  inclusion.block.height === predecessor.blockHeight &&
                  inclusion.transactionIds.includes(predecessor.transactionId),
              )))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['ethereumDependencies', 'entries', index],
            message:
              'Ethereum dependency evidence must agree with tracked membership, metadata and exact canonical inclusions',
          });
        }
      }
    }
    if (snapshot.latestBlockValue != null) {
      const value = snapshot.latestBlockValue;
      const latest = snapshot.blocks[0];
      if (
        snapshot.mode !== 'live' ||
        (snapshot.chain === 'bitcoin') !== (value.unit === 'sat') ||
        latest === undefined ||
        value.blockHash.toLowerCase() !== latest.hash.toLowerCase() ||
        value.blockHeight !== latest.height ||
        value.transactionCount !== latest.txCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['latestBlockValue'],
          message: 'A full-block value must match the latest live block and its chain',
        });
      }
    }
    if (snapshot.mempool != null) {
      if (snapshot.chain !== 'ethereum' || snapshot.mode !== 'live') {
        context.addIssue({
          code: 'custom',
          path: ['mempool'],
          message: 'A txpool_status observation must belong to live Ethereum data',
        });
      }
      if (snapshot.pendingCount !== snapshot.mempool.pending + snapshot.mempool.queued) {
        context.addIssue({
          code: 'custom',
          path: ['pendingCount'],
          message: 'The local pool total must match its pending and queued counts',
        });
      }
    }
    if (
      snapshot.mode === 'live' &&
      (snapshot.transactions.some(
        (tx) => tx.id.startsWith('demo-') || tx.blockHash?.startsWith('demo-'),
      ) ||
        snapshot.blocks.some((block) => block.hash.startsWith('demo-')) ||
        snapshot.inclusions?.some(
          (inclusion) =>
            inclusion.block.hash.startsWith('demo-') ||
            inclusion.transactionIds.some((id) => id.startsWith('demo-')),
        ))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic demo identifiers cannot be used as live data',
      });
    }
    const inclusions = snapshot.inclusions ?? [];
    if (
      inclusions.reduce((count, inclusion) => count + inclusion.transactionIds.length, 0) >
      MAX_TRACKED_TRANSACTIONS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal exceeds its tracked identifier limit',
      });
    }
    const hashes = inclusions.map((inclusion) => inclusion.block.hash.toLowerCase());
    if (new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal must contain unique block hashes',
      });
    }
    const heights = inclusions.map((inclusion) => inclusion.block.height);
    if (new Set(heights).size !== heights.length) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal must contain unique block heights',
      });
    }
    inclusions.forEach((inclusion, index) => {
      const displayedBlock = snapshot.blocks.find(
        (block) => block.height === inclusion.block.height,
      );
      if (
        displayedBlock &&
        displayedBlock.hash.toLowerCase() !== inclusion.block.hash.toLowerCase()
      ) {
        context.addIssue({
          code: 'custom',
          path: ['inclusions', index, 'block', 'hash'],
          message: 'Inclusion journal and displayed block disagree at the same height',
        });
      }
    });
    if (snapshot.mode === 'live') {
      const identifierPattern =
        snapshot.chain === 'bitcoin' ? /^[a-fA-F0-9]{64}$/ : /^0x[a-fA-F0-9]{64}$/;
      inclusions.forEach((inclusion, index) => {
        if (!identifierPattern.test(inclusion.block.hash)) {
          context.addIssue({
            code: 'custom',
            path: ['inclusions', index, 'block', 'hash'],
            message: 'Inclusion block hash does not match the chain format',
          });
        }
        inclusion.transactionIds.forEach((id, transactionIndex) => {
          if (!identifierPattern.test(id)) {
            context.addIssue({
              code: 'custom',
              path: ['inclusions', index, 'transactionIds', transactionIndex],
              message: 'Inclusion transaction identifier does not match the chain format',
            });
          }
        });
      });
    }
    if (
      snapshot.status === 'unavailable' &&
      (snapshot.transactions.length ||
        snapshot.blocks.length ||
        inclusions.length ||
        snapshot.mempool != null ||
        snapshot.blockTemplate != null ||
        snapshot.candidateComparison != null ||
        snapshot.poolObservation != null ||
        snapshot.poolFlow != null ||
        snapshot.eventFlow != null ||
        snapshot.bitcoinArrivals != null ||
        snapshot.ethereumProjection != null ||
        snapshot.ethereumDependencies != null ||
        snapshot.latestBlockValue != null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable snapshots cannot display fabricated live data',
      });
    }
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
