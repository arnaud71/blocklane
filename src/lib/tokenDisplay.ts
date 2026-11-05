import type { TokenActivity } from '../../shared/tokenContracts';
import { languageTag, type Locale } from '../i18n/locale';

/** Format exact token base units without routing a uint256 quantity through Number. */
export function formatTokenAmount(amount: string, locale: Locale = 'fr'): string {
  const units = BigInt(amount);
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const formatter = new Intl.NumberFormat(languageTag(locale));
  const separator =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  return `${formatter.format(whole)}${fraction ? `${separator}${fraction}` : ''}`;
}

export function tokenActivityLabel(activity: TokenActivity, locale: Locale): string {
  if (activity.operation === 'approval')
    return locale === 'fr' ? 'Autorisation, pas un transfert' : 'Approval, not a transfer';
  if (activity.operation === 'interaction')
    return locale === 'fr' ? 'Interaction avec le contrat' : 'Contract interaction';
  if (activity.evidence === 'demo')
    return locale === 'fr' ? 'Transfert simulé' : 'Simulated transfer';
  return activity.evidence === 'log'
    ? locale === 'fr'
      ? 'Transfert attesté par un journal'
      : 'Transfer evidenced by a log'
    : locale === 'fr'
      ? 'Intention de transfert'
      : 'Transfer intent';
}
