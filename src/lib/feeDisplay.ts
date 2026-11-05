import { languageTag, translate, type Locale } from '../i18n/locale';
import {
  MAX_TRANSACTIONS,
  type ChainId,
  type Snapshot,
  type Tx,
  type UsdQuote,
} from '../../shared/model';
import { number } from './format';
import { activeBitcoinBlockTemplate } from './passengerMotion';

export type FeeDisplayUnit = 'native' | 'usd';

export type MedianTransactionFee = {
  nativeAmount: number | null;
  sampleSize: number;
  scope?: 'template' | 'sample';
  /** Exact integer or half-integer satoshis supplied for a complete Bitcoin candidate. */
  medianFeeSats?: number | null;
};

export const QUOTE_MAX_AGE_MS = 5 * 60 * 1_000;
const QUOTE_FUTURE_TOLERANCE_MS = 5_000;
const MIN_DISPLAYABLE_USD = 0.00000001;
const dollarFormatters = new Map<string, Intl.NumberFormat>();

export function hasUsableUsdQuote(quote: UsdQuote | null | undefined): quote is UsdQuote {
  if (!quote) return false;
  const now = Date.now();
  return (
    Number.isFinite(quote.usdPerCoin) &&
    quote.usdPerCoin > 0 &&
    quote.usdPerCoin <= 1_000_000_000 &&
    Number.isSafeInteger(quote.observedAt) &&
    quote.observedAt >= 0 &&
    quote.observedAt <= now + QUOTE_FUTURE_TOLERANCE_MS &&
    now - quote.observedAt <= QUOTE_MAX_AGE_MS &&
    quote.source === 'Coinbase' &&
    (quote.status === 'ok' || quote.status === 'stale')
  );
}

function validAmount(amount: number | null): amount is number {
  return amount !== null && Number.isFinite(amount) && amount >= 0;
}

function dollars(amount: number, locale: Locale): string {
  const currency = translate(locale, '$ US', 'USD');
  if (!validAmount(amount)) return `— ${currency}`;
  if (amount > 0 && amount < MIN_DISPLAYABLE_USD)
    return `< ${number(MIN_DISPLAYABLE_USD, 8, locale)} ${currency}`;
  const digits = amount === 0 ? 2 : Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(amount))));
  const key = `${locale}:${digits}`;
  let formatter = dollarFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : languageTag(locale), {
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits,
    });
    dollarFormatters.set(key, formatter);
  }
  return `${formatter.format(amount)} ${currency}`;
}

function estimatedNativeFee(transaction: Tx): number | null {
  if (
    !validAmount(transaction.feeRate) ||
    !validAmount(transaction.size) ||
    transaction.size <= 0
  ) {
    return null;
  }
  const denomination = transaction.chain === 'bitcoin' ? 100_000_000 : 1_000_000_000;
  const amount = (transaction.feeRate / denomination) * transaction.size;
  if (!validAmount(amount) || (amount === 0 && transaction.feeRate > 0)) return null;
  return amount;
}

/** Complete proposed fees when supplied by the node, otherwise only the received pending sample. */
export function medianTransactionFee(snapshot: Snapshot | null): MedianTransactionFee {
  if (!snapshot || snapshot.status === 'unavailable')
    return { nativeAmount: null, sampleSize: 0, scope: 'sample' };
  const template = activeBitcoinBlockTemplate(snapshot);
  if (template && template.medianFeeSats !== undefined) {
    const sats = template.medianFeeSats;
    return {
      nativeAmount:
        template.transactionCount > 0 && validAmount(sats) && Number.isSafeInteger(sats * 2)
          ? sats / 100_000_000
          : null,
      sampleSize: template.transactionCount,
      scope: 'template',
      medianFeeSats: sats,
    };
  }
  const seen = new Set<string>();
  const amounts: number[] = [];
  for (const transaction of snapshot.transactions.slice(0, MAX_TRANSACTIONS)) {
    if (transaction.chain !== snapshot.chain || transaction.status !== 'pending') continue;
    const id = transaction.id.toLowerCase();
    if (seen.has(id)) continue;
    const amount = estimatedNativeFee(transaction);
    if (amount === null) continue;
    seen.add(id);
    amounts.push(amount);
  }
  amounts.sort((a, b) => a - b);
  const middle = Math.floor(amounts.length / 2);
  const upper = amounts[middle];
  if (upper === undefined) return { nativeAmount: null, sampleSize: 0, scope: 'sample' };
  const lower = amounts[middle - 1] ?? upper;
  const nativeAmount = amounts.length % 2 === 0 ? lower + (upper - lower) / 2 : upper;
  return { nativeAmount, sampleSize: amounts.length, scope: 'sample' };
}

export function medianTransactionFeeScopeLabel(
  median: MedianTransactionFee,
  locale: Locale = 'fr',
): string {
  return `${median.scope === 'template' ? translate(locale, 'Candidat complet', 'Complete candidate') : translate(locale, 'Échantillon', 'Sample')}${locale === 'fr' ? ' :' : ':'} ${number(median.sampleSize, 0, locale)} tx`;
}

/** Complete integer-satoshi fees can have a half-satoshi median for an even cohort. */
export function formatMedianTransactionFee(
  chain: ChainId,
  median: MedianTransactionFee,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
  locale: Locale = 'fr',
): string {
  if (
    chain === 'bitcoin' &&
    median.scope === 'template' &&
    unit === 'native' &&
    median.medianFeeSats !== undefined &&
    validAmount(median.medianFeeSats) &&
    Number.isSafeInteger(median.medianFeeSats * 2)
  ) {
    const halfSatoshis = BigInt(median.medianFeeSats * 2);
    const halvesPerCoin = 200_000_000n;
    const whole = halfSatoshis / halvesPerCoin;
    const decimals = ((halfSatoshis % halvesPerCoin) * 5n)
      .toString()
      .padStart(9, '0')
      .replace(/0+$/, '');
    return `${number(Number(whole), 0, locale)}${decimals ? `${locale === 'fr' ? ',' : '.'}${decimals}` : ''} BTC`;
  }
  return formatEstimatedFeeAmount(chain, median.nativeAmount, unit, quote, locale);
}

export function formatEstimatedFeeAmount(
  chain: ChainId,
  nativeAmount: number | null,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
  locale: Locale = 'fr',
): string {
  const coin = chain === 'bitcoin' ? 'BTC' : 'ETH';
  const currency = translate(locale, '$ US', 'USD');
  if (!validAmount(nativeAmount)) return unit === 'usd' ? `— ${currency}` : `— ${coin}`;
  if (unit === 'usd') {
    if (!hasUsableUsdQuote(quote)) return `— ${currency}`;
    const amount = nativeAmount * quote.usdPerCoin;
    if (amount === 0 && nativeAmount > 0)
      return translate(locale, '≈ < 0,00000001 $ US', '≈ < 0.00000001 USD');
    return validAmount(amount) ? `≈ ${dollars(amount, locale)}` : `— ${currency}`;
  }
  const precisionLimit = chain === 'bitcoin' ? 8 : 12;
  if (nativeAmount > 0 && nativeAmount < 10 ** -precisionLimit) {
    return `≈ < ${number(10 ** -precisionLimit, precisionLimit, locale)} ${coin}`;
  }
  const digits =
    nativeAmount === 0
      ? 0
      : Math.min(precisionLimit, Math.max(0, 2 - Math.floor(Math.log10(nativeAmount))));
  return `≈ ${number(nativeAmount, digits, locale)} ${coin}`;
}

export function medianTransactionFeeNote(
  chain: ChainId,
  sampleSize: number,
  demo = false,
  scope: MedianTransactionFee['scope'] = 'sample',
  locale: Locale = 'fr',
): string {
  if (scope === 'template')
    return sampleSize === 0
      ? translate(
          locale,
          'Candidat complet du nœud vide, hors coinbase : médiane non mesurée. Une proposition ne prouve aucune inclusion.',
          'The node’s complete candidate is empty, excluding coinbase: no median was measured. A proposal proves no inclusion.',
        )
      : translate(
          locale,
          `Médiane des frais proposés pour les ${number(sampleSize)} transactions du candidat complet du nœud, hors coinbase. Elle ne décrit ni la médiane du mempool ni des frais confirmés. Cette proposition ne prouve aucune inclusion ni qu’un pool minier la mine.`,
          `Median proposed fees for all ${number(sampleSize, 0, locale)} transactions in the node’s complete candidate, excluding coinbase. This is neither the mempool median nor confirmed fees. This proposal proves no inclusion or that a mining pool is mining it.`,
        );
  if (sampleSize === 0)
    return translate(
      locale,
      'Aucune transaction en attente exploitable dans l’échantillon reçu.',
      'No usable pending transaction in the received sample.',
    );
  if (demo)
    return translate(
      locale,
      `Médiane simulée sur ${sampleSize} transactions en attente fictives.`,
      `Simulated median for ${number(sampleSize, 0, locale)} fictional pending transactions.`,
    );
  if (locale === 'en')
    return `Median estimated costs for ${number(sampleSize, 0, locale)} pending transactions in the received sample. This limited sample does not represent the network median. ${chain === 'bitcoin' ? 'Calculated as each transaction’s observed rate multiplied by its virtual size.' : 'Calculated as each transaction’s observed gas price, including tip, multiplied by its declared gas limit; these are not the fees actually paid.'}`;
  return `Médiane des coûts estimés de ${sampleSize} transactions en attente de l’échantillon reçu. Cet échantillon limité ne représente pas la médiane du réseau. ${
    chain === 'bitcoin'
      ? 'Calcul du taux observé multiplié par la taille virtuelle de chaque transaction.'
      : 'Calcul du prix du gas observé, pourboire compris, multiplié par la limite de gas déclarée de chaque transaction ; ce ne sont pas les frais réellement payés.'
  }`;
}

export function formatFeeRate(
  chain: ChainId,
  rate: number | null,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
  locale: Locale = 'fr',
): string {
  if (unit === 'native') {
    return `${validAmount(rate) ? number(rate, 3, locale) : '—'} ${chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`;
  }
  const resource = chain === 'bitcoin' ? 'vB' : 'gas';
  if (!validAmount(rate) || !hasUsableUsdQuote(quote))
    return `— ${translate(locale, '$ US', 'USD')}/${resource}`;
  const denomination = chain === 'bitcoin' ? 100_000_000 : 1_000_000_000;
  const amount = (rate / denomination) * quote.usdPerCoin;
  const converted =
    amount === 0 && rate > 0
      ? translate(locale, '< 0,00000001 $ US', '< 0.00000001 USD')
      : dollars(amount, locale);
  return `${converted}/${resource}`;
}

export function formatTransactionFee(
  transaction: Tx,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
  locale: Locale = 'fr',
): string {
  if (unit === 'native')
    return formatFeeRate(transaction.chain, transaction.feeRate, unit, undefined, locale);
  if (
    !hasUsableUsdQuote(quote) ||
    !validAmount(transaction.feeRate) ||
    !validAmount(transaction.size)
  ) {
    return translate(locale, '— $ US', '— USD');
  }
  const denomination = transaction.chain === 'bitcoin' ? 100_000_000 : 1_000_000_000;
  const estimate = (transaction.feeRate / denomination) * transaction.size * quote.usdPerCoin;
  if (estimate === 0 && transaction.feeRate > 0 && transaction.size > 0) {
    return translate(locale, '≈ < 0,00000001 $ US', '≈ < 0.00000001 USD');
  }
  return validAmount(estimate)
    ? `≈ ${dollars(estimate, locale)}`
    : translate(locale, '— $ US', '— USD');
}

export function usdQuoteNote(quote?: UsdQuote | null, demo = false, locale: Locale = 'fr'): string {
  if (demo)
    return translate(
      locale,
      'Démonstration : conversion en dollars indisponible, aucun cours fictif.',
      'Demo: dollar conversion is unavailable; no fictional exchange rate is used.',
    );
  if (!hasUsableUsdQuote(quote)) {
    return translate(
      locale,
      'Conversion en dollars indisponible : aucun cours récent valide. Les frais natifs restent consultables.',
      'Dollar conversion unavailable: no valid recent exchange rate. Native fees remain available.',
    );
  }
  const ageSeconds = Math.max(0, Math.floor((Date.now() - quote.observedAt) / 1_000));
  const age = ageSeconds < 60 ? `${ageSeconds} s` : `${Math.floor(ageSeconds / 60)} min`;
  const time = new Date(quote.observedAt).toLocaleTimeString(languageTag(locale));
  if (locale === 'en')
    return `Coinbase rate${quote.status === 'stale' ? ' retained' : ''}, observed at ${time} (${age} ago). Conversion uses the observed rate, not the historical confirmation rate.`;
  return `Cours Coinbase${quote.status === 'stale' ? ' conservé' : ''}, relevé à ${time} (il y a ${age}). Conversion au cours relevé, pas au cours historique de confirmation.`;
}
