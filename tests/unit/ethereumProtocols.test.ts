import { describe, expect, it } from 'vitest';
import {
  ethereumProtocolBlockCalls,
  ethereumProtocolCall,
} from '../../server/adapters/ethereumProtocols.js';
import { PROTOCOL_CONTRACTS } from '../../shared/protocolContracts.js';
import { now } from './fixtures.js';

const address = `0x${'a'.repeat(40)}`;
const addressWord = address.slice(2).padStart(64, '0');
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, '0');
const tx = (to: string | null, input: string) => ({ to, input });
const aave = (input: string) =>
  ethereumProtocolCall(tx(PROTOCOL_CONTRACTS.aave.addresses[0]!, input));
const router = (input: string) =>
  ethereumProtocolCall(tx(PROTOCOL_CONTRACTS.uniswap.addresses[0]!, input));
// ABI execute(bytes commands,bytes[] inputs,uint256 deadline), with one empty input.
const execute = (deadline = true) =>
  `0x${deadline ? '3593564c' : '24856bc3'}${word(deadline ? 96 : 64)}${word(deadline ? 160 : 128)}${deadline ? word(1000) : ''}${word(1)}00${'0'.repeat(62)}${word(1)}${word(32)}${word(0)}`;

describe('Reviewed protocol destination classification', () => {
  it.each([
    ['617ba037', [addressWord, word(123), addressWord, word(0)], 'supply'],
    ['69328dec', [addressWord, word(123), addressWord], 'withdraw'],
    ['a415bcad', [addressWord, word(123), word(2), word(0), addressWord], 'borrow'],
    ['573ade81', [addressWord, word(123), word(2), addressWord], 'repay'],
    ['00a718a9', [addressWord, addressWord, addressWord, word(123), word(1)], 'liquidation'],
  ])(
    'classifies the requested Aave %s operation without claiming success',
    (selector, words, operation) => {
      const input = `0x${selector}${(words as string[]).join('')}`;
      expect(aave(input)).toEqual([{ protocolId: 'aave', operation, evidence: 'call' }]);
      expect(aave(input.slice(0, -2))).toEqual([
        { protocolId: 'aave', operation: 'interaction', evidence: 'call' },
      ]);
      expect(aave(`${input}00`)?.[0]?.operation).toBe('interaction');
    },
  );

  it('requires canonical address, uint16 and boolean argument shapes', () => {
    for (const input of [
      `0x617ba037${'1'.repeat(64)}${word(123)}${addressWord}${word(0)}`,
      `0x617ba037${addressWord}${word(123)}${addressWord}${word(65_536)}`,
      `0x00a718a9${addressWord}${addressWord}${addressWord}${word(123)}${word(2)}`,
      `0x617ba037${addressWord}${'z'.repeat(64)}${addressWord}${word(0)}`,
      '0x',
      '0x617ba037',
      `0x${'00'.repeat(262_145)}`,
    ])
      expect(aave(input)?.[0]).toMatchObject({ operation: 'interaction', evidence: 'call' });
  });

  it('identifies every reviewed router version and casing, while excluding unrelated calls', () => {
    for (const to of PROTOCOL_CONTRACTS.uniswap.addresses) {
      expect(ethereumProtocolCall(tx(to, execute()))).toEqual([
        { protocolId: 'uniswap', operation: 'execute', evidence: 'call' },
      ]);
      expect(
        ethereumProtocolCall(tx(`0x${to.slice(2).toUpperCase()}`, '0x'))?.[0]?.protocolId,
      ).toBe('uniswap');
    }
    for (const to of [null, address, '0x76D631990d505E4e5b432EEDB852A60897824D68'])
      expect(ethereumProtocolCall(tx(to, execute()))).toBeUndefined();
    expect(
      ethereumProtocolCall(
        tx(`0x${PROTOCOL_CONTRACTS.aave.addresses[0]!.slice(2).toUpperCase()}`, '0x'),
      )?.[0]?.protocolId,
    ).toBe('aave');
  });

  it('recognizes well-formed execute containers with or without a deadline without calling them swaps', () => {
    expect(router(execute())?.[0]?.operation).toBe('execute');
    expect(router(execute(false))?.[0]?.operation).toBe('execute');
    // Empty command sets are legal containers and still do not establish an exchange.
    expect(router(`0x24856bc3${word(64)}${word(96)}${word(0)}${word(0)}`)?.[0]?.operation).toBe(
      'execute',
    );
  });

  it.each([
    '0x',
    '0x3593564c',
    execute().slice(0, -2),
    `${execute()}00`,
    execute().replace(word(96), word(128)),
    `0x3593564c${word(96)}${word(160)}${word(1000)}${word(1n << 255n)}`,
    `0x24856bc3${word(64)}${word(128)}${word(1)}00${'0'.repeat(62)}${word(2)}${word(64)}${word(96)}${word(0)}${word(0)}`,
    execute().slice(0, -128) + word(1n << 255n) + word(0),
  ])('keeps invalid command containers as generic router calls: %s', (input) => {
    expect(() => router(input)).not.toThrow();
    expect(router(input)).toEqual([
      { protocolId: 'uniswap', operation: 'interaction', evidence: 'call' },
    ]);
  });

  it('counts complete direct destinations uniquely, separately by protocol, including unknown actions', () => {
    const hash = `0x${'b'.repeat(64)}`;
    const reports = ethereumProtocolBlockCalls(
      {
        hash,
        height: 100,
        transactions: [
          { hash: 'tx1', ...tx(PROTOCOL_CONTRACTS.uniswap.addresses[0]!, execute()) },
          { hash: 'TX1', ...tx(PROTOCOL_CONTRACTS.uniswap.addresses[0]!, execute()) },
          { hash: 'tx2', ...tx(PROTOCOL_CONTRACTS.uniswap.addresses[1]!, '0x') },
          { hash: 'tx3', ...tx(PROTOCOL_CONTRACTS.aave.addresses[0]!, '0x') },
          { hash: 'tx4', ...tx(address, execute()) },
        ],
      },
      'Controlled complete block',
      now,
    );
    expect(reports).toEqual([
      {
        protocolId: 'uniswap',
        blockHash: hash,
        blockHeight: 100,
        source: 'Controlled complete block',
        observedAt: now,
        method: 'block-calls',
        transactionCount: 2,
      },
      {
        protocolId: 'aave',
        blockHash: hash,
        blockHeight: 100,
        source: 'Controlled complete block',
        observedAt: now,
        method: 'block-calls',
        transactionCount: 1,
      },
    ]);
    expect(
      ethereumProtocolBlockCalls({ hash, height: 100, transactions: [] }, 'Fixture', now).every(
        (report) => report.transactionCount === 0,
      ),
    ).toBe(true);
    expect(reports.every((report) => !('successful' in report) && !('amount' in report))).toBe(
      true,
    );
  });
});
