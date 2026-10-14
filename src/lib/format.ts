export const number = (value: number | null, digits = 0) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-CH', { maximumFractionDigits: digits }).format(value);

export const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;

export function explorerUrl(chain: 'bitcoin' | 'ethereum', hash: string, kind: 'tx' | 'block') {
  const pattern = chain === 'bitcoin' ? /^[0-9a-f]{64}$/i : /^0x[0-9a-f]{64}$/i;
  if (!pattern.test(hash)) return null;
  return chain === 'bitcoin'
    ? `https://mempool.space/${kind}/${hash}`
    : `https://etherscan.io/${kind}/${hash}`;
}
