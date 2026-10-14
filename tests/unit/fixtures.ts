import { vi } from 'vitest';
import { snapshotSchema, type ChainId, type Snapshot } from '../../shared/model.js';
import { loadConfig } from '../../server/config.js';
import { generateDemoSnapshot } from '../../server/demo.js';
import type { Fetcher } from '../../server/network.js';

export const config = loadConfig({});
export const hash = (character = 'a') => character.repeat(64);
export const quantity = (number: bigint | number) => `0x${BigInt(number).toString(16)}`;
export const ethHash = (character = 'a') => `0x${hash(character)}`;
export const now = 1_760_000_000_000;

export function liveSnapshot(chain: ChainId = 'bitcoin', observedAt = now): Snapshot {
  const demo = generateDemoSnapshot(chain, observedAt);
  return snapshotSchema.parse({
    ...demo,
    mode: 'live',
    source: 'Test upstream',
    transactions: demo.transactions.map((tx) => ({
      ...tx,
      id: `${chain === 'ethereum' ? '0x' : ''}${tx.id.slice(-64)}`,
    })),
    blocks: demo.blocks.map((block) => ({
      ...block,
      hash: `${chain === 'ethereum' ? '0x' : ''}${block.hash.slice(-64)}`,
    })),
  });
}

export const btcBlock = {
  id: hash(),
  height: 900_000,
  timestamp: now / 1_000,
  tx_count: 2_000,
  weight: 3_900_000,
};
export const btcTx = { txid: hash('b'), fee: 1_050, vsize: 210 };

export function bitcoinFetcher(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    '/v1/blocks': [btcBlock, { ...btcBlock, id: hash('c'), height: 899_999 }],
    '/mempool/recent': [btcTx],
    '/mempool': { count: 9_000, vsize: 1_000_000, total_fee: 5_000_000 },
    '/v1/fees/recommended': { fastestFee: 10, halfHourFee: 7, hourFee: 5 },
    [`/block/${btcBlock.id}/txids`]: Array.from({ length: btcBlock.tx_count }, (_, index) =>
      index.toString(16).padStart(64, '0'),
    ),
    ...overrides,
  };
  return vi.fn<Fetcher>(async (input) => {
    const path = new URL(String(input)).pathname.replace(/^\/api/, '');
    return Response.json(data[path]);
  });
}

export const ethTx = {
  hash: ethHash('b'),
  from: `0x${'a'.repeat(40)}`,
  to: `0x${'b'.repeat(40)}`,
  value: quantity(1_250_000_000_000_000_000n),
  gas: quantity(21_000),
  gasPrice: quantity(42_000_000_000n),
  maxFeePerGas: quantity(100_000_000_000n),
  maxPriorityFeePerGas: quantity(2_000_000_000n),
  input: '0x',
};
export const ethBlock = {
  hash: ethHash(),
  number: quantity(100),
  timestamp: quantity(now / 1_000),
  gasUsed: quantity(30_000_000),
  gasLimit: quantity(60_000_000),
  baseFeePerGas: quantity(40_000_000_000n),
  transactions: [ethTx],
};

export function ethereumFetcher(
  options: {
    chainId?: unknown;
    latest?: unknown;
    pending?: unknown;
    pendingError?: boolean;
    wrongRpcId?: boolean;
    previousError?: boolean;
  } = {},
) {
  return vi.fn<Fetcher>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const id = options.wrongRpcId ? request.id + 1 : request.id;
    if (request.method === 'eth_chainId') {
      return Response.json({ jsonrpc: '2.0', id, result: options.chainId ?? '0x1' });
    }
    if (
      (options.pendingError && request.params[0] === 'pending') ||
      (options.previousError && !['latest', 'pending'].includes(String(request.params[0])))
    ) {
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'provider secret' },
      });
    }
    const result =
      request.params[0] === 'latest'
        ? (options.latest ?? ethBlock)
        : request.params[0] === 'pending'
          ? Object.hasOwn(options, 'pending')
            ? options.pending
            : ethBlock
          : {
              ...ethBlock,
              hash: ethHash('c'),
              number: request.params[0],
              transactions: [ethTx.hash],
            };
    return Response.json({ jsonrpc: '2.0', id, result });
  });
}
