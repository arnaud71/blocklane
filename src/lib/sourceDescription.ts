import type { Snapshot } from '../../shared/model';
import { translate, type Locale } from '../i18n/locale';
import { number } from './format';

export function sourceName(snapshot: Snapshot | null, locale: Locale): string | null {
  if (!snapshot) return null;
  return snapshot.mode === 'demo' && locale === 'en'
    ? 'Educational demo · fictional data'
    : snapshot.source;
}

/** Translate presentation only: provider labels, identifiers, clocks and API payloads stay intact. */
export function sourceCoverage(snapshot: Snapshot | null, locale: Locale): string {
  if (!snapshot) return translate(locale, 'Non disponible', 'Unavailable');
  if (locale === 'fr') return snapshot.coverage;
  if (snapshot.mode === 'demo')
    return 'Explicitly selected educational demo. All transactions and blocks are simulated; no live network coverage is claimed.';
  if (snapshot.status === 'unavailable')
    return 'No recent validated network data are available. Demo mode must be selected explicitly.';
  const parts: string[] = [];
  if (snapshot.status === 'stale')
    parts.push(
      'Last valid observations retained with their original timestamps. These data are stale.',
    );
  const pending = snapshot.transactions.filter((tx) => tx.status === 'pending').length;
  parts.push(`Limited sample: ${number(pending, 0, locale)} pending transaction details.`);
  if (snapshot.bitcoinArrivals)
    parts.push(
      `Mixed sample with ${number(snapshot.bitcoinArrivals.transactionIds.length, 0, locale)} actual recent arrivals from ${snapshot.bitcoinArrivals.source}, supplemented by the candidate or available fallback. This is not a global fee ranking.`,
    );
  if (snapshot.blockTemplate) {
    const candidate = snapshot.blockTemplate;
    parts.push(
      `Complete node candidate from ${candidate.source}, height ${number(candidate.height, 0, locale)}: ${number(candidate.transactionCount, 0, locale)} transactions excluding coinbase, ${number(candidate.weight, 0, locale)} WU. Candidate totals are independent of the limited individual sample. No evidence that a mining pool is mining it.`,
    );
  } else if (snapshot.chain === 'bitcoin')
    parts.push(
      'No fresh node candidate is available. Carriages use an estimate from the available pool, provider projection or recent sample; no global ranking or miner selection is guaranteed.',
    );
  if (snapshot.sampling) {
    const pool = snapshot.sampling;
    parts.push(
      `Local RPC inventory: ${pool.source}, ${number(pool.pendingCount, 0, locale)} pending${pool.method === 'txpool_content' ? ` and ${number(pool.queuedCount, 0, locale)} queued` : ''}. The individual sample and provider count are separate observations.`,
    );
  }
  if (snapshot.chain === 'ethereum')
    parts.push(
      'Ethereum uses effective gas prices and declared gas limits. Queued transactions, nonce dependencies and the projected base fee can delay boarding. A local provider view excludes private transactions and does not describe a worldwide mempool.',
    );
  parts.push(
    `Blocks and recommended fees: ${snapshot.source}. Stream presence, sampled presence and observed inclusion are distinct. Only verified block evidence proves inclusion; disappearance proves no confirmation. Recent inclusion may be reorganized and does not certify finality.`,
  );
  return parts.join(' ');
}

export function sourceMessage(
  snapshot: Snapshot | null,
  error: string | null,
  locale: Locale,
): string {
  if (locale === 'fr')
    return snapshot?.message ?? error ?? 'Connexion aux données publiques du réseau.';
  if (snapshot?.status === 'stale')
    return 'The provider is unavailable or returned invalid data. Last valid observations retain their original timestamps.';
  if (snapshot?.message?.includes('réseau principal Ethereum'))
    return 'The configured Ethereum provider is not connected to Ethereum mainnet. Check the server configuration.';
  if (error || snapshot?.status === 'unavailable')
    return 'The network source is unavailable. The service retries automatically; demo mode remains an explicit choice.';
  return 'Connecting to public network data.';
}
