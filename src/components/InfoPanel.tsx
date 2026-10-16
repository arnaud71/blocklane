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
  { label: 'Réseau', id: 'network' },
  { label: 'Bloc', id: 'block' },
  { label: 'Voyageurs', id: 'travelers' },
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
  const display = candidateComparisonDisplay(snapshot);
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
      aria-label="Comparaison candidat / bloc"
    >
      <h4>Comparaison candidat / bloc</h4>
      {display.available ? (
        <>
          <p className="info-comparison-summary">
            {display.candidateShare === null
              ? 'Part du candidat non définie : candidat vide.'
              : `${display.value} % du candidat retrouvé dans ce bloc.`}
          </p>
          {display.stale && (
            <p className="info-caution">Ancien bilan conservé, avec ses dates d’origine.</p>
          )}
          <p className="info-explanation">
            Comparaison complète hors coinbase · bloc #{number(display.comparison.blockHeight)}.
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
                <dd>{number(category.count)}</dd>
              </div>
            ))}
          </dl>
          <dl className="info-details">
            <Detail label="Total du candidat">
              {number(display.comparison.candidateTransactionCount)} transactions
            </Detail>
            <Detail label="Total du bloc hors coinbase">
              {number(display.comparison.blockTransactionCount)} transactions
            </Detail>
            <Detail label="Source du candidat">{display.comparison.candidateSource}</Detail>
            <Detail label="Source du bloc">{display.comparison.blockSource}</Detail>
            <Detail label="Relevé du candidat">
              <time dateTime={new Date(display.comparison.candidateObservedAt).toISOString()}>
                {new Date(display.comparison.candidateObservedAt).toLocaleString('fr-CH')}
              </time>
            </Detail>
            <Detail label="Première détection du bloc">
              <time dateTime={new Date(display.comparison.blockObservedAt).toISOString()}>
                {new Date(display.comparison.blockObservedAt).toLocaleString('fr-CH')}
              </time>
            </Detail>
            <Detail label="Identifiant du bloc">
              <span title={display.comparison.blockHash}>
                {shortHash(display.comparison.blockHash)}
              </span>
            </Detail>
            <Detail label="Parent du candidat">
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
              Explorer le bloc comparé <Icon name="external" size={13} />
            </a>
          )}
        </>
      ) : (
        <>
          <p className="info-comparison-summary">En attente d’un bilan</p>
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
  const medianAmount = formatMedianTransactionFee(chain, medianFee, feeDisplayUnit, quote);
  const medianAmountParts = medianAmount.match(/^(.+) (BTC|ETH|\$ US)$/);
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
  const blockValue = latestBlockValueDisplay(snapshot);
  const blockLink = latest && !demo ? explorerUrl(chain, latest.hash, 'block') : null;
  const txLink = selectedTx && !demo ? explorerUrl(chain, selectedTx.id, 'tx') : null;
  const selectionStatus = selectedTx
    ? passengerStatus({
        bitcoinArrival: bitcoinArrivalObservation(snapshot, selectedTx),
        tx: selectedTx,
        sourceObserved: !selectedHistorical,
        poolState: selectedPoolState,
        poolObservedAt: selectedPoolObservedAt,
      })
    : null;
  const sourceState = !snapshot
    ? 'Connexion en cours'
    : demo
      ? 'Données simulées'
      : snapshot.status === 'ok'
        ? 'Source en direct'
        : snapshot.status === 'stale'
          ? 'Données anciennes'
          : 'Source indisponible';

  return (
    <aside
      className={`info-panel ${bitcoin ? 'info-bitcoin' : 'info-ethereum'} ${paused || reducedMotion ? 'info-still' : ''}`}
      aria-label="Panneau d’informations de la ville"
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
          <i /> LE PANNEAU DU QUAI
        </span>
        <div className="info-panel-actions">
          {selectedTx && onClearSelection && (
            <button
              type="button"
              className="info-icon-button"
              onClick={onClearSelection}
              aria-label="Libérer le panneau d’informations"
              title="Revenir aux informations du réseau"
            >
              <Icon name="signal" size={16} />
            </button>
          )}
          {onClose ? (
            <button
              type="button"
              className="info-icon-button info-panel-close"
              onClick={onClose}
              aria-label="Fermer le panneau d’informations"
              title="Fermer le panneau d’informations · Échap"
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
              ? 'Dernière observation connue'
              : 'VOYAGEUR SÉLECTIONNÉ · PANNEAU FIXÉ'}
          </p>
          <h3>
            Une transaction,
            <br />
            un voyageur.
          </h3>
          <span className="info-transaction-hash" title={selectedTx.id}>
            {shortHash(selectedTx.id)}
          </span>
          {selectedHistorical && (
            <p className="info-caution">
              {selectedTx.status === 'confirmed'
                ? selectionStatus?.description
                : selectedPoolState === 'pending'
                  ? 'Présence vérifiée dans le dernier inventaire du fournisseur. Les détails de frais restent ceux de la dernière observation.'
                  : selectedPoolState === 'queued'
                    ? 'Toujours présente, mais classée queued par le fournisseur Ethereum.'
                    : selectedPoolState === 'absent'
                      ? 'Absente du dernier inventaire complet. Cela ne prouve ni une confirmation ni un remplacement.'
                      : selectedPoolState === 'replaced'
                        ? 'Une autre transaction plus récemment observée utilise le même compte et le même nonce.'
                        : 'Présence actuelle dans le mempool inconnue.'}
            </p>
          )}
          <dl className="info-details">
            <Detail label={demo ? 'Présence simulée' : 'Présence / inclusion'}>
              <span data-testid="transaction-presence-status">{selectionStatus?.label}</span>
            </Detail>
            {selectedReasonLabel && <Detail label="Dans la scène">{selectedReasonLabel}</Detail>}
            {selectedPoolState !== 'unknown' && selectedPoolObservedAt !== undefined && (
              <Detail
                label={
                  selectedPoolState === 'replaced'
                    ? 'Observation du remplacement'
                    : 'Inventaire vérifié'
                }
              >
                <time dateTime={new Date(selectedPoolObservedAt).toISOString()}>
                  {new Date(selectedPoolObservedAt).toLocaleString('fr-CH')}
                </time>
              </Detail>
            )}
            <Detail
              label={
                selectedHistorical
                  ? 'État des derniers détails reçus'
                  : demo
                    ? 'État simulé'
                    : 'État des détails reçus'
              }
            >
              {selectedHistorical
                ? selectedTx.status === 'pending'
                  ? 'En attente lors de cette observation'
                  : 'Inclusion observée antérieurement'
                : selectedTx.status === 'pending'
                  ? 'En attente'
                  : 'Incluse dans un bloc observé'}
            </Detail>
            {selectedHistorical && selectedObservedAt !== undefined && (
              <Detail label="Dernière observation">
                <time
                  dateTime={new Date(selectedObservedAt).toISOString()}
                  title={new Date(selectedObservedAt).toLocaleString('fr-CH')}
                >
                  {new Date(selectedObservedAt).toLocaleString('fr-CH')}
                </time>
              </Detail>
            )}
            <Detail
              label={
                displayUsd
                  ? bitcoin
                    ? 'Frais estimés'
                    : 'Estimation avec limite de gas'
                  : bitcoin
                    ? 'Frais par vByte'
                    : 'Prix du gas observé'
              }
            >
              {formatTransactionFee(selectedTx, feeDisplayUnit, quote)}
            </Detail>
            <Detail label={bitcoin ? 'Taille virtuelle' : 'Limite de gas déclarée'}>
              {number(selectedTx.size)} {bitcoin ? 'vB' : 'gas'}
            </Detail>
            <Detail label="Valeur fournie">{selectedTx.value}</Detail>
            <Detail label="Nature">
              {selectedTx.kind === 'contract' ? 'Données ou création de contrat' : 'Transfert'}
            </Detail>
          </dl>
          {selectedInclusionOnly && (
            <p className="info-caution">
              Inclusion vérifiée dans le bloc {shortHash(selectedTx.blockHash ?? '')}. Les frais, la
              taille et la valeur proviennent de la dernière observation conservée ; les frais
              affichés ne sont pas un reçu des frais effectivement payés.
            </p>
          )}
          {selectedHistorical && (
            <p className="info-explanation">
              {selectedTx.status === 'pending'
                ? selectedPoolState === 'pending' || selectedPoolState === 'queued'
                  ? 'La présence vient du relevé daté du fournisseur ; les frais individuels peuvent être plus anciens.'
                  : 'La position de ce voyageur ne prouve pas sa présence actuelle dans le mempool.'
                : 'L’inclusion affichée provient d’une observation conservée.'}{' '}
              Sa couleur compare les derniers frais connus à l’échantillon actuel ; le rouge ne
              garantit ni priorité ni place dans un bloc.
            </p>
          )}
          {displayUsd && (
            <>
              <p className="info-explanation">
                Taux natif : {formatFeeRate(chain, selectedTx.feeRate, 'native')}.{' '}
                {bitcoin
                  ? 'Coût approximatif calculé avec la taille virtuelle observée.'
                  : 'Calcul avec la limite de gas déclarée, pas le gas consommé ni les frais réellement payés.'}
              </p>
              <p className="info-explanation">{usdQuoteNote(quote, demo)}</p>
            </>
          )}
          <p className="info-explanation">
            {bitcoin
              ? 'La tête représente la taille virtuelle. La couleur représente les frais.'
              : 'La tête représente la limite de gas déclarée, pas les octets ni le gas consommé.'}
          </p>
          {txLink ? (
            <a className="info-explorer" href={txLink} target="_blank" rel="noopener noreferrer">
              Explorer cette transaction <Icon name="external" size={13} />
            </a>
          ) : (
            <p className="info-explanation">Données fictives : aucun lien réseau.</p>
          )}
          <p className="info-caution">Un déplacement animé ne prouve aucune confirmation.</p>
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
              {bitcoin ? 'BITCOIN' : 'ETHEREUM'} · {demo ? 'SIMULATION' : 'OBSERVATOIRE'}
            </p>
            {page === 0 && (
              <>
                <h3>La vie du réseau.</h3>
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
                  Frais médians{completeFees ? '' : ' estimés'} / transaction ·{' '}
                  {medianTransactionFeeScopeLabel(medianFee)}
                </p>
                <p className="info-explanation">
                  {medianTransactionFeeNote(chain, medianFee.sampleSize, demo, medianFee.scope)}
                </p>
                {nodeTemplate && !completeFees && (
                  <p className="info-explanation">
                    Cet instantané ne fournit pas la médiane complète du candidat : cette valeur
                    porte seulement sur les détails reçus.
                  </p>
                )}
                {displayUsd && (
                  <p className="info-explanation">
                    Médiane en {bitcoin ? 'BTC' : 'ETH'} :{' '}
                    {formatMedianTransactionFee(chain, medianFee, 'native')}.{' '}
                    {usdQuoteNote(quote, demo)}
                  </p>
                )}
                <dl className="info-details">
                  <Detail label={demo ? 'Mempool simulée' : 'Mempool du fournisseur'}>
                    {mempool.total === null
                      ? 'Non mesuré'
                      : `${number(mempool.total)} transactions`}
                  </Detail>
                  {!bitcoin && mempool.pending !== null && mempool.queued !== null && (
                    <Detail label="Pending / queued">
                      {number(mempool.pending)} / {number(mempool.queued)}
                    </Detail>
                  )}
                  <Detail label="Échantillon reçu">
                    {snapshot ? `${number(snapshot.transactions.length)} transactions` : '—'}
                  </Detail>
                  <Detail label="Source des frais">
                    {completeFees ? nodeTemplate?.source : (snapshot?.source ?? 'En attente')}
                  </Detail>
                  {feeObservedAt !== undefined && (
                    <Detail label="Relevé des frais">
                      <time dateTime={new Date(feeObservedAt).toISOString()}>
                        {new Date(feeObservedAt).toLocaleTimeString('fr-CH')}
                      </time>
                    </Detail>
                  )}
                  <Detail
                    label={bitcoin ? 'Taux conseillé · ~30 min' : 'Frais de base · sans pourboire'}
                  >
                    {formatFeeRate(chain, snapshot?.feeRate ?? null, 'native')}
                  </Detail>
                  <Detail label="Source">{snapshot?.source ?? 'En attente'}</Detail>
                </dl>
                <p className="info-explanation">{mempool.note}</p>
                <p className="info-explanation">
                  {bitcoin
                    ? 'Les frais influencent la priorité. Le délai d’inclusion reste incertain.'
                    : 'Le taux de base ci-dessus exclut le pourboire. La médiane des coûts utilise le prix du gas des transactions. Aucun inventaire mondial des transactions en attente n’est fourni.'}
                </p>
              </>
            )}
            {page === 1 && (
              <>
                <h3>Le dernier bloc reçu.</h3>
                <p className="info-hero info-block-number">
                  {latest ? `#${number(latest.height)}` : '—'}
                </p>
                <p className="info-hero-caption">
                  {demo ? 'Bloc synthétique' : 'Dernier bloc observé'}
                </p>
                <div className="info-capacity" aria-hidden="true">
                  <span
                    style={{ width: `${latest ? (latest.used / latest.capacity) * 100 : 0}%` }}
                  />
                </div>
                <dl className="info-details">
                  <Detail label="Transactions">{latest ? number(latest.txCount) : '—'}</Detail>
                  <Detail label={blockValue.label}>
                    {blockValue.approximate ? '≈ ' : ''}
                    {blockValue.value} {blockValue.unit}
                  </Detail>
                  {blockValue.usd && (
                    <Detail label="Équivalent au cours reçu">{blockValue.usd}</Detail>
                  )}
                  <Detail label={bitcoin ? 'Espace virtuel utilisé' : 'Gas consommé'}>
                    {latest ? `${number(latest.used)} ${bitcoin ? 'vB' : 'gas'}` : '—'}
                  </Detail>
                  <Detail label="Occupation">
                    {latest ? `${number((latest.used / latest.capacity) * 100, 1)} %` : '—'}
                  </Detail>
                  <Detail label="Horodatage du bloc">
                    {latest ? new Date(latest.timestamp * 1_000).toLocaleTimeString('fr-CH') : '—'}
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
                    Explorer ce bloc <Icon name="external" size={13} />
                  </a>
                )}
                <p className="info-explanation">
                  À réception de ce bloc, le premier wagon part avec les inclusions connues de notre
                  échantillon.{' '}
                  {nodeTemplate
                    ? 'À l’arrêt, le premier représente un échantillon du candidat proposé par le nœud ; le second reste une estimation.'
                    : 'Les deux wagons à l’arrêt projettent les blocs suivants.'}{' '}
                  {demo
                    ? 'Ce départ est une illustration pédagogique.'
                    : 'Observé ne signifie pas finalisé. Le prochain départ n’a pas d’échéance garantie.'}
                </p>
                {bitcoin && <CandidateComparisonDetails snapshot={snapshot} />}
              </>
            )}
            {page === 2 && (
              <>
                <h3>À chacun sa place.</h3>
                <span className="info-projection-label">
                  {nodeTemplate
                    ? 'Candidat du nœud et estimation'
                    : 'Deux projections pédagogiques'}
                </span>
                {nodeTemplate && (
                  <dl className="info-details">
                    <Detail label="Candidat du nœud">#{number(nodeTemplate.height)}</Detail>
                    <Detail label="Candidat complet hors coinbase">
                      {number(nodeTemplate.transactionCount)} transactions
                    </Detail>
                    <Detail label="Poids hors coinbase / limite">
                      {number(nodeTemplate.weight)} / {number(nodeTemplate.weightLimit)} WU
                    </Detail>
                    <Detail label="Détails individuels reçus">
                      {number(pendingDetails)} / {number(PENDING_SAMPLE_LIMIT)} maximum
                    </Detail>
                    {completeFees && (
                      <Detail label="Frais médians du candidat complet">
                        {formatMedianTransactionFee(chain, medianFee, feeDisplayUnit, quote)} / tx
                      </Detail>
                    )}
                    <Detail label="Source du candidat">{nodeTemplate.source}</Detail>
                    <Detail label="Relevé du candidat">
                      <time dateTime={new Date(nodeTemplate.observedAt).toISOString()}>
                        {new Date(nodeTemplate.observedAt).toLocaleTimeString('fr-CH')}
                      </time>
                    </Detail>
                  </dl>
                )}
                <div className="info-flow">
                  {(
                    [
                      ['walking', 'Vers le wagon', '↗'],
                      ['boarded', 'À bord', '▰'],
                      ['returning', 'Retour au quai', '↩'],
                      ['waiting', 'Sur le quai', '◷'],
                    ] as const
                  ).map(([phase, label, symbol]) => (
                    <div className={`info-flow-item ${phase}`} key={phase}>
                      <span aria-hidden="true">{symbol}</span>
                      <strong>{activity ? number(activity[phase]) : '—'}</strong>
                      <p>{label}</p>
                    </div>
                  ))}
                </div>
                {activity && (
                  <p className="info-explanation">
                    Dans la scène : {number(activity.observed ?? 0)} transactions encore observées,{' '}
                    {number(activity.historical ?? 0)} observations historiques conservées. Ces
                    effectifs ne sont pas le total du mempool.
                  </p>
                )}
                <p className="info-explanation">
                  {nodeTemplate
                    ? `Le candidat complet proposé par le nœud réunit ${number(nodeTemplate.transactionCount)} transactions hors coinbase et ${number(nodeTemplate.weight)} WU. Jusqu’à ${number(PENDING_SAMPLE_LIMIT)} détails individuels sont transmis ; les autres membres peuvent être représentés collectivement, sans inventer leurs données individuelles. La médiane complète est calculée à partir des frais de toutes ses transactions lorsqu’ils sont disponibles. Le second wagon reste une estimation. Rien ne prouve qu’un pool minier travaille sur ce candidat.`
                    : 'Le premier wagon projette le prochain bloc, le second projette le suivant. Les voyageurs avancent selon leurs frais et la place disponible. Une hausse du tarif recommandé Bitcoin ou une absence du nouvel échantillon ne retire pas à elle seule la réservation d’un voyageur déjà embarqué.'}{' '}
                  L’horloge signale des détails individuels anciens. Leur présence actuelle est
                  indiquée séparément lorsqu’un inventaire complet permet de la vérifier.
                </p>
                <p className="info-caution">
                  Ces places sont une illustration, pas des inclusions ou des rejets annoncés par le
                  réseau.
                </p>
                <p className="info-click-hint">
                  Sélectionnez un voyageur pour découvrir ses données.
                </p>
              </>
            )}
          </div>
          <div className="info-panel-navigation" role="tablist" aria-label="Rubriques du panneau">
            {pages.map(({ label }, index) => (
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
                {label}
              </button>
            ))}
          </div>
          <button
            className="info-rotation-control"
            onClick={() => setRotationEnabled(!rotationEnabled)}
            aria-pressed={rotationEnabled}
          >
            <Icon name={rotationEnabled ? 'pause' : 'play'} size={11} />
            {rotationEnabled ? 'Défilement · 4 s' : 'Activer le défilement · 4 s'}
            {(paused || reducedMotion || interacting || snapshot?.status !== 'ok') &&
            rotationEnabled
              ? ' · en pause'
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
              Chaîne à {new Date(snapshot.observedAt).toLocaleTimeString('fr-CH')}
            </time>
            {snapshot.sampling && (
              <time dateTime={new Date(snapshot.sampling.observedAt).toISOString()}>
                {' · Pool à '}
                {new Date(snapshot.sampling.observedAt).toLocaleTimeString('fr-CH')}
              </time>
            )}
            {snapshot.blockTemplate && (
              <time dateTime={new Date(snapshot.blockTemplate.observedAt).toISOString()}>
                {nodeTemplate ? ' · Candidat à ' : ' · Candidat conservé à '}
                {new Date(snapshot.blockTemplate.observedAt).toLocaleTimeString('fr-CH')}
              </time>
            )}
          </span>
        )}
      </div>
    </aside>
  );
}
