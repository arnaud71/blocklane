import { memo, useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../shared/model';
import {
  formatMedianTransactionFee,
  medianTransactionFee,
  medianTransactionFeeNote,
  medianTransactionFeeScopeLabel,
  usdQuoteNote,
  type FeeDisplayUnit,
} from '../lib/feeDisplay';
import { number } from '../lib/format';
import { useProviderMempool, useUsableUsdQuote } from '../hooks/useSourceFreshness';
import { latestBlockValueDisplay } from '../lib/blockValueDisplay';
import { candidateComparisonDisplay } from '../lib/candidateComparisonDisplay';
import { activeBitcoinBlockTemplate } from '../lib/passengerMotion';
import type { SceneActivity } from './InfoPanel';
import { Icon } from './Icon';
import { providerFlowDisplay } from '../lib/poolFlowDisplay';
import './InfoBillboard.css';

type InfoBillboardProps = {
  snapshot: Snapshot;
  activity: SceneActivity;
  paused: boolean;
  reducedMotion: boolean;
  selected: boolean;
  feeDisplayUnit: FeeDisplayUnit;
  theme: 'heg' | 'neutral';
  top?: boolean;
};

const pages = ['Mempool', 'Frais', 'Bloc', 'Valeur', 'Voyageurs'] as const;
const bitcoinPages = [...pages, 'Comparaison', 'Flux'] as const;
const ethereumPages = [...pages, 'Flux'] as const;

type BillboardPage = {
  value: string;
  unit: string;
  label: string;
  lines: string[];
  note: string;
  estimated?: boolean;
  smallValue?: boolean;
};

export const InfoBillboard = memo(function InfoBillboard({
  snapshot,
  activity,
  paused,
  reducedMotion,
  selected,
  feeDisplayUnit,
  theme,
  top = true,
}: InfoBillboardProps) {
  const bitcoin = snapshot.chain === 'bitcoin';
  const pageLabels = bitcoin ? bitcoinPages : ethereumPages;
  const pageCount = pageLabels.length;
  const [page, setPage] = useState(0);
  const pageIndex = page < pageCount ? page : 0;
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const rotating =
    rotationEnabled &&
    !paused &&
    !reducedMotion &&
    !selected &&
    snapshot.status === 'ok' &&
    visible;

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pageCount), 4_000);
    return () => window.clearInterval(timer);
  }, [rotating, pageCount]);

  const chainName = bitcoin ? 'Bitcoin' : 'Ethereum';
  const demo = snapshot.mode === 'demo';
  const mempool = useProviderMempool(snapshot);
  const sampleSize = snapshot.transactions.filter((tx) => tx.status === 'pending').length;
  const median = useMemo(() => medianTransactionFee(snapshot), [snapshot]);
  const nodeTemplate = activeBitcoinBlockTemplate(snapshot);
  const completeFees = median.scope === 'template';
  const feeObservedAt = completeFees
    ? nodeTemplate?.observedAt
    : snapshot.bitcoinArrivals
      ? snapshot.observedAt
      : (snapshot.sampling?.observedAt ??
        snapshot.blockTemplate?.observedAt ??
        snapshot.observedAt);
  const quote = demo ? undefined : snapshot.usdQuote;
  const usableQuote = useUsableUsdQuote(quote);
  const feeAmount = formatMedianTransactionFee(snapshot.chain, median, feeDisplayUnit, quote);
  const feeParts = feeAmount.match(/^(≈\s*)?(.+?)\s(BTC|ETH|\$ US)$/);
  const latest = snapshot.status === 'unavailable' ? undefined : snapshot.blocks[0];
  const blockValue = latestBlockValueDisplay(snapshot);
  const comparison = useMemo(() => candidateComparisonDisplay(snapshot), [snapshot]);
  const comparisonPage = pageLabels[pageIndex] === 'Comparaison';
  const flowPage = pageLabels[pageIndex] === 'Flux';
  const flow = providerFlowDisplay(snapshot);
  const flowRates = flow.history.map(
    (point) => (point.enteredCount * 1_000) / (point.observedAt - point.fromObservedAt),
  );
  const maxFlowRate = Math.max(1, ...flowRates);
  const flowEnd = flow.history.at(-1)?.observedAt ?? 0;
  const flowPath = flow.history
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${5 + ((point.observedAt - flowEnd + 60_000) * 150) / 60_000},${26 - (flowRates[index]! * 22) / maxFlowRate}`,
    )
    .join(' ');
  const sourceLabel = demo
    ? 'Simulation'
    : snapshot.status === 'ok'
      ? 'Direct'
      : snapshot.status === 'stale'
        ? 'Ancien relevé'
        : 'Indisponible';

  const information: [BillboardPage, ...BillboardPage[]] = [
    {
      value: number(mempool.total),
      unit: mempool.total === null ? '' : 'transactions',
      label: mempool.total === null ? 'Compteur non fourni' : 'Mempool du fournisseur',
      lines:
        mempool.pending !== null && mempool.queued !== null
          ? [`Pending : ${number(mempool.pending)}`, `Queued : ${number(mempool.queued)}`]
          : [`Échantillon : ${number(sampleSize)} tx`],
      note: mempool.note,
    },
    {
      value: feeParts?.[2] ?? feeAmount,
      unit: feeParts?.[3] ?? '',
      label: 'Frais médians / tx',
      lines: [
        medianTransactionFeeScopeLabel(median),
        feeDisplayUnit === 'usd' && !usableQuote
          ? 'Cours indisponible'
          : completeFees
            ? 'Proposition hors coinbase'
            : bitcoin
              ? 'Coût estimé'
              : 'Limite de gas déclarée',
      ],
      note: `${medianTransactionFeeNote(snapshot.chain, median.sampleSize, demo, median.scope)}${
        feeObservedAt === undefined
          ? ''
          : ` Relevé à ${new Date(feeObservedAt).toLocaleTimeString('fr-CH')}.`
      }${completeFees && nodeTemplate ? ` Source : ${nodeTemplate.source}.` : ''}${
        nodeTemplate && !completeFees
          ? ' Médiane complète non fournie : calcul sur les seuls détails reçus.'
          : ''
      }${feeDisplayUnit === 'usd' ? ` ${usdQuoteNote(quote, demo)}` : ''}`,
      estimated: feeParts?.[1] !== undefined,
      smallValue: feeDisplayUnit === 'native',
    },
    {
      value: latest?.height.toString() ?? '—',
      unit: 'numéro du bloc',
      label: demo ? 'Bloc simulé' : 'Dernier bloc observé',
      lines: latest
        ? [
            `${number(latest.txCount)} transactions`,
            `Occupation : ${number((latest.used / latest.capacity) * 100, 1)} %`,
          ]
        : ['Aucun bloc disponible'],
      note: demo
        ? 'Bloc synthétique de démonstration.'
        : 'Dernier bloc reçu de la source. Observé ne signifie pas finalisé ; le prochain départ n’a pas d’échéance garantie.',
    },
    {
      value: blockValue.value,
      unit: blockValue.unit,
      label: blockValue.label,
      lines: blockValue.available
        ? [
            blockValue.usd ?? 'Conversion $ indisponible',
            bitcoin ? 'Hors coinbase · rendu inclus' : 'Hors tokens · hors internes',
          ]
        : [demo ? 'Total réel non simulé' : 'Total non fourni'],
      note: blockValue.note,
      estimated: blockValue.approximate,
    },
    {
      value: number(activity.boarded),
      unit: 'à bord',
      label: 'Voyageurs visibles',
      lines: [
        `${number(activity.walking)} vers le wagon`,
        `${number(activity.waiting)} sur le quai`,
      ],
      note: nodeTemplate
        ? `Comptage des voyageurs individuels de la scène uniquement, avec jusqu’à ${number(sampleSize)} détails reçus. Le candidat complet propose ${number(nodeTemplate.transactionCount)} transactions hors coinbase ; le second wagon reste une estimation. Une place à bord ne prouve aucune inclusion.`
        : 'Comptage des voyageurs de la scène uniquement. Les deux wagons projettent les prochains blocs ; une place à bord ne prouve aucune inclusion.',
    },
  ];
  if (bitcoin)
    information.push({
      value: comparison.value,
      unit: comparison.available
        ? `${comparison.candidateShare === null ? 'part indéfinie' : '% du candidat'} · #${number(comparison.comparison.blockHeight)}`
        : '',
      label: comparison.available ? 'Candidat retrouvé' : 'En attente d’un bilan',
      lines: ['Candidat préalable', 'et bloc vérifié nécessaires'],
      note: comparison.note,
    });
  information.push({
    value: flow.value,
    unit: flow.interval,
    label: flow.label,
    lines:
      flow.state === 'ready'
        ? [flow.average]
        : [
            snapshot.eventFlow
              ? 'En attente de données mesurées'
              : flow.state === 'warming'
                ? 'Second relevé nécessaire'
                : 'Inventaires complets requis',
          ],
    note: flow.note,
  });
  const current = information[pageIndex] ?? information[0];
  const valueSize = current.smallValue
    ? 'tiny'
    : current.value.length > 10
      ? 'tiny'
      : current.value.length > 6
        ? 'long'
        : 'large';

  return (
    <section
      className={`info-billboard info-billboard--${snapshot.chain}${top ? ' info-billboard--top' : ''}${!rotating || reducedMotion ? ' info-billboard--still' : ''}`}
      aria-label={`Panneau d’informations ${chainName}`}
      data-page={pageLabels[pageIndex]}
      data-auto-rotating={rotating}
      data-status={snapshot.status}
      data-fee-scope={median.scope ?? 'sample'}
      data-comparison-available={comparison.available}
      data-comparison-scope={comparison.available ? 'complete' : undefined}
      data-flow-state={flow.state}
      data-flow-kind={flow.kind}
    >
      <header className="info-billboard-header">
        <span>{theme === 'heg' ? 'HEG' : 'INFO'}</span>
        <span>{bitcoin ? 'BTC' : 'ETH'}</span>
      </header>
      <div className="info-billboard-screen" key={pageIndex} title={current.note}>
        <p className="info-billboard-page">{pageLabels[pageIndex]}</p>
        {flowPage && <p className="info-billboard-flow-kind">{flow.kindLabel}</p>}
        <p className={`info-billboard-value info-billboard-value--${valueSize}`}>
          {current.estimated && <span className="info-billboard-estimate">≈ </span>}
          {current.value}
        </p>
        {current.unit && <p className="info-billboard-unit">{current.unit}</p>}
        <h3 className="info-billboard-label">{current.label}</h3>
        {flowPage ? (
          <div className="info-billboard-flow">
            <p>{current.lines[0]}</p>
            {flow.state === 'ready' && (
              <svg
                viewBox="0 0 160 30"
                role="img"
                aria-label={
                  flow.kind === 'events' && !bitcoin
                    ? 'Débit moyen des notifications pending du fournisseur, historique d’environ une minute'
                    : 'Débit moyen des ajouts observés du fournisseur, historique d’environ une minute'
                }
                data-flow-history-count={flow.history.length}
              >
                <path className="info-billboard-flow-baseline" d="M5 26H155" />
                <path className="info-billboard-flow-line" d={flowPath} />
                {flow.history.map((point, index) => (
                  <circle
                    key={point.observedAt}
                    cx={5 + ((point.observedAt - flowEnd + 60_000) * 150) / 60_000}
                    cy={26 - (flowRates[index]! * 22) / maxFlowRate}
                    r="2"
                  />
                ))}
              </svg>
            )}
            <span className="visually-hidden">{flow.note}</span>
          </div>
        ) : comparisonPage && comparison.available ? (
          <div className="info-billboard-comparison">
            <p className="info-comparison-scope">Complet · hors coinbase</p>
            <dl className="info-comparison-counts">
              {comparison.categories.map((category) => (
                <div
                  key={category.key}
                  data-comparison-category={category.key}
                  data-count={category.count}
                  title={category.label}
                >
                  <dt>
                    <span aria-hidden="true">{category.shortLabel}</span>
                    <span className="visually-hidden">{category.label}</span>
                  </dt>
                  <dd>{number(category.count)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="info-billboard-lines">
            {current.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>
      <div className="info-billboard-footer">
        <nav className="info-billboard-navigation" aria-label={`Rubriques ${chainName}`}>
          {pageLabels.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={`Afficher ${label.toLowerCase()} · ${chainName}`}
              aria-pressed={pageIndex === index}
              title={label}
              onClick={() => {
                setPage(index);
                setRotationEnabled(false);
              }}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </nav>
        <button
          className="info-billboard-rotation"
          type="button"
          aria-label={`${rotationEnabled ? 'Arrêter' : 'Activer'} le défilement du panneau ${chainName}`}
          aria-pressed={rotationEnabled}
          title={rotationEnabled ? 'Arrêter le défilement' : 'Défiler toutes les 4 secondes'}
          onClick={() => setRotationEnabled((enabled) => !enabled)}
        >
          <Icon name={rotationEnabled ? 'pause' : 'play'} size={12} />
          <span>{rotating ? '4 s' : rotationEnabled ? 'Pause' : 'Fixe'}</span>
        </button>
      </div>
      <p
        className="info-billboard-source"
        title={flowPage ? flow.note : comparisonPage ? comparison.note : undefined}
      >
        <i aria-hidden="true" />{' '}
        {flowPage ? (
          flow.source && flow.observedAt !== null ? (
            <>
              <time dateTime={new Date(flow.observedAt).toISOString()}>
                {new Date(flow.observedAt).toLocaleTimeString('fr-CH')}
              </time>{' '}
              · {flow.source}
            </>
          ) : (
            sourceLabel
          )
        ) : comparisonPage && comparison.available ? (
          <>
            {comparison.stale ? 'Ancien bilan conservé · ' : ''}
            {comparison.comparison.candidateSource} ·{' '}
            <time dateTime={new Date(comparison.comparison.candidateObservedAt).toISOString()}>
              {new Date(comparison.comparison.candidateObservedAt).toLocaleTimeString('fr-CH')}
            </time>
          </>
        ) : (
          <>
            {sourceLabel}
            {pageIndex === 0 && mempool.status === 'stale' ? ' · compteur ancien' : ''}
            {pageIndex === 1 && feeDisplayUnit === 'usd' && usableQuote && quote?.status === 'stale'
              ? ' · cours conservé'
              : ''}
          </>
        )}
      </p>
    </section>
  );
});
