import { z } from 'zod';

/** Reviewed chain/address identities; names and symbols alone never identify a token. */
export const TOKEN_CONTRACTS = {
  usdt: {
    id: 'usdt',
    chain: 'ethereum',
    chainId: 1,
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    decimals: 6,
    color: '#26a17b',
  },
} as const;

export const tokenIdSchema = z.enum(['usdt']);
export type TokenId = z.infer<typeof tokenIdSchema>;
export const MAX_TOKEN_TRANSFER_EVENTS = 4_096;
export const MAX_TOKEN_ACTIVITIES = 4;

function isDecimalQuantity(amount: string): boolean {
  return amount.length <= 83 && /^(?:0|[1-9][0-9]*)$/.test(amount);
}

/** A bounded sum can exceed uint256 when several valid Transfer values are added. */
export const tokenAmountSchema = z
  .string()
  .max(83)
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .refine(
    (amount) => isDecimalQuantity(amount) && BigInt(amount) < 1n << 272n,
    'Token quantity exceeds its bound',
  );

export const tokenActivitySchema = z
  .object({
    tokenId: tokenIdSchema,
    operation: z.enum(['transfer', 'approval', 'interaction']),
    evidence: z.enum(['call', 'log', 'demo']),
    /** Base units: requested by a call, or summed from actual Transfer logs. */
    amount: tokenAmountSchema.optional(),
    transferCount: z.number().int().min(1).max(MAX_TOKEN_TRANSFER_EVENTS).optional(),
    /** Receipt/log observation time, independent of subsequent header polls. */
    observedAt: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  })
  .superRefine((activity, context) => {
    if (
      (activity.evidence === 'log' &&
        (activity.operation !== 'transfer' ||
          activity.amount === undefined ||
          activity.transferCount === undefined ||
          activity.observedAt === undefined)) ||
      (activity.evidence === 'call' &&
        (activity.transferCount !== undefined ||
          activity.observedAt !== undefined ||
          (activity.operation !== 'interaction' && activity.amount === undefined) ||
          (activity.amount !== undefined &&
            isDecimalQuantity(activity.amount) &&
            BigInt(activity.amount) >= 1n << 256n))) ||
      (activity.evidence === 'log' &&
        activity.amount !== undefined &&
        activity.transferCount !== undefined &&
        isDecimalQuantity(activity.amount) &&
        BigInt(activity.amount) > ((1n << 256n) - 1n) * BigInt(activity.transferCount)) ||
      (activity.operation === 'interaction' && activity.amount !== undefined)
    )
      context.addIssue({ code: 'custom', message: 'Inconsistent token activity evidence' });
  });
export type TokenActivity = z.infer<typeof tokenActivitySchema>;

export const tokenBlockTransfersSchema = z
  .object({
    tokenId: tokenIdSchema,
    blockHash: z.string().min(1).max(128),
    blockHeight: z.number().int().nonnegative().safe(),
    source: z.string().min(1).max(100),
    observedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
    method: z.enum(['eth_getLogs', 'simulation']),
    transactionCount: z.number().int().nonnegative().max(MAX_TOKEN_TRANSFER_EVENTS),
    transferCount: z.number().int().nonnegative().max(MAX_TOKEN_TRANSFER_EVENTS),
    amount: tokenAmountSchema,
  })
  .superRefine((report, context) => {
    if (
      report.transactionCount > report.transferCount ||
      (report.transferCount === 0 && (report.transactionCount !== 0 || report.amount !== '0')) ||
      (report.transferCount > 0 && report.transactionCount === 0) ||
      (isDecimalQuantity(report.amount) &&
        BigInt(report.amount) > ((1n << 256n) - 1n) * BigInt(report.transferCount))
    )
      context.addIssue({ code: 'custom', message: 'Inconsistent token transfer totals' });
  });
export type TokenBlockTransfers = z.infer<typeof tokenBlockTransfersSchema>;

export function hasTokenActivity(
  transaction: { tokens?: readonly TokenActivity[] },
  tokenId: TokenId = 'usdt',
): boolean {
  return transaction.tokens?.some((activity) => activity.tokenId === tokenId) ?? false;
}
