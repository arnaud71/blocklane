const numberFormatters = new Map<number, Intl.NumberFormat>();
const MAX_NUMBER_FORMATTERS = 32;

export function number(value: number | null, digits = 0): string {
  if (value === null) return '—';
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: digits });
    if (numberFormatters.size >= MAX_NUMBER_FORMATTERS)
      numberFormatters.delete(numberFormatters.keys().next().value!);
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}

export const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;

export function explorerUrl(chain: 'bitcoin' | 'ethereum', hash: string, kind: 'tx' | 'block') {
  const pattern = chain === 'bitcoin' ? /^[0-9a-f]{64}$/i : /^0x[0-9a-f]{64}$/i;
  if (!pattern.test(hash)) return null;
  return chain === 'bitcoin'
    ? `https://mempool.space/${kind}/${hash}`
    : `https://etherscan.io/${kind}/${hash}`;
}
