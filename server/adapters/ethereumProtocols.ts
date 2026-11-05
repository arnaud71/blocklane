import {
  PROTOCOL_CONTRACTS,
  protocolBlockCallsSchema,
  type ProtocolActivity,
  type ProtocolBlockCalls,
} from '../../shared/protocolContracts.js';
import { parsePayload } from '../network.js';

const addressWord = /^0{24}[a-fA-F0-9]{40}$/;
const hexInput = /^0x(?:[a-fA-F0-9]{2})*$/;
const INPUT_LIMIT = 524_288;

/** A strict static ABI shape identifies the requested method, never its execution result. */
function aaveOperation(input: string): ProtocolActivity['operation'] {
  if (!hexInput.test(input) || input.length > INPUT_LIMIT) return 'interaction';
  const signature = {
    '0x617ba037': { operation: 'supply', words: 4, addresses: [0, 2], small: 3 },
    '0x69328dec': { operation: 'withdraw', words: 3, addresses: [0, 2] },
    '0xa415bcad': { operation: 'borrow', words: 5, addresses: [0, 4], small: 3 },
    '0x573ade81': { operation: 'repay', words: 4, addresses: [0, 3] },
    '0x00a718a9': { operation: 'liquidation', words: 5, addresses: [0, 1, 2], boolean: 4 },
  }[input.slice(0, 10).toLowerCase()] as
    | {
        operation: ProtocolActivity['operation'];
        words: number;
        addresses: number[];
        small?: number;
        boolean?: number;
      }
    | undefined;
  if (!signature || input.length !== 10 + signature.words * 64) return 'interaction';
  const word = (index: number) => input.slice(10 + index * 64, 74 + index * 64);
  if (signature.addresses.some((index) => !addressWord.test(word(index)))) return 'interaction';
  if (signature.small !== undefined && BigInt(`0x${word(signature.small)}`) > 65_535n)
    return 'interaction';
  if (signature.boolean !== undefined && BigInt(`0x${word(signature.boolean)}`) > 1n)
    return 'interaction';
  return signature.operation;
}

/** UniversalRouter execute is a command container, not proof or even a guarantee of a swap. */
function routerOperation(input: string): ProtocolActivity['operation'] {
  if (!hexInput.test(input) || input.length > INPUT_LIMIT) return 'interaction';
  const selector = input.slice(0, 10).toLowerCase();
  const headWords = selector === '0x3593564c' ? 3 : selector === '0x24856bc3' ? 2 : 0;
  if (!headWords || input.length < 10 + headWords * 64) return 'interaction';
  const data = input.slice(10);
  const bytes = data.length / 2;
  const read = (offset: number): bigint | null =>
    offset >= 0 && offset + 32 <= bytes
      ? BigInt(`0x${data.slice(offset * 2, (offset + 32) * 2)}`)
      : null;
  const small = (offset: number): number | null => {
    const value = read(offset);
    return value !== null && value <= BigInt(bytes) ? Number(value) : null;
  };
  const padded = (length: number) => Math.ceil(length / 32) * 32;
  const commandsOffset = small(0);
  if (commandsOffset !== headWords * 32) return 'interaction';
  const commandsLength = small(commandsOffset);
  if (commandsLength === null || commandsLength > 1_024) return 'interaction';
  const inputsOffset = small(32);
  if (inputsOffset !== commandsOffset + 32 + padded(commandsLength)) return 'interaction';
  const count = small(inputsOffset);
  if (count !== commandsLength || count === null) return 'interaction';
  const arrayHead = inputsOffset + 32;
  let next = count * 32;
  for (let index = 0; index < count; index += 1) {
    const offset = small(arrayHead + index * 32);
    if (offset !== next) return 'interaction';
    const length = small(arrayHead + offset);
    if (length === null) return 'interaction';
    next += 32 + padded(length);
    if (arrayHead + next > bytes) return 'interaction';
  }
  return arrayHead + next === bytes ? 'execute' : 'interaction';
}

export function ethereumProtocolCall(transaction: {
  to: string | null;
  input: string;
}): ProtocolActivity[] | undefined {
  const protocol = Object.values(PROTOCOL_CONTRACTS).find((entry) =>
    entry.addresses.some((address) => address === transaction.to?.toLowerCase()),
  );
  if (!protocol) return undefined;
  return [
    {
      protocolId: protocol.id,
      operation:
        protocol.id === 'aave'
          ? aaveOperation(transaction.input)
          : routerOperation(transaction.input),
      evidence: 'call',
    },
  ];
}

/** Count recognized direct destinations in the complete block, before the passenger sample. */
export function ethereumProtocolBlockCalls(
  block: {
    hash: string;
    height: number;
    transactions: readonly { hash: string; to: string | null; input: string }[];
  },
  source: string,
  observedAt: number,
): ProtocolBlockCalls[] {
  return Object.values(PROTOCOL_CONTRACTS).map((protocol) =>
    parsePayload(protocolBlockCallsSchema, {
      protocolId: protocol.id,
      blockHash: block.hash,
      blockHeight: block.height,
      source,
      observedAt,
      method: 'block-calls',
      transactionCount: new Set(
        block.transactions
          .filter((tx) => protocol.addresses.some((address) => address === tx.to?.toLowerCase()))
          .map((tx) => tx.hash.toLowerCase()),
      ).size,
    }),
  );
}
