import { languageTag, useI18n } from '../i18n';
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

const englishPageLabels: Record<string, string> = {
  Mempool: 'Mempool',
  Frais: 'Fees',
  Bloc: 'Block',
  Valeur: 'Value',
  Voyageurs: 'Travelers',
  Comparaison: 'Comparison',
  Flux: 'Flow',
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
  const { locale, t } = useI18n();
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const bitcoin = snapshot.chain === 'bitcoin';
  const pageLabels = bitcoin ? bitcoinPages : ethereumPages;
  const pageCount = pageLabels.length;
  const pageLabel = (label: string) => t(label, englishPageLabels[label] ?? label);
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
  const feeAmount = formatMedianTransactionFee(
    snapshot.chain,
    median,
    feeDisplayUnit,
    quote,
    locale,
  );
  const feeParts = feeAmount.match(/^(≈\s*)?(.+?)\s(BTC|ETH|\$ US|USD)$/);
  const latest = snapshot.status === 'unavailable' ? undefined : snapshot.blocks[0];
  const blockValue = latestBlockValueDisplay(snapshot, locale);
  const comparison = useMemo(
    () => candidateComparisonDisplay(snapshot, locale),
    [snapshot, locale],
  );
  // Page identifiers stay stable; only their visible labels are localized.
  const comparisonPage = pageLabels[pageIndex] === 'Comparaison';
  const flowPage = pageLabels[pageIndex] === 'Flux';
  const flow = providerFlowDisplay(snapshot, Date.now(), locale);
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
    ? t('Simulation', 'Simulation')
    : snapshot.status === 'ok'
      ? t('Direct', 'Live')
      : snapshot.status === 'stale'
        ? t('Ancien relevé', 'Old observation')
        : t('Indisponible', 'Unavailable');

  const information: [BillboardPage, ...BillboardPage[]] = [
    {
      value: n(mempool.total),
      unit: mempool.total === null ? '' : 'transactions',
      label:
        mempool.total === null
          ? t('Compteur non fourni', 'Count not provided')
          : t('Mempool du fournisseur', 'Provider mempool'),
      lines:
        mempool.pending !== null && mempool.queued !== null
          ? [
              t(`Pending : ${n(mempool.pending)}`, `Pending: ${n(mempool.pending)}`),
              t(`Queued : ${n(mempool.queued)}`, `Queued: ${n(mempool.queued)}`),
            ]
          : [t(`Échantillon : ${n(sampleSize)} tx`, `Sample: ${n(sampleSize)} tx`)],
      note: mempool.note,
    },
    {
      value: feeParts?.[2] ?? feeAmount,
      unit: feeParts?.[3] ?? '',
      label: t('Frais médians / tx', 'Median fees / tx'),
      lines: [
        medianTransactionFeeScopeLabel(median, locale),
        feeDisplayUnit === 'usd' && !usableQuote
          ? t('Cours indisponible', 'Exchange rate unavailable')
          : completeFees
            ? t('Proposition hors coinbase', 'Proposal excluding coinbase')
            : bitcoin
              ? t('Coût estimé', 'Estimated cost')
              : t('Limite de gas déclarée', 'Declared gas limit'),
      ],
      note: `${medianTransactionFeeNote(snapshot.chain, median.sampleSize, demo, median.scope, locale)}${
        feeObservedAt === undefined
          ? ''
          : t(
              ` Relevé à ${new Date(feeObservedAt).toLocaleTimeString(languageTag(locale))}.`,
              ` Observed at ${new Date(feeObservedAt).toLocaleTimeString(languageTag(locale))}.`,
            )
      }${completeFees && nodeTemplate ? t(` Source : ${nodeTemplate.source}.`, ` Source: ${nodeTemplate.source}.`) : ''}${
        nodeTemplate && !completeFees
          ? t(
              ' Médiane complète non fournie : calcul sur les seuls détails reçus.',
              ' Complete median not provided: calculated from received details only.',
            )
          : ''
      }${feeDisplayUnit === 'usd' ? ` ${usdQuoteNote(quote, demo, locale)}` : ''}`,
      estimated: feeParts?.[1] !== undefined,
      smallValue: feeDisplayUnit === 'native',
    },
    {
      value: latest?.height.toString() ?? '—',
      unit: t('numéro du bloc', 'block number'),
      label: demo
        ? t('Bloc simulé', 'Simulated block')
        : t('Dernier bloc observé', 'Latest observed block'),
      lines: latest
        ? [
            `${n(latest.txCount)} transactions`,
            t(
              `Occupation : ${n((latest.used / latest.capacity) * 100, 1)} %`,
              `Capacity used: ${n((latest.used / latest.capacity) * 100, 1)}%`,
            ),
          ]
        : [t('Aucun bloc disponible', 'No block available')],
      note: demo
        ? t('Bloc synthétique de démonstration.', 'Synthetic demo block.')
        : t(
            'Dernier bloc reçu de la source. Observé ne signifie pas finalisé ; le prochain départ n’a pas d’échéance garantie.',
            'Latest block received from the source. Observed does not mean finalized; there is no guaranteed deadline for the next departure.',
          ),
    },
    {
      value: blockValue.value,
      unit: blockValue.unit,
      label: blockValue.label,
      lines: blockValue.available
        ? [
            blockValue.usd ?? t('Conversion $ indisponible', 'USD conversion unavailable'),
            bitcoin
              ? t('Hors coinbase · rendu inclus', 'Excludes coinbase · includes change')
              : t('Hors tokens · hors internes', 'Excludes tokens · internal transfers'),
          ]
        : [
            demo
              ? t('Total réel non simulé', 'Real total not simulated')
              : t('Total non fourni', 'Total not provided'),
          ],
      note: blockValue.note,
      estimated: blockValue.approximate,
    },
    {
      value: n(activity.boarded),
      unit: t('à bord', 'on board'),
      label: t('Voyageurs visibles', 'Visible travelers'),
      lines: [
        t(`${n(activity.walking)} vers le wagon`, `${n(activity.walking)} heading to wagon`),
        t(`${n(activity.waiting)} sur le quai`, `${n(activity.waiting)} on platform`),
      ],
      note: nodeTemplate
        ? t(
            `Comptage des voyageurs individuels de la scène uniquement, avec jusqu’à ${n(sampleSize)} détails reçus. Le candidat complet propose ${n(nodeTemplate.transactionCount)} transactions hors coinbase ; le second wagon reste une estimation. Une place à bord ne prouve aucune inclusion.`,
            `Counts individual travelers in the scene only, with up to ${n(sampleSize)} received details. The complete candidate proposes ${n(nodeTemplate.transactionCount)} transactions excluding coinbase; the second wagon remains an estimate. A place on board proves no inclusion.`,
          )
        : t(
            'Comptage des voyageurs de la scène uniquement. Les deux wagons projettent les prochains blocs ; une place à bord ne prouve aucune inclusion.',
            'Counts only travelers in the scene. Both wagons project future blocks; a place on board proves no inclusion.',
          ),
    },
  ];
  if (bitcoin)
    information.push({
      value: comparison.value,
      unit: comparison.available
        ? `${comparison.candidateShare === null ? t('part indéfinie', 'undefined share') : t('% du candidat', '% of candidate')} · #${n(comparison.comparison.blockHeight)}`
        : '',
      label: comparison.available
        ? t('Candidat retrouvé', 'Candidate matched')
        : t('En attente d’un bilan', 'Waiting for comparison'),
      lines: [
        t('Candidat préalable', 'Previous candidate'),
        t('et bloc vérifié nécessaires', 'and verified block required'),
      ],
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
              ? t('En attente de données mesurées', 'Waiting for measured data')
              : flow.state === 'warming'
                ? t('Second relevé nécessaire', 'Second observation required')
                : t('Inventaires complets requis', 'Complete inventories required'),
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
      aria-label={t(`Panneau d’informations ${chainName}`, `${chainName} information board`)}
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
        <p className="info-billboard-page">{pageLabel(pageLabels[pageIndex]!)}</p>
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
                    ? t(
                        'Débit moyen des notifications pending du fournisseur, historique d’environ une minute',
                        'Average rate of the provider’s pending notifications, approximately one minute of history',
                      )
                    : t(
                        'Débit moyen des ajouts observés du fournisseur, historique d’environ une minute',
                        'Average rate of additions observed by the provider, approximately one minute of history',
                      )
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
            <p className="info-comparison-scope">
              {t('Complet · hors coinbase', 'Complete · excluding coinbase')}
            </p>
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
                  <dd>{n(category.count)}</dd>
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
        <nav
          className="info-billboard-navigation"
          aria-label={t(`Rubriques ${chainName}`, `${chainName} sections`)}
        >
          {pageLabels.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={t(
                `Afficher ${label.toLowerCase()} · ${chainName}`,
                `Show ${pageLabel(label).toLowerCase()} · ${chainName}`,
              )}
              aria-pressed={pageIndex === index}
              title={pageLabel(label)}
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
          aria-label={t(
            `${rotationEnabled ? 'Arrêter' : 'Activer'} le défilement du panneau ${chainName}`,
            `${rotationEnabled ? 'Stop' : 'Enable'} rotation of the ${chainName} board`,
          )}
          aria-pressed={rotationEnabled}
          title={
            rotationEnabled
              ? t('Arrêter le défilement', 'Stop rotation')
              : t('Défiler toutes les 4 secondes', 'Rotate every 4 seconds')
          }
          onClick={() => setRotationEnabled((enabled) => !enabled)}
        >
          <Icon name={rotationEnabled ? 'pause' : 'play'} size={12} />
          <span>
            {rotating ? '4 s' : rotationEnabled ? t('Pause', 'Paused') : t('Fixe', 'Pinned')}
          </span>
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
                {new Date(flow.observedAt).toLocaleTimeString(languageTag(locale))}
              </time>{' '}
              · {flow.source}
            </>
          ) : (
            sourceLabel
          )
        ) : comparisonPage && comparison.available ? (
          <>
            {comparison.stale
              ? t('Ancien bilan conservé · ', 'Previous comparison retained · ')
              : ''}
            {comparison.comparison.candidateSource} ·{' '}
            <time dateTime={new Date(comparison.comparison.candidateObservedAt).toISOString()}>
              {new Date(comparison.comparison.candidateObservedAt).toLocaleTimeString(
                languageTag(locale),
              )}
            </time>
          </>
        ) : (
          <>
            {sourceLabel}
            {pageIndex === 0 && mempool.status === 'stale'
              ? t(' · compteur ancien', ' · old count')
              : ''}
            {pageIndex === 1 && feeDisplayUnit === 'usd' && usableQuote && quote?.status === 'stale'
              ? t(' · cours conservé', ' · retained exchange rate')
              : ''}
          </>
        )}
      </p>
    </section>
  );
});
