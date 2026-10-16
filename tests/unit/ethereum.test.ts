import { describe, expect, it, vi } from 'vitest';
import {
  effectiveGasPriceWei,
  ethereumTransactionSchema,
  fetchEthereumSnapshot,
  formatEther,
  hexQuantitySchema,
} from '../../server/adapters/ethereum.js';
import { config, ethBlock, ethHash, ethTx, ethereumFetcher, now, quantity } from './fixtures.js';
import type { Fetcher } from '../../server/network.js';

function controlledFetcher(options: Parameters<typeof ethereumFetcher>[0] = {}) {
  const upstream = ethereumFetcher(options);
  return vi.fn<Fetcher>(async (input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (request.method !== 'eth_chainId' && request.method !== 'eth_getBlockByNumber')
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Optional method unavailable in fixture' },
      });
    const response = await upstream(input, init);
    const payload = (await response.json()) as { result?: unknown; error?: unknown };
    if (
      request.method === 'eth_getBlockByNumber' &&
      String(request.params[0]).startsWith('0x') &&
      payload.error === undefined
    ) {
      const height = BigInt(String(request.params[0]));
      payload.result = {
        ...ethBlock,
        hash: `0x${(100_000n + height).toString(16).padStart(64, '0')}`,
        parentHash: `0x${(99_999n + height).toString(16).padStart(64, '0')}`,
        number: quantity(height),
        gasUsed: '0x0',
        transactions: [],
      };
    }
    return Response.json(payload);
  });
}

describe('Ethereum mainnet adapter and EIP-1559 arithmetic', () => {
  it('calculates effective fee at the fee cap or base plus tip using bigint', () => {
    const tx = ethereumTransactionSchema.parse(ethTx);
    expect(effectiveGasPriceWei(tx, 40_000_000_000n)).toBe(42_000_000_000n);
    expect(
      effectiveGasPriceWei({ ...tx, maxFeePerGas: quantity(41_000_000_000n) }, 40_000_000_000n),
    ).toBe(41_000_000_000n);
    expect(
      effectiveGasPriceWei({ ...tx, maxFeePerGas: quantity(30_000_000_000n) }, 40_000_000_000n),
    ).toBe(30_000_000_000n);
    const legacy = ethereumTransactionSchema.parse({
      ...ethTx,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    });
    expect(effectiveGasPriceWei(legacy, 40_000_000_000n)).toBe(42_000_000_000n);
    expect(formatEther(1_250_000_000_000_000_000n)).toBe('1.25 ETH');
    expect(formatEther(1n)).toBe('< 0.000001 ETH');
  });

  it('shows confirmed transactions when pending resolves to latest, without inventing a mempool count', async () => {
    const snapshot = await fetchEthereumSnapshot(config, controlledFetcher(), () => now);
    expect(snapshot.pendingCount).toBeNull();
    expect(snapshot.transactions[0]?.status).toBe('confirmed');
    expect(snapshot.transactions[0]?.feeRate).toBe(42);
    expect(snapshot.feeRate).toBe(40);
    expect(snapshot.blocks).toHaveLength(3);
    expect(snapshot.blocks[0]?.capacity).toBe(60_000_000);
    expect(snapshot.coverage).toContain('confirmées');
    expect(snapshot.coverage).toContain('Comptage du mempool local du fournisseur indisponible');
  });

  it('explicitly limits pending coverage to the provider candidate block', async () => {
    const pending = {
      ...ethBlock,
      hash: null,
      parentHash: ethBlock.hash,
      number: quantity(101),
      transactions: [{ ...ethTx, hash: ethHash('d'), input: '0x1234' }],
    };
    const snapshot = await fetchEthereumSnapshot(config, controlledFetcher({ pending }));
    expect(snapshot.transactions.map((tx) => tx.status)).toEqual(['pending', 'confirmed']);
    expect(snapshot.transactions[0]?.kind).toBe('contract');
    expect(snapshot.pendingCount).toBeNull();
    expect(snapshot.coverage).toContain('Ce repli n’est pas le top du mempool');
  });

  it('handles unsupported pending and partial history while preserving real latest data', async () => {
    const snapshot = await fetchEthereumSnapshot(
      config,
      controlledFetcher({ pendingError: true, previousError: true }),
    );
    expect(snapshot.status).toBe('ok');
    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.transactions[0]?.status).toBe('confirmed');
    expect(snapshot.message).toContain('blocs précédents');
    expect(JSON.stringify(snapshot)).not.toContain('provider secret');
  });

  it('uses confirmed data when the optional candidate has unsafe display quantities', async () => {
    const pending = {
      ...ethBlock,
      hash: null,
      parentHash: ethBlock.hash,
      number: quantity(101),
      transactions: [{ ...ethTx, gas: quantity(10n ** 30n) }],
    };
    const snapshot = await fetchEthereumSnapshot(config, controlledFetcher({ pending }));
    expect(snapshot.status).toBe('ok');
    expect(snapshot.transactions.every((tx) => tx.status === 'confirmed')).toBe(true);
  });

  it('keeps transactions already present in the latest block confirmed despite inconsistent candidates', async () => {
    const pending = { ...ethBlock, hash: null, parentHash: ethBlock.hash, number: quantity(101) };
    const snapshot = await fetchEthereumSnapshot(config, controlledFetcher({ pending }));
    expect(snapshot.transactions).toHaveLength(1);
    expect(snapshot.transactions[0]?.status).toBe('confirmed');
  });

  it('rejects wrong chains, mismatched JSON-RPC IDs and invalid gas usage', async () => {
    await expect(
      fetchEthereumSnapshot(config, ethereumFetcher({ chainId: '0xaa36a7' })),
    ).rejects.toMatchObject({ kind: 'wrong-chain' });
    await expect(
      fetchEthereumSnapshot(config, ethereumFetcher({ wrongRpcId: true })),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      fetchEthereumSnapshot(
        config,
        ethereumFetcher({ latest: { ...ethBlock, gasUsed: quantity(61_000_000) } }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      fetchEthereumSnapshot(config, ethereumFetcher({ latest: { ...ethBlock, hash: null } })),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      fetchEthereumSnapshot(
        config,
        ethereumFetcher({ latest: { ...ethBlock, baseFeePerGas: undefined } }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rejects noncanonical or oversized quantities and incomplete transaction fees', () => {
    for (const value of ['123', '0x', '0x00', '0x-1', `0x${'f'.repeat(65)}`]) {
      expect(hexQuantitySchema.safeParse(value).success).toBe(false);
    }
    expect(
      ethereumTransactionSchema.safeParse({ ...ethTx, maxPriorityFeePerGas: undefined }).success,
    ).toBe(false);
    expect(
      ethereumTransactionSchema.safeParse({
        ...ethTx,
        maxPriorityFeePerGas: quantity(101_000_000_000n),
      }).success,
    ).toBe(false);
    expect(ethereumTransactionSchema.safeParse({ ...ethTx, hash: '0xbad' }).success).toBe(false);
  });
});
