import { TOKEN_CONTRACTS, type TokenId, type TokenActivity } from '../../shared/tokenContracts';
import type { ProtocolActivity } from '../../shared/protocolContracts';
import { languageTag, type Locale } from '../i18n/locale';

/** Format exact token base units without routing a uint256 quantity through Number. */
export function formatTokenAmount(
  amount: string,
  locale: Locale = 'fr',
  tokenId: TokenId = 'usdt',
): string {
  const units = BigInt(amount);
  const decimals = TOKEN_CONTRACTS[tokenId].decimals;
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
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

export function protocolActivityLabel(activity: ProtocolActivity, locale: Locale): string {
  const labels = {
    interaction: ['Appel au contrat', 'Contract call'],
    execute: ['Instructions au routeur', 'Router instructions'],
    supply: ['Demande de dépôt', 'Supply request'],
    withdraw: ['Demande de retrait', 'Withdrawal request'],
    borrow: ['Demande d’emprunt', 'Borrow request'],
    repay: ['Demande de remboursement', 'Repayment request'],
    liquidation: ['Demande de liquidation', 'Liquidation request'],
  } as const;
  const label = labels[activity.operation][locale === 'fr' ? 0 : 1];
  return activity.evidence === 'demo'
    ? `${label} · ${locale === 'fr' ? 'simulé' : 'simulated'}`
    : label;
}
