import { z } from 'zod';

/** Reviewed Ethereum mainnet entry points, not token tickers or inferred owners. */
export const PROTOCOL_CONTRACTS = {
  uniswap: {
    id: 'uniswap',
    label: 'Uniswap',
    chainId: 1,
    color: '#f06baf',
    // Universal Router versions from the protocol's canonical mainnet deployment list.
    addresses: [
      '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b',
      '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
      '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca',
      '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85',
    ],
    source: 'https://github.com/Uniswap/universal-router/blob/main/deploy-addresses/mainnet.json',
  },
  aave: {
    id: 'aave',
    label: 'Aave',
    chainId: 1,
    color: '#aa8ada',
    // Aave V3 Ethereum Core Pool proxy. Other markets/versions are outside this scope.
    addresses: ['0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2'],
    source: 'https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol',
  },
} as const;

export const protocolIdSchema = z.enum(['uniswap', 'aave']);
export type ProtocolId = z.infer<typeof protocolIdSchema>;
export const protocolActivitySchema = z
  .object({
    protocolId: protocolIdSchema,
    operation: z.enum([
      'interaction',
      'execute',
      'supply',
      'withdraw',
      'borrow',
      'repay',
      'liquidation',
    ]),
    /** A known entry-point call, even when included, does not prove successful execution. */
    evidence: z.enum(['call', 'demo']),
  })
  .superRefine((activity, context) => {
    if (
      (activity.protocolId === 'uniswap' &&
        !['interaction', 'execute'].includes(activity.operation)) ||
      (activity.protocolId === 'aave' && activity.operation === 'execute')
    )
      context.addIssue({ code: 'custom', message: 'Operation does not belong to this protocol' });
  });
export type ProtocolActivity = z.infer<typeof protocolActivitySchema>;

export const protocolBlockCallsSchema = z.object({
  protocolId: protocolIdSchema,
  blockHash: z.string().min(1).max(128),
  blockHeight: z.number().int().nonnegative().safe(),
  source: z.string().min(1).max(100),
  observedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  method: z.enum(['block-calls', 'simulation']),
  /** Unique direct calls in the complete block; failed and unknown-result calls are included. */
  transactionCount: z.number().int().nonnegative().max(50_000),
});
export type ProtocolBlockCalls = z.infer<typeof protocolBlockCallsSchema>;
