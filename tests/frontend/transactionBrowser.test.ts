import { describe, expect, it } from 'vitest';
import {
  filterTransactionOptions,
  TRANSACTION_BROWSER_FILTERS,
} from '../../src/lib/transactionBrowser';
import type { PassengerStatusGroup } from '../../src/lib/passengerStatus';

const options: { id: string; group: PassengerStatusGroup }[] = [
  { id: '0xABcd1234', group: 'current' },
  { id: '0xef001234', group: 'queued' },
  { id: '0xaaaa4321', group: 'history' },
  { id: '0xbbbb1234', group: 'confirmed' },
];

describe('local transaction browser search and filters', () => {
  it('preserves the full list and its identity without active constraints', () => {
    expect(filterTransactionOptions(options, '  ', 'all')).toBe(options);
    expect(options).toHaveLength(4);
  });
  it('matches a full hash or fragment literally, regardless of case and surrounding spaces', () => {
    expect(filterTransactionOptions(options, '  ABcD  ', 'all')).toEqual([options[0]]);
    expect(filterTransactionOptions(options, '0xabcd1234', 'all')).toEqual([options[0]]);
    expect(filterTransactionOptions(options, '1234', 'all')).toEqual([
      options[0],
      options[1],
      options[3],
    ]);
    expect(filterTransactionOptions(options, '.*', 'all')).toEqual([]);
  });
  it.each(['current', 'queued', 'history', 'confirmed'] as const)(
    'selects only %s without changing identities or order',
    (group) => {
      const result = filterTransactionOptions(options, '', group);
      expect(result).toEqual(options.filter((option) => option.group === group));
      expect(result[0]).toBe(options.find((option) => option.group === group));
    },
  );
  it('combines constraints and has no phantom selection when nothing matches', () => {
    expect(filterTransactionOptions(options, 'ABCD', 'history')).toEqual([]);
    expect(filterTransactionOptions(options, '1234', 'queued')).toEqual([options[1]]);
    expect(filterTransactionOptions([], '', 'all')).toEqual([]);
    expect(filterTransactionOptions(options, '1'.repeat(129), 'all')).toEqual([]);
  });
  it('uses the latest status group when an observed transaction leaves the current inventory', () => {
    const changed = options.map((option) =>
      option.id === options[0]!.id ? { ...option, group: 'history' as const } : option,
    );
    expect(filterTransactionOptions(changed, 'abcd', 'current')).toEqual([]);
    expect(filterTransactionOptions(changed, 'abcd', 'history')).toEqual([changed[0]]);
    expect(options[0]?.group).toBe('current');
    expect(TRANSACTION_BROWSER_FILTERS.map((choice) => choice.value)).toEqual([
      'all',
      'current',
      'queued',
      'history',
      'confirmed',
    ]);
  });
});
