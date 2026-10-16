import { languageTag, useI18n } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { PENDING_SAMPLE_LIMIT, type Snapshot, type Tx } from '../../shared/model';
import { explorerUrl, number, shortHash } from '../lib/format';
import { useProviderMempool, useUsableUsdQuote } from '../hooks/useSourceFreshness';
import { latestBlockValueDisplay } from '../lib/blockValueDisplay';
import { candidateComparisonDisplay } from '../lib/candidateComparisonDisplay';
import {
  formatFeeRate,
  formatMedianTransactionFee,
  formatTransactionFee,
  medianTransactionFee,
  medianTransactionFeeNote,
  medianTransactionFeeScopeLabel,
  usdQuoteNote,
  type FeeDisplayUnit,
} from '../lib/feeDisplay';
import { activeBitcoinBlockTemplate } from '../lib/passengerMotion';
import { bitcoinArrivalObservation, passengerStatus } from '../lib/passengerStatus';
import { sourceName } from '../lib/sourceDescription';
import { Icon } from './Icon';
import './InfoPanel.css';

export type SceneActivity = {
  walking: number;
  boarded: number;
  returning: number;
  waiting: number;
  observed?: number;
  historical?: number;
};

type InfoPanelProps = {
  snapshot: Snapshot | null;
  selectedTx: Tx | null;
  selectedHistorical?: boolean;
  selectedInclusionOnly?: boolean;
  selectedObservedAt?: number;
  selectedPoolState?: 'pending' | 'queued' | 'absent' | 'replaced' | 'unknown';
  selectedPoolObservedAt?: number;
  selectedReasonLabel?: string;
  activity?: SceneActivity;
  paused: boolean;
  reducedMotion?: boolean;
  feeDisplayUnit?: FeeDisplayUnit;
  onClearSelection?: () => void;
  onClose?: () => void;
};

const pages = [
  { label: 'Réseau', english: 'Network', id: 'network' },
  { label: 'Bloc', english: 'Block', id: 'block' },
  { label: 'Voyageurs', english: 'Travelers', id: 'travelers' },
] as const;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="info-detail">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The comparison uses complete server inventories, never the displayed traveller count. */
export function CandidateComparisonDetails({ snapshot }: { snapshot: Snapshot | null }) {
  const { locale, t } = useI18n();
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const display = candidateComparisonDisplay(snapshot, locale);
  const comparedBlockLink = display.available
    ? explorerUrl('bitcoin', display.comparison.blockHash, 'block')
    : null;
  if (snapshot?.chain === 'ethereum') return null;
  return (
    <section
      className="info-candidate-comparison"
      data-testid="candidate-comparison-details"
      data-comparison-available={display.available}
      data-comparison-scope={display.available ? 'complete' : undefined}
      aria-label={t('Comparaison candidat / bloc', 'Candidate / block comparison')}
    >
      <h4>{t('Comparaison candidat / bloc', 'Candidate / block comparison')}</h4>
      {display.available ? (
        <>
          <p className="info-comparison-summary">
            {display.candidateShare === null
              ? t(
                  'Part du candidat non définie : candidat vide.',
                  'Candidate share undefined: empty candidate.',
                )
              : t(
                  `${display.value} % du candidat retrouvé dans ce bloc.`,
                  `${display.value}% of the candidate found in this block.`,
                )}
          </p>
          {display.stale && (
            <p className="info-caution">
              {t(
                'Ancien bilan conservé, avec ses dates d’origine.',
                'Previous comparison retained with its original timestamps.',
              )}
            </p>
          )}
          <p className="info-explanation">
            {t(
              'Comparaison complète hors coinbase · bloc #',
              'Complete comparison excluding coinbase · block #',
            )}
            {n(display.comparison.blockHeight)}.
          </p>
          <dl className="info-details info-comparison-categories">
            {display.categories.map((category) => (
              <div
                className="info-detail"
                key={category.key}
                data-comparison-category={category.key}
                data-count={category.count}
              >
                <dt>{category.label}</dt>
                <dd>{n(category.count)}</dd>
              </div>
            ))}
          </dl>
          <dl className="info-details">
            <Detail label={t('Total du candidat', 'Candidate total')}>
              {n(display.comparison.candidateTransactionCount)} transactions
            </Detail>
            <Detail label={t('Total du bloc hors coinbase', 'Block total excluding coinbase')}>
              {n(display.comparison.blockTransactionCount)} transactions
            </Detail>
            <Detail label={t('Source du candidat', 'Candidate source')}>
              {display.comparison.candidateSource}
            </Detail>
            <Detail label={t('Source du bloc', 'Block source')}>
              {display.comparison.blockSource}
            </Detail>
            <Detail label={t('Relevé du candidat', 'Candidate observed')}>
              <time dateTime={new Date(display.comparison.candidateObservedAt).toISOString()}>
                {new Date(display.comparison.candidateObservedAt).toLocaleString(
                  languageTag(locale),
                )}
              </time>
            </Detail>
            <Detail label={t('Première détection du bloc', 'Block first detected')}>
              <time dateTime={new Date(display.comparison.blockObservedAt).toISOString()}>
                {new Date(display.comparison.blockObservedAt).toLocaleString(languageTag(locale))}
              </time>
            </Detail>
            <Detail label={t('Identifiant du bloc', 'Block ID')}>
              <span title={display.comparison.blockHash}>
                {shortHash(display.comparison.blockHash)}
              </span>
            </Detail>
            <Detail label={t('Parent du candidat', 'Candidate parent')}>
              <span title={display.comparison.parentBlockHash}>
                {shortHash(display.comparison.parentBlockHash)}
              </span>
            </Detail>
          </dl>
          {comparedBlockLink && (
            <a
              className="info-explorer"
              href={comparedBlockLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Explorer le bloc comparé', 'Explore compared block')}
              <Icon name="external" size={13} />
            </a>
          )}
        </>
      ) : (
        <>
          <p className="info-comparison-summary">
            {t('En attente d’un bilan', 'Waiting for comparison')}
          </p>
          <p className="info-comparison-empty">—</p>
        </>
      )}
      <p className="info-explanation">{display.note}</p>
    </section>
  );
}

export function InfoPanel({
  snapshot,
  selectedTx,
  selectedHistorical = false,
  selectedInclusionOnly = false,
  selectedObservedAt,
  selectedPoolState = 'unknown',
  selectedPoolObservedAt,
  selectedReasonLabel,
  activity,
  paused,
  reducedMotion = false,
  feeDisplayUnit = 'native',
  onClearSelection,
  onClose,
}: InfoPanelProps) {
  const { locale, t } = useI18n();
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const [page, setPage] = useState(0);
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const rotating =
    rotationEnabled &&
    !interacting &&
    !selectedTx &&
    !paused &&
    !reducedMotion &&
    snapshot?.status === 'ok';

  useEffect(() => {
    if (!rotating) return;
    let timer: number | undefined;
    const syncVisibility = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (!document.hidden) {
        timer = window.setInterval(() => setPage((current) => (current + 1) % pages.length), 4_000);
      }
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [rotating]);

  const chain = snapshot?.chain ?? selectedTx?.chain ?? 'bitcoin';
  const bitcoin = chain === 'bitcoin';
  const demo = snapshot?.mode === 'demo';
  const quote = demo ? undefined : snapshot?.usdQuote;
  useUsableUsdQuote(quote);
  const displayUsd = feeDisplayUnit === 'usd';
  const medianFee = useMemo(() => medianTransactionFee(snapshot), [snapshot]);
  const mempool = useProviderMempool(snapshot);
  const medianAmount = formatMedianTransactionFee(chain, medianFee, feeDisplayUnit, quote, locale);
  const medianAmountParts = medianAmount.match(/^(.+) (BTC|ETH|\$ US|USD)$/);
  const latest = snapshot?.blocks[0];
  const nodeTemplate = snapshot ? activeBitcoinBlockTemplate(snapshot) : null;
  const completeFees = medianFee.scope === 'template';
  const feeObservedAt = completeFees
    ? nodeTemplate?.observedAt
    : snapshot?.bitcoinArrivals
      ? snapshot.observedAt
      : (snapshot?.sampling?.observedAt ??
        snapshot?.blockTemplate?.observedAt ??
        snapshot?.observedAt);
  const pendingDetails = snapshot?.transactions.filter((tx) => tx.status === 'pending').length ?? 0;
  const blockValue = latestBlockValueDisplay(snapshot, locale);
  const blockLink = latest && !demo ? explorerUrl(chain, latest.hash, 'block') : null;
  const txLink = selectedTx && !demo ? explorerUrl(chain, selectedTx.id, 'tx') : null;
  const selectionStatus = selectedTx
    ? passengerStatus(
        {
          bitcoinArrival: bitcoinArrivalObservation(snapshot, selectedTx),
          tx: selectedTx,
          sourceObserved: !selectedHistorical,
          poolState: selectedPoolState,
          poolObservedAt: selectedPoolObservedAt,
        },
        locale,
      )
    : null;
  const sourceState = !snapshot
    ? t('Connexion en cours', 'Connecting')
    : demo
      ? t('Données simulées', 'Simulated data')
      : snapshot.status === 'ok'
        ? t('Source en direct', 'Live source')
        : snapshot.status === 'stale'
          ? t('Données anciennes', 'Old data')
          : t('Source indisponible', 'Source unavailable');

  return (
    <aside
      className={`info-panel ${bitcoin ? 'info-bitcoin' : 'info-ethereum'} ${paused || reducedMotion ? 'info-still' : ''}`}
      aria-label={t('Panneau d’informations de la ville', 'City information panel')}
      data-testid="info-panel"
      data-page={selectedTx ? 'transaction' : (pages[page] ?? pages[0]).id}
      data-auto-rotating={rotating}
      data-fee-display={feeDisplayUnit}
      data-fee-scope={medianFee.scope ?? 'sample'}
      data-selection-historical={selectedTx ? selectedHistorical : undefined}
      data-selection-inclusion-only={selectedTx ? selectedInclusionOnly : undefined}
      data-selection-pool-state={selectedTx ? selectedPoolState : undefined}
      data-selection-status={selectionStatus?.kind}
      data-selection-group={selectionStatus?.group}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
      }}
    >
      <div className="info-panel-top">
        <span className="info-panel-caption">
          <i />
          {t('LE PANNEAU DU QUAI', 'THE PLATFORM BOARD')}
        </span>
        <div className="info-panel-actions">
          {selectedTx && onClearSelection && (
            <button
              type="button"
              className="info-icon-button"
              onClick={onClearSelection}
              aria-label={t('Libérer le panneau d’informations', 'Unpin the information panel')}
              title={t('Revenir aux informations du réseau', 'Return to network information')}
            >
              <Icon name="signal" size={16} />
            </button>
          )}
          {onClose ? (
            <button
              type="button"
              className="info-icon-button info-panel-close"
              onClick={onClose}
              aria-label={t('Fermer le panneau d’informations', 'Close information panel')}
              title={t(
                'Fermer le panneau d’informations · Échap',
                'Close information panel · Escape',
              )}
            >
              <Icon name="close" size={18} />
            </button>
          ) : (
            !selectedTx && <Icon name="signal" size={16} />
          )}
        </div>
      </div>

      {selectedTx ? (
        <div className="info-panel-content info-selected" key={selectedTx.id}>
          <p className="info-kicker">
            {selectedHistorical
              ? t('Dernière observation connue', 'Last known observation')
              : t('VOYAGEUR SÉLECTIONNÉ · PANNEAU FIXÉ', 'SELECTED TRAVELER · PANEL PINNED')}
          </p>
          <h3>
            {t('Une transaction,', 'One transaction,')}
            <br />
            {t('un voyageur.', 'one traveler.')}
          </h3>
          <span className="info-transaction-hash" title={selectedTx.id}>
            {shortHash(selectedTx.id)}
          </span>
          {selectedHistorical && (
            <p className="info-caution">
              {selectedTx.status === 'confirmed'
                ? selectionStatus?.description
                : selectedPoolState === 'pending'
                  ? t(
                      'Présence vérifiée dans le dernier inventaire du fournisseur. Les détails de frais restent ceux de la dernière observation.',
                      'Presence verified in the provider’s latest inventory. Fee details remain those of the last observation.',
                    )
                  : selectedPoolState === 'queued'
                    ? t(
                        'Toujours présente, mais classée queued par le fournisseur Ethereum.',
                        'Still present, but classified as queued by the Ethereum provider.',
                      )
                    : selectedPoolState === 'absent'
                      ? t(
                          'Absente du dernier inventaire complet. Cela ne prouve ni une confirmation ni un remplacement.',
                          'Absent from the latest complete inventory. This proves neither confirmation nor replacement.',
                        )
                      : selectedPoolState === 'replaced'
                        ? t(
                            'Une autre transaction plus récemment observée utilise le même compte et le même nonce.',
                            'Another more recently observed transaction uses the same account and nonce.',
                          )
                        : t(
                            'Présence actuelle dans le mempool inconnue.',
                            'Current presence in the mempool is unknown.',
                          )}
            </p>
          )}
          <dl className="info-details">
            <Detail
              label={
                demo
                  ? t('Présence simulée', 'Simulated presence')
                  : t('Présence / inclusion', 'Presence / inclusion')
              }
            >
              <span data-testid="transaction-presence-status">{selectionStatus?.label}</span>
            </Detail>
            {selectedReasonLabel && (
              <Detail label={t('Dans la scène', 'In the scene')}>{selectedReasonLabel}</Detail>
            )}
            {selectedPoolState !== 'unknown' && selectedPoolObservedAt !== undefined && (
              <Detail
                label={
                  selectedPoolState === 'replaced'
                    ? t('Observation du remplacement', 'Replacement observed')
                    : t('Inventaire vérifié', 'Verified inventory')
                }
              >
                <time dateTime={new Date(selectedPoolObservedAt).toISOString()}>
                  {new Date(selectedPoolObservedAt).toLocaleString(languageTag(locale))}
                </time>
              </Detail>
            )}
            <Detail
              label={
                selectedHistorical
                  ? t('État des derniers détails reçus', 'Status of last received details')
                  : demo
                    ? t('État simulé', 'Simulated status')
                    : t('État des détails reçus', 'Status of received details')
              }
            >
              {selectedHistorical
                ? selectedTx.status === 'pending'
                  ? t('En attente lors de cette observation', 'Pending at this observation')
                  : t('Inclusion observée antérieurement', 'Inclusion observed previously')
                : selectedTx.status === 'pending'
                  ? t('En attente', 'Pending')
                  : t('Incluse dans un bloc observé', 'Included in an observed block')}
            </Detail>
            {selectedHistorical && selectedObservedAt !== undefined && (
              <Detail label={t('Dernière observation', 'Last observed')}>
                <time
                  dateTime={new Date(selectedObservedAt).toISOString()}
                  title={new Date(selectedObservedAt).toLocaleString(languageTag(locale))}
                >
                  {new Date(selectedObservedAt).toLocaleString(languageTag(locale))}
                </time>
              </Detail>
            )}
            <Detail
              label={
                displayUsd
                  ? bitcoin
                    ? t('Frais estimés', 'Estimated fees')
                    : t('Estimation avec limite de gas', 'Estimate using gas limit')
                  : bitcoin
                    ? t('Frais par vByte', 'Fees per vByte')
                    : t('Prix du gas observé', 'Observed gas price')
              }
            >
              {formatTransactionFee(selectedTx, feeDisplayUnit, quote, locale)}
            </Detail>
            <Detail
              label={
                bitcoin
                  ? t('Taille virtuelle', 'Virtual size')
                  : t('Limite de gas déclarée', 'Declared gas limit')
              }
            >
              {n(selectedTx.size)} {bitcoin ? 'vB' : 'gas'}
            </Detail>
            <Detail label={t('Valeur fournie', 'Reported value')}>
              {selectedTx.value === 'Montant non fourni'
                ? t('Montant non fourni', 'Amount not provided')
                : selectedTx.value}
            </Detail>
            <Detail label={t('Nature', 'Kind')}>
              {selectedTx.kind === 'contract'
                ? t('Données ou création de contrat', 'Contract data or deployment')
                : t('Transfert', 'Transfer')}
            </Detail>
          </dl>
          {selectedInclusionOnly && (
            <p className="info-caution">
              {t('Inclusion vérifiée dans le bloc ', 'Inclusion verified in block ')}
              {shortHash(selectedTx.blockHash ?? '')}
              {t(
                '. Les frais, la taille et la valeur proviennent de la dernière observation conservée ; les frais affichés ne sont pas un reçu des frais effectivement payés.',
                '. Fees, size and value come from the last retained observation; displayed fees are not a receipt of fees actually paid.',
              )}
            </p>
          )}
          {selectedHistorical && (
            <p className="info-explanation">
              {selectedTx.status === 'pending'
                ? selectedPoolState === 'pending' || selectedPoolState === 'queued'
                  ? t(
                      'La présence vient du relevé daté du fournisseur ; les frais individuels peuvent être plus anciens.',
                      'Presence comes from the provider’s dated inventory; individual fee details may be older.',
                    )
                  : t(
                      'La position de ce voyageur ne prouve pas sa présence actuelle dans le mempool.',
                      'This traveler’s position does not prove current presence in the mempool.',
                    )
                : t(
                    'L’inclusion affichée provient d’une observation conservée.',
                    'The displayed inclusion comes from a retained observation.',
                  )}{' '}
              {t(
                'Sa couleur compare les derniers frais connus à l’échantillon actuel ; le rouge ne garantit ni priorité ni place dans un bloc.',
                'Its color compares the last known fees with the current sample; red guarantees neither priority nor a place in a block.',
              )}
            </p>
          )}
          {displayUsd && (
            <>
              <p className="info-explanation">
                {t('Taux natif : ', 'Native rate: ')}
                {formatFeeRate(chain, selectedTx.feeRate, 'native', undefined, locale)}.{' '}
                {bitcoin
                  ? t(
                      'Coût approximatif calculé avec la taille virtuelle observée.',
                      'Approximate cost calculated using the observed virtual size.',
                    )
                  : t(
                      'Calcul avec la limite de gas déclarée, pas le gas consommé ni les frais réellement payés.',
                      'Calculated using the declared gas limit, not gas consumed or fees actually paid.',
                    )}
              </p>
              <p className="info-explanation">{usdQuoteNote(quote, demo, locale)}</p>
            </>
          )}
          <p className="info-explanation">
            {bitcoin
              ? t(
                  'La tête représente la taille virtuelle. La couleur représente les frais.',
                  'Head size represents virtual size. Color represents fees.',
                )
              : t(
                  'La tête représente la limite de gas déclarée, pas les octets ni le gas consommé.',
                  'Head size represents the declared gas limit, not bytes or gas consumed.',
                )}
          </p>
          {txLink ? (
            <a className="info-explorer" href={txLink} target="_blank" rel="noopener noreferrer">
              {t('Explorer cette transaction', 'Explore this transaction')}
              <Icon name="external" size={13} />
            </a>
          ) : (
            <p className="info-explanation">
              {t('Données fictives : aucun lien réseau.', 'Fictional data: no network link.')}
            </p>
          )}
          <p className="info-caution">
            {t(
              'Un déplacement animé ne prouve aucune confirmation.',
              'Animated movement does not prove confirmation.',
            )}
          </p>
        </div>
      ) : (
        <>
          <div
            className="info-panel-content"
            key={page}
            role="tabpanel"
            id="info-panel-page"
            aria-labelledby={`info-panel-tab-${page}`}
          >
            <p className="info-kicker">
              {bitcoin ? 'BITCOIN' : 'ETHEREUM'} ·{' '}
              {demo ? t('SIMULATION', 'SIMULATION') : t('OBSERVATOIRE', 'OBSERVATORY')}
            </p>
            {page === 0 && (
              <>
                <h3>{t('La vie du réseau.', 'Network activity.')}</h3>
                <p className="info-hero info-fee-amount">
                  {medianAmountParts ? (
                    <>
                      {medianAmountParts[1]}
                      <span>{medianAmountParts[2]}</span>
                    </>
                  ) : (
                    medianAmount
                  )}
                </p>
                <p className="info-hero-caption">
                  {t('Frais médians', 'Median fees')}
                  {completeFees ? '' : t(' estimés', ' estimated')} / transaction ·{' '}
                  {medianTransactionFeeScopeLabel(medianFee, locale)}
                </p>
                <p className="info-explanation">
                  {medianTransactionFeeNote(
                    chain,
                    medianFee.sampleSize,
                    demo,
                    medianFee.scope,
                    locale,
                  )}
                </p>
                {nodeTemplate && !completeFees && (
                  <p className="info-explanation">
                    {t(
                      'Cet instantané ne fournit pas la médiane complète du candidat : cette valeur porte seulement sur les détails reçus.',
                      'This snapshot does not provide the complete candidate’s median: this value covers only the received details.',
                    )}
                  </p>
                )}
                {displayUsd && (
                  <p className="info-explanation">
                    {t('Médiane en ', 'Median in ')}
                    {bitcoin ? 'BTC' : 'ETH'} :{' '}
                    {formatMedianTransactionFee(chain, medianFee, 'native', undefined, locale)}.{' '}
                    {usdQuoteNote(quote, demo, locale)}
                  </p>
                )}
                <dl className="info-details">
                  <Detail
                    label={
                      demo
                        ? t('Mempool simulée', 'Simulated mempool')
                        : t('Mempool du fournisseur', 'Provider mempool')
                    }
                  >
                    {mempool.total === null
                      ? t('Non mesuré', 'Not measured')
                      : `${n(mempool.total)} transactions`}
                  </Detail>
                  {!bitcoin && mempool.pending !== null && mempool.queued !== null && (
                    <Detail label="Pending / queued">
                      {n(mempool.pending)} / {n(mempool.queued)}
                    </Detail>
                  )}
                  <Detail label={t('Échantillon reçu', 'Received sample')}>
                    {snapshot ? `${n(snapshot.transactions.length)} transactions` : '—'}
                  </Detail>
                  <Detail label={t('Source des frais', 'Fee source')}>
                    {completeFees
                      ? nodeTemplate?.source
                      : (sourceName(snapshot, locale) ?? t('En attente', 'Pending'))}
                  </Detail>
                  {feeObservedAt !== undefined && (
                    <Detail label={t('Relevé des frais', 'Fees observed')}>
                      <time dateTime={new Date(feeObservedAt).toISOString()}>
                        {new Date(feeObservedAt).toLocaleTimeString(languageTag(locale))}
                      </time>
                    </Detail>
                  )}
                  <Detail
                    label={
                      bitcoin
                        ? t('Taux conseillé · ~30 min', 'Suggested rate · ~30 min')
                        : t('Frais de base · sans pourboire', 'Base fee · excluding tip')
                    }
                  >
                    {formatFeeRate(chain, snapshot?.feeRate ?? null, 'native', undefined, locale)}
                  </Detail>
                  <Detail label={t('Source', 'Source')}>
                    {sourceName(snapshot, locale) ?? t('En attente', 'Pending')}
                  </Detail>
                </dl>
                <p className="info-explanation">{mempool.note}</p>
                <p className="info-explanation">
                  {bitcoin
                    ? t(
                        'Les frais influencent la priorité. Le délai d’inclusion reste incertain.',
                        'Fees influence priority. Inclusion time remains uncertain.',
                      )
                    : t(
                        'Le taux de base ci-dessus exclut le pourboire. La médiane des coûts utilise le prix du gas des transactions. Aucun inventaire mondial des transactions en attente n’est fourni.',
                        'The base rate above excludes the tip. The cost median uses transaction gas prices. No worldwide pending transaction inventory is provided.',
                      )}
                </p>
              </>
            )}
            {page === 1 && (
              <>
                <h3>{t('Le dernier bloc reçu.', 'The latest received block.')}</h3>
                <p className="info-hero info-block-number">
                  {latest ? `#${n(latest.height)}` : '—'}
                </p>
                <p className="info-hero-caption">
                  {demo
                    ? t('Bloc synthétique', 'Synthetic block')
                    : t('Dernier bloc observé', 'Latest observed block')}
                </p>
                <div className="info-capacity" aria-hidden="true">
                  <span
                    style={{ width: `${latest ? (latest.used / latest.capacity) * 100 : 0}%` }}
                  />
                </div>
                <dl className="info-details">
                  <Detail label={t('Transactions', 'Transactions')}>
                    {latest ? n(latest.txCount) : '—'}
                  </Detail>
                  <Detail label={blockValue.label}>
                    {blockValue.approximate ? '≈ ' : ''}
                    {blockValue.value} {blockValue.unit}
                  </Detail>
                  {blockValue.usd && (
                    <Detail
                      label={t(
                        'Équivalent au cours reçu',
                        'Equivalent at the observed exchange rate',
                      )}
                    >
                      {blockValue.usd}
                    </Detail>
                  )}
                  <Detail
                    label={
                      bitcoin
                        ? t('Espace virtuel utilisé', 'Virtual space used')
                        : t('Gas consommé', 'Gas consumed')
                    }
                  >
                    {latest ? `${n(latest.used)} ${bitcoin ? 'vB' : 'gas'}` : '—'}
                  </Detail>
                  <Detail label={t('Occupation', 'Capacity used')}>
                    {latest ? `${n((latest.used / latest.capacity) * 100, 1)} %` : '—'}
                  </Detail>
                  <Detail label={t('Horodatage du bloc', 'Block timestamp')}>
                    {latest
                      ? new Date(latest.timestamp * 1_000).toLocaleTimeString(languageTag(locale))
                      : '—'}
                  </Detail>
                </dl>
                <p className="info-explanation">{blockValue.note}</p>
                {blockLink && (
                  <a
                    className="info-explorer"
                    href={blockLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('Explorer ce bloc', 'Explore this block')}
                    <Icon name="external" size={13} />
                  </a>
                )}
                <p className="info-explanation">
                  {t(
                    'À réception de ce bloc, le premier wagon part avec les inclusions connues de notre échantillon.',
                    'When this block is received, the first wagon departs with known inclusions from our sample.',
                  )}{' '}
                  {nodeTemplate
                    ? t(
                        'À l’arrêt, le premier représente un échantillon du candidat proposé par le nœud ; le second reste une estimation.',
                        'While stopped, the first shows a sample of the node’s proposed candidate; the second remains an estimate.',
                      )
                    : t(
                        'Les deux wagons à l’arrêt projettent les blocs suivants.',
                        'The two stopped wagons project the next blocks.',
                      )}{' '}
                  {demo
                    ? t(
                        'Ce départ est une illustration pédagogique.',
                        'This departure is an educational illustration.',
                      )
                    : t(
                        'Observé ne signifie pas finalisé. Le prochain départ n’a pas d’échéance garantie.',
                        'Observed does not mean finalized. There is no guaranteed deadline for the next departure.',
                      )}
                </p>
                {bitcoin && <CandidateComparisonDetails snapshot={snapshot} />}
              </>
            )}
            {page === 2 && (
              <>
                <h3>{t('À chacun sa place.', 'A place for each traveler.')}</h3>
                <span className="info-projection-label">
                  {nodeTemplate
                    ? t('Candidat du nœud et estimation', 'Node candidate and estimate')
                    : t('Deux projections pédagogiques', 'Two educational projections')}
                </span>
                {nodeTemplate && (
                  <dl className="info-details">
                    <Detail label={t('Candidat du nœud', 'Node candidate')}>
                      #{n(nodeTemplate.height)}
                    </Detail>
                    <Detail
                      label={t(
                        'Candidat complet hors coinbase',
                        'Complete candidate excluding coinbase',
                      )}
                    >
                      {n(nodeTemplate.transactionCount)} transactions
                    </Detail>
                    <Detail
                      label={t('Poids hors coinbase / limite', 'Weight excluding coinbase / limit')}
                    >
                      {n(nodeTemplate.weight)} / {n(nodeTemplate.weightLimit)} WU
                    </Detail>
                    <Detail label={t('Détails individuels reçus', 'Individual details received')}>
                      {n(pendingDetails)} / {n(PENDING_SAMPLE_LIMIT)} maximum
                    </Detail>
                    {completeFees && (
                      <Detail
                        label={t(
                          'Frais médians du candidat complet',
                          'Complete candidate median fees',
                        )}
                      >
                        {formatMedianTransactionFee(
                          chain,
                          medianFee,
                          feeDisplayUnit,
                          quote,
                          locale,
                        )}{' '}
                        / tx
                      </Detail>
                    )}
                    <Detail label={t('Source du candidat', 'Candidate source')}>
                      {nodeTemplate.source}
                    </Detail>
                    <Detail label={t('Relevé du candidat', 'Candidate observed')}>
                      <time dateTime={new Date(nodeTemplate.observedAt).toISOString()}>
                        {new Date(nodeTemplate.observedAt).toLocaleTimeString(languageTag(locale))}
                      </time>
                    </Detail>
                  </dl>
                )}
                <div className="info-flow">
                  {(
                    [
                      ['walking', t('Vers le wagon', 'Heading to wagon'), '↗'],
                      ['boarded', t('À bord', 'On board'), '▰'],
                      ['returning', t('Retour au quai', 'Returning to platform'), '↩'],
                      ['waiting', t('Sur le quai', 'On the platform'), '◷'],
                    ] as const
                  ).map(([phase, label, symbol]) => (
                    <div className={`info-flow-item ${phase}`} key={phase}>
                      <span aria-hidden="true">{symbol}</span>
                      <strong>{activity ? n(activity[phase]) : '—'}</strong>
                      <p>{label}</p>
                    </div>
                  ))}
                </div>
                {activity && (
                  <p className="info-explanation">
                    {t('Dans la scène : ', 'In the scene: ')}
                    {n(activity.observed ?? 0)}
                    {t(' transactions encore observées,', ' transactions still observed,')}{' '}
                    {n(activity.historical ?? 0)}
                    {t(
                      ' observations historiques conservées. Ces effectifs ne sont pas le total du mempool.',
                      ' historical observations retained. These counts are not the mempool total.',
                    )}
                  </p>
                )}
                <p className="info-explanation">
                  {nodeTemplate
                    ? t(
                        `Le candidat complet proposé par le nœud réunit ${n(nodeTemplate.transactionCount)} transactions hors coinbase et ${n(nodeTemplate.weight)} WU. Jusqu’à ${n(PENDING_SAMPLE_LIMIT)} détails individuels sont transmis ; les autres membres peuvent être représentés collectivement, sans inventer leurs données individuelles. La médiane complète est calculée à partir des frais de toutes ses transactions lorsqu’ils sont disponibles. Le second wagon reste une estimation. Rien ne prouve qu’un pool minier travaille sur ce candidat.`,
                        `The node’s complete proposed candidate contains ${n(nodeTemplate.transactionCount)} transactions excluding coinbase and ${n(nodeTemplate.weight)} WU. Up to ${n(PENDING_SAMPLE_LIMIT)} individual details are supplied; other members may be represented collectively without inventing individual data. The complete median uses fees from all candidate transactions when available. The second wagon remains an estimate. There is no proof that a mining pool is working on this candidate.`,
                      )
                    : t(
                        'Le premier wagon projette le prochain bloc, le second projette le suivant. Les voyageurs avancent selon leurs frais et la place disponible. Une hausse du tarif recommandé Bitcoin ou une absence du nouvel échantillon ne retire pas à elle seule la réservation d’un voyageur déjà embarqué.',
                        'The first wagon projects the next block, the second the following one. Travelers move according to their fees and available capacity. A rise in Bitcoin’s recommended fee or absence from a new sample alone does not cancel an already boarded traveler’s reservation.',
                      )}{' '}
                  {t(
                    'L’horloge signale des détails individuels anciens. Leur présence actuelle est indiquée séparément lorsqu’un inventaire complet permet de la vérifier.',
                    'The clock marks old individual details. Current presence is shown separately when a complete inventory can verify it.',
                  )}
                </p>
                <p className="info-caution">
                  {t(
                    'Ces places sont une illustration, pas des inclusions ou des rejets annoncés par le réseau.',
                    'These places are illustrations, not inclusions or rejections announced by the network.',
                  )}
                </p>
                <p className="info-click-hint">
                  {t(
                    'Sélectionnez un voyageur pour découvrir ses données.',
                    'Select a traveler to see its data.',
                  )}
                </p>
              </>
            )}
          </div>
          <div
            className="info-panel-navigation"
            role="tablist"
            aria-label={t('Rubriques du panneau', 'Panel sections')}
          >
            {pages.map(({ label, english }, index) => (
              <button
                key={label}
                id={`info-panel-tab-${index}`}
                role="tab"
                aria-controls="info-panel-page"
                aria-selected={page === index}
                tabIndex={page === index ? 0 : -1}
                onClick={() => {
                  setPage(index);
                  setRotationEnabled(false);
                }}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % pages.length
                      : event.key === 'ArrowLeft'
                        ? (index + pages.length - 1) % pages.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? pages.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setPage(next);
                  setRotationEnabled(false);
                  document.getElementById(`info-panel-tab-${next}`)?.focus();
                }}
              >
                {t(label, english)}
              </button>
            ))}
          </div>
          <button
            className="info-rotation-control"
            onClick={() => setRotationEnabled(!rotationEnabled)}
            aria-pressed={rotationEnabled}
          >
            <Icon name={rotationEnabled ? 'pause' : 'play'} size={11} />
            {rotationEnabled
              ? t('Défilement · 4 s', 'Rotation · 4 s')
              : t('Activer le défilement · 4 s', 'Enable rotation · 4 s')}
            {(paused || reducedMotion || interacting || snapshot?.status !== 'ok') &&
            rotationEnabled
              ? t(' · en pause', ' · paused')
              : ''}
          </button>
        </>
      )}

      <div className={`info-panel-source info-source-${snapshot?.status ?? 'loading'}`}>
        <span>
          <i />
          {sourceState}
        </span>
        {snapshot && (
          <span>
            <time dateTime={new Date(snapshot.observedAt).toISOString()}>
              {t('Chaîne à ', 'Chain at ')}
              {new Date(snapshot.observedAt).toLocaleTimeString(languageTag(locale))}
            </time>
            {snapshot.sampling && (
              <time dateTime={new Date(snapshot.sampling.observedAt).toISOString()}>
                {t(' · Pool à ', ' · Pool at ')}
                {new Date(snapshot.sampling.observedAt).toLocaleTimeString(languageTag(locale))}
              </time>
            )}
            {snapshot.blockTemplate && (
              <time dateTime={new Date(snapshot.blockTemplate.observedAt).toISOString()}>
                {nodeTemplate
                  ? t(' · Candidat à ', ' · Candidate at ')
                  : t(' · Candidat conservé à ', ' · Retained candidate at ')}
                {new Date(snapshot.blockTemplate.observedAt).toLocaleTimeString(
                  languageTag(locale),
                )}
              </time>
            )}
          </span>
        )}
      </div>
    </aside>
  );
}
