import type { PassengerStatusGroup } from './passengerStatus';

export type TransactionBrowserFilter = 'all' | PassengerStatusGroup;

export const TRANSACTION_BROWSER_FILTERS: readonly {
  value: TransactionBrowserFilter;
  label: string;
}[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'current', label: 'Présentes' },
  { value: 'queued', label: 'Différées' },
  { value: 'history', label: 'Historiques' },
  { value: 'confirmed', label: 'Incluses' },
];

/** Hash fragments are literal text, never regular expressions or remote requests. */
export function filterTransactionOptions<T extends { id: string; group: PassengerStatusGroup }>(
  options: readonly T[],
  query: string,
  filter: TransactionBrowserFilter,
): readonly T[] {
  const fragment = query.trim().toLowerCase();
  if (fragment.length > 128) return [];
  if (!fragment && filter === 'all') return options;
  return options.filter(
    (option) =>
      (filter === 'all' || option.group === filter) &&
      (!fragment || option.id.toLowerCase().includes(fragment)),
  );
}
