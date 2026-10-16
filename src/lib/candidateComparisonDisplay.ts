import type { BitcoinCandidateComparison, Snapshot } from '../../shared/model';
import { number } from './format';

export const COMPARISON_CATEGORIES = [
  { key: 'common', field: 'commonCount', label: 'Prévues et incluses', shortLabel: 'Incluses' },
  {
    key: 'candidate-only',
    field: 'candidateOnlyCount',
    label: 'Prévues non incluses dans ce bloc',
    shortLabel: 'Non incluses',
  },
  {
    key: 'block-only',
    field: 'blockOnlyCount',
    label: 'Incluses hors candidat',
    shortLabel: 'Hors candidat',
  },
] as const;

type ComparisonCategory = (typeof COMPARISON_CATEGORIES)[number] & { count: number };
type ComparisonDisplayFields = {
  candidateShare: number | null;
  value: string;
  stale: boolean;
  categories: readonly ComparisonCategory[];
  note: string;
};

export type CandidateComparisonDisplay = ComparisonDisplayFields &
  (
    | { available: false; comparison: null }
    | { available: true; comparison: BitcoinCandidateComparison }
  );

function validDate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

/** Complete server-side sets describe one observed block, independently of the drawn sample. */
export function candidateComparisonDisplay(snapshot: Snapshot | null): CandidateComparisonDisplay {
  const missing: CandidateComparisonDisplay = {
    available: false,
    comparison: null,
    candidateShare: null,
    value: '—',
    stale: false,
    categories: [],
    note:
      snapshot?.mode === 'demo'
        ? 'Démonstration : aucun bilan réel n’est calculé.'
        : 'Un candidat complet préalablement observé et le contenu vérifié du bloc correspondant sont nécessaires. Une absence de bilan ne signifie pas zéro transaction commune.',
  };
  const comparison = snapshot?.candidateComparison;
  const latest = snapshot?.blocks[0];
  const hashPattern = /^[a-fA-F0-9]{64}$/;
  if (
    !snapshot ||
    snapshot.chain !== 'bitcoin' ||
    snapshot.mode !== 'live' ||
    snapshot.status === 'unavailable' ||
    !comparison ||
    comparison.scope !== 'complete' ||
    !latest ||
    !hashPattern.test(comparison.blockHash) ||
    !hashPattern.test(comparison.parentBlockHash) ||
    comparison.blockHash.toLowerCase() !== latest.hash.toLowerCase() ||
    comparison.blockHeight !== latest.height ||
    comparison.blockTransactionCount !== latest.txCount - 1 ||
    !validDate(comparison.candidateObservedAt) ||
    !validDate(comparison.blockObservedAt) ||
    comparison.candidateObservedAt > comparison.blockObservedAt ||
    comparison.blockObservedAt > snapshot.observedAt
  )
    return missing;

  const counts = [
    comparison.candidateTransactionCount,
    comparison.blockTransactionCount,
    comparison.commonCount,
    comparison.candidateOnlyCount,
    comparison.blockOnlyCount,
  ];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0 || count > 30_000) ||
    comparison.commonCount + comparison.candidateOnlyCount !==
      comparison.candidateTransactionCount ||
    comparison.commonCount + comparison.blockOnlyCount !== comparison.blockTransactionCount
  )
    return missing;

  const candidateShare =
    comparison.candidateTransactionCount === 0
      ? null
      : (comparison.commonCount / comparison.candidateTransactionCount) * 100;
  const stale = snapshot.status === 'stale';
  return {
    available: true,
    comparison,
    candidateShare,
    value: candidateShare === null ? '—' : number(candidateShare, 1),
    stale,
    categories: COMPARISON_CATEGORIES.map((category) => ({
      ...category,
      count: comparison[category.field],
    })),
    note: `${stale ? 'Ancien bilan conservé, avec ses dates d’origine. ' : ''}Bilan complet hors coinbase du bloc #${number(comparison.blockHeight)}, indépendant des détails individuels de la scène. Candidat de ${comparison.candidateSource}, relevé le ${new Date(comparison.candidateObservedAt).toLocaleString('fr-CH')}. Bloc vérifié auprès de ${comparison.blockSource}, détecté pour la première fois le ${new Date(comparison.blockObservedAt).toLocaleString('fr-CH')}. ${candidateShare === null ? 'Candidat vide : la part retrouvée n’est pas définie.' : 'Le pourcentage est la part des transactions de ce candidat retrouvées dans ce bloc, pas un score de prédiction.'} Ne pas être incluse dans ce bloc ne prouve pas qu’une transaction est encore en attente. Le mineur peut avoir construit un autre candidat. Ce bilan ne garantit pas la finalité du bloc ; une réorganisation reste possible.`,
  };
}
