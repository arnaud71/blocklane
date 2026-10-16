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
const dollarFormatters = new Map<number, Intl.NumberFormat>();

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

function dollars(amount: number): string {
  if (!validAmount(amount)) return '— $ US';
  if (amount > 0 && amount < MIN_DISPLAYABLE_USD) return '< 0,00000001 $ US';
  const digits = amount === 0 ? 2 : Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(amount))));
  let formatter = dollarFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits,
    });
    dollarFormatters.set(digits, formatter);
  }
  return `${formatter.format(amount)} $ US`;
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

export function medianTransactionFeeScopeLabel(median: MedianTransactionFee): string {
  return `${median.scope === 'template' ? 'Candidat complet' : 'Échantillon'} : ${number(median.sampleSize)} tx`;
}

/** Complete integer-satoshi fees can have a half-satoshi median for an even cohort. */
export function formatMedianTransactionFee(
  chain: ChainId,
  median: MedianTransactionFee,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
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
    return `${number(Number(whole))}${decimals ? `,${decimals}` : ''} BTC`;
  }
  return formatEstimatedFeeAmount(chain, median.nativeAmount, unit, quote);
}

export function formatEstimatedFeeAmount(
  chain: ChainId,
  nativeAmount: number | null,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
): string {
  const coin = chain === 'bitcoin' ? 'BTC' : 'ETH';
  if (!validAmount(nativeAmount)) return unit === 'usd' ? '— $ US' : `— ${coin}`;
  if (unit === 'usd') {
    if (!hasUsableUsdQuote(quote)) return '— $ US';
    const amount = nativeAmount * quote.usdPerCoin;
    if (amount === 0 && nativeAmount > 0) return '≈ < 0,00000001 $ US';
    return validAmount(amount) ? `≈ ${dollars(amount)}` : '— $ US';
  }
  const precisionLimit = chain === 'bitcoin' ? 8 : 12;
  if (nativeAmount > 0 && nativeAmount < 10 ** -precisionLimit) {
    return `≈ < ${number(10 ** -precisionLimit, precisionLimit)} ${coin}`;
  }
  const digits =
    nativeAmount === 0
      ? 0
      : Math.min(precisionLimit, Math.max(0, 2 - Math.floor(Math.log10(nativeAmount))));
  return `≈ ${number(nativeAmount, digits)} ${coin}`;
}

export function medianTransactionFeeNote(
  chain: ChainId,
  sampleSize: number,
  demo = false,
  scope: MedianTransactionFee['scope'] = 'sample',
): string {
  if (scope === 'template')
    return sampleSize === 0
      ? 'Candidat complet du nœud vide, hors coinbase : médiane non mesurée. Une proposition ne prouve aucune inclusion.'
      : `Médiane des frais proposés pour les ${number(sampleSize)} transactions du candidat complet du nœud, hors coinbase. Elle ne décrit ni la médiane du mempool ni des frais confirmés. Cette proposition ne prouve aucune inclusion ni qu’un pool minier la mine.`;
  if (sampleSize === 0) return 'Aucune transaction en attente exploitable dans l’échantillon reçu.';
  if (demo) return `Médiane simulée sur ${sampleSize} transactions en attente fictives.`;
  return `Médiane des coûts estimés de ${sampleSize} transactions en attente de l’échantillon reçu. L’échantillon privilégie les frais élevés et ne représente pas la médiane du réseau. ${
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
): string {
  if (unit === 'native') {
    return `${validAmount(rate) ? number(rate, 3) : '—'} ${chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`;
  }
  const resource = chain === 'bitcoin' ? 'vB' : 'gas';
  if (!validAmount(rate) || !hasUsableUsdQuote(quote)) return `— $ US/${resource}`;
  const denomination = chain === 'bitcoin' ? 100_000_000 : 1_000_000_000;
  const amount = (rate / denomination) * quote.usdPerCoin;
  const converted = amount === 0 && rate > 0 ? '< 0,00000001 $ US' : dollars(amount);
  return `${converted}/${resource}`;
}

export function formatTransactionFee(
  transaction: Tx,
  unit: FeeDisplayUnit,
  quote?: UsdQuote | null,
): string {
  if (unit === 'native') return formatFeeRate(transaction.chain, transaction.feeRate, unit);
  if (
    !hasUsableUsdQuote(quote) ||
    !validAmount(transaction.feeRate) ||
    !validAmount(transaction.size)
  ) {
    return '— $ US';
  }
  const denomination = transaction.chain === 'bitcoin' ? 100_000_000 : 1_000_000_000;
  const estimate = (transaction.feeRate / denomination) * transaction.size * quote.usdPerCoin;
  if (estimate === 0 && transaction.feeRate > 0 && transaction.size > 0) {
    return '≈ < 0,00000001 $ US';
  }
  return validAmount(estimate) ? `≈ ${dollars(estimate)}` : '— $ US';
}

export function usdQuoteNote(quote?: UsdQuote | null, demo = false): string {
  if (demo) return 'Démonstration : conversion en dollars indisponible, aucun cours fictif.';
  if (!hasUsableUsdQuote(quote)) {
    return 'Conversion en dollars indisponible : aucun cours récent valide. Les frais natifs restent consultables.';
  }
  const ageSeconds = Math.max(0, Math.floor((Date.now() - quote.observedAt) / 1_000));
  const age = ageSeconds < 60 ? `${ageSeconds} s` : `${Math.floor(ageSeconds / 60)} min`;
  const time = new Date(quote.observedAt).toLocaleTimeString('fr-CH');
  return `Cours Coinbase${quote.status === 'stale' ? ' conservé' : ''}, relevé à ${time} (il y a ${age}). Conversion au cours relevé, pas au cours historique de confirmation.`;
}
