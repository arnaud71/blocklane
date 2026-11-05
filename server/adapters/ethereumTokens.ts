import { z } from 'zod';
import {
  MAX_TOKEN_TRANSFER_EVENTS,
  TOKEN_CONTRACTS,
  tokenBlockTransfersSchema,
  type TokenActivity,
  type TokenBlockTransfers,
} from '../../shared/tokenContracts.js';
import { parsePayload, UpstreamError } from '../network.js';

/** ERC-20 Transfer(address,address,uint256), pinned independently of provider labels. */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const addressWord = /^0{24}[a-fA-F0-9]{40}$/;
const uintWord = /^[a-fA-F0-9]{64}$/;

/** Only the reviewed mainnet contract identifies USDT. Calls describe intent, not execution. */
export function ethereumTokenCall(transaction: {
  to: string | null;
  input: string;
}): TokenActivity[] | undefined {
  if (transaction.to?.toLowerCase() !== TOKEN_CONTRACTS.usdt.address) return undefined;
  const interaction: TokenActivity[] = [
    { tokenId: 'usdt', operation: 'interaction', evidence: 'call' },
  ];
  const selector = transaction.input.slice(0, 10).toLowerCase();
  const signature =
    selector === '0xa9059cbb'
      ? { operation: 'transfer' as const, addresses: 1 }
      : selector === '0x23b872dd'
        ? { operation: 'transfer' as const, addresses: 2 }
        : selector === '0x095ea7b3'
          ? { operation: 'approval' as const, addresses: 1 }
          : null;
  if (signature === null || transaction.input.length !== 10 + (signature.addresses + 1) * 64)
    return interaction;
  for (let index = 0; index < signature.addresses; index += 1)
    if (!addressWord.test(transaction.input.slice(10 + index * 64, 74 + index * 64)))
      return interaction;
  const amount = transaction.input.slice(10 + signature.addresses * 64);
  if (!uintWord.test(amount)) return interaction;
  return [
    {
      tokenId: 'usdt',
      operation: signature.operation,
      evidence: 'call',
      amount: BigInt(`0x${amount}`).toString(),
    },
  ];
}

const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const quantitySchema = z
  .string()
  .max(66)
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
const transferLogSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  topics: z.array(hashSchema).length(3),
  data: hashSchema,
  blockHash: hashSchema,
  blockNumber: quantitySchema,
  transactionHash: hashSchema,
  transactionIndex: quantitySchema,
  logIndex: quantitySchema,
  removed: z.literal(false),
});

export interface EthereumTokenTransfers {
  report: TokenBlockTransfers;
  /** Only a bounded amount and count survive validation; no participant addresses or logs. */
  byTransaction: Map<string, TokenActivity>;
}

/** Reject the entire optional response if any event cannot be tied to this complete block. */
export function parseEthereumTokenTransfers(
  raw: unknown,
  block: { hash: string; height: number; transactionIds: readonly string[] },
  source: string,
  observedAt: number,
): EthereumTokenTransfers {
  if (!Array.isArray(raw)) throw new UpstreamError('invalid');
  if (raw.length > MAX_TOKEN_TRANSFER_EVENTS) throw new UpstreamError('too-large');
  const byTransaction = new Map<string, TokenActivity>();
  const logIndexes = new Set<bigint>();
  let amount = 0n;
  for (const value of raw) {
    const log = parsePayload(transferLogSchema, value);
    const transactionId = log.transactionHash.toLowerCase();
    const transactionIndex = BigInt(log.transactionIndex);
    const logIndex = BigInt(log.logIndex);
    if (
      log.address.toLowerCase() !== TOKEN_CONTRACTS.usdt.address ||
      log.topics[0]!.toLowerCase() !== ERC20_TRANSFER_TOPIC ||
      !addressWord.test(log.topics[1]!.slice(2)) ||
      !addressWord.test(log.topics[2]!.slice(2)) ||
      log.blockHash.toLowerCase() !== block.hash ||
      BigInt(log.blockNumber) !== BigInt(block.height) ||
      transactionIndex >= BigInt(block.transactionIds.length) ||
      block.transactionIds[Number(transactionIndex)] !== transactionId ||
      logIndexes.has(logIndex)
    )
      throw new UpstreamError('invalid');
    logIndexes.add(logIndex);
    const valueAmount = BigInt(log.data);
    amount += valueAmount;
    const previous = byTransaction.get(transactionId);
    byTransaction.set(transactionId, {
      tokenId: 'usdt',
      operation: 'transfer',
      evidence: 'log',
      amount: (BigInt(previous?.amount ?? '0') + valueAmount).toString(),
      transferCount: (previous?.transferCount ?? 0) + 1,
      observedAt,
    });
  }
  return {
    report: parsePayload(tokenBlockTransfersSchema, {
      tokenId: 'usdt',
      blockHash: block.hash,
      blockHeight: block.height,
      source,
      observedAt,
      method: 'eth_getLogs',
      transactionCount: byTransaction.size,
      transferCount: raw.length,
      amount: amount.toString(),
    }),
    byTransaction,
  };
}
