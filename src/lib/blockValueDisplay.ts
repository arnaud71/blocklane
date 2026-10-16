import { languageTag, translate, type Locale } from '../i18n/locale';
import type { Snapshot } from '../../shared/model';
import { hasUsableUsdQuote, usdQuoteNote } from './feeDisplay';

export type BlockValueDisplay = {
  available: boolean;
  value: string;
  unit: 'BTC' | 'ETH';
  approximate: boolean;
  usd: string | null;
  label: string;
  note: string;
};

const integerFormatters = {
  fr: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
};

function nativeValue(amount: bigint, decimals: number, locale: Locale) {
  const integerFormatter = integerFormatters[locale];
  const separator = locale === 'fr' ? ',' : '.';
  const denomination = 10n ** BigInt(decimals);
  const whole = amount / denomination;
  const fraction = (amount % denomination).toString().padStart(decimals, '0');
  const exact = `${integerFormatter.format(whole)}${
    amount % denomination === 0n ? '' : `${separator}${fraction.replace(/0+$/, '')}`
  }`;
  if (whole >= 1_000_000_000n) {
    return {
      value: new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : languageTag(locale), {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(whole),
      exact,
      approximate: true,
    };
  }
  const firstNonzero = fraction.search(/[1-9]/);
  const precision =
    whole > 0n
      ? Math.min(4, decimals)
      : firstNonzero < 0
        ? 0
        : Math.min(decimals, firstNonzero + 3);
  const roundingUnit = 10n ** BigInt(decimals - precision);
  const rounded = (amount + roundingUnit / 2n) / roundingUnit;
  const scale = 10n ** BigInt(precision);
  const displayedFraction =
    precision === 0 ? '' : (rounded % scale).toString().padStart(precision, '0').replace(/0+$/, '');
  return {
    value: `${integerFormatter.format(rounded / scale)}${displayedFraction ? `${separator}${displayedFraction}` : ''}`,
    exact,
    approximate: rounded * roundingUnit !== amount,
  };
}

/** Exact smallest-unit totals remain strings/BigInt; only the approximate market conversion uses Number. */
export function latestBlockValueDisplay(
  snapshot: Snapshot | null,
  locale: Locale = 'fr',
): BlockValueDisplay {
  const bitcoin = snapshot?.chain !== 'ethereum';
  const unit = bitcoin ? 'BTC' : 'ETH';
  const label = bitcoin
    ? translate(locale, 'Valeur des sorties', 'Output value')
    : translate(locale, 'Valeur ETH déclarée', 'Declared ETH value');
  const missing: BlockValueDisplay = {
    available: false,
    value: '—',
    unit,
    approximate: false,
    usd: null,
    label,
    note:
      snapshot?.mode === 'demo'
        ? translate(
            locale,
            'Démonstration : aucun montant réel du dernier bloc n’est fourni.',
            'Demo: no real value is provided for the latest block.',
          )
        : translate(
            locale,
            'La source ne fournit aucun total validé pour le dernier bloc reçu. Une somme de l’échantillon ne le remplace pas.',
            'The source provides no validated total for the latest received block. A sample sum is not a substitute.',
          ),
  };
  const block = snapshot?.blocks[0];
  const total = snapshot?.latestBlockValue;
  if (
    !snapshot ||
    snapshot.mode !== 'live' ||
    snapshot.status === 'unavailable' ||
    !block ||
    !total ||
    !/^(?:0|[1-9][0-9]{0,82})$/.test(total.amount) ||
    total.blockHash.toLowerCase() !== block.hash.toLowerCase() ||
    total.blockHeight !== block.height ||
    total.transactionCount !== block.txCount ||
    total.unit !== (bitcoin ? 'sat' : 'wei') ||
    total.method !== (bitcoin ? 'bitcoin-output-sum' : 'ethereum-transaction-value-sum')
  )
    return missing;

  const decimals = bitcoin ? 8 : 18;
  const amount = BigInt(total.amount);
  const displayed = nativeValue(amount, decimals, locale);
  const quote = snapshot.usdQuote;
  let usd: string | null = null;
  if (hasUsableUsdQuote(quote)) {
    const converted = (Number(total.amount) / 10 ** decimals) * quote.usdPerCoin;
    if (Number.isFinite(converted) && converted >= 0) {
      usd =
        (converted > 0 && converted < 0.00000001) || (converted === 0 && amount > 0n)
          ? translate(locale, '≈ < 0,00000001 $ US', '≈ < 0.00000001 USD')
          : `≈ ${new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : languageTag(locale), {
              ...(converted >= 1_000_000_000 ? { notation: 'compact' as const } : {}),
              minimumFractionDigits: 2,
              maximumFractionDigits:
                converted > 0 && converted < 0.01
                  ? Math.min(8, 2 - Math.floor(Math.log10(converted)))
                  : 2,
            }).format(converted)} ${translate(locale, '$ US', 'USD')}`;
    }
  }
  return {
    available: true,
    value: displayed.value,
    unit,
    approximate: displayed.approximate,
    usd,
    label,
    note:
      locale === 'en'
        ? `Block #${block.height}: ${displayed.exact} ${unit}. ${bitcoin ? 'Sum of all non-coinbase transaction outputs, including change; this is not net economic volume.' : 'Sum of the declared ETH value fields of all block transactions, excluding fees, tokens and internal transfers. Failed calls may declare a value without executing a transfer.'} Exact integer received: ${total.amount} ${total.unit}. ${usdQuoteNote(quote, false, locale)}`
        : `Bloc #${block.height} : ${displayed.exact} ${unit}. ${
            bitcoin
              ? 'Somme des sorties de toutes les transactions hors coinbase, monnaie rendue comprise ; ce n’est pas un volume économique net.'
              : 'Somme des value ETH déclarés par toutes les transactions du bloc, hors frais, tokens et transferts internes. Des appels échoués peuvent porter une valeur déclarée sans transfert exécuté.'
          } Montant entier reçu : ${total.amount} ${total.unit}. ${usdQuoteNote(quote)}`,
  };
}
