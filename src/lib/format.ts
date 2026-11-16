import { languageTag, type Locale } from '../i18n/locale';

const numberFormatters = new Map<string, Intl.NumberFormat>();
const MAX_NUMBER_FORMATTERS = 32;

export function number(value: number | null, digits = 0, locale: Locale = 'fr'): string {
  if (value === null) return '—';
  const key = `${locale}:${digits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(languageTag(locale), { maximumFractionDigits: digits });
    if (numberFormatters.size >= MAX_NUMBER_FORMATTERS)
      numberFormatters.delete(numberFormatters.keys().next().value!);
    numberFormatters.set(key, formatter);
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
