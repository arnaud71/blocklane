import { useEffect, useState } from 'react';
import type { Snapshot, Tx } from '../../shared/model';
import { explorerUrl, number, shortHash } from '../lib/format';
import { Icon } from './Icon';
import './InfoPanel.css';

export type SceneActivity = {
  walking: number;
  boarded: number;
  returning: number;
  waiting: number;
};

type InfoPanelProps = {
  snapshot: Snapshot | null;
  selectedTx: Tx | null;
  activity?: SceneActivity;
  paused: boolean;
  reducedMotion?: boolean;
  onClearSelection?: () => void;
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

export function InfoPanel({
  snapshot,
  selectedTx,
  activity,
  paused,
  reducedMotion = false,
  onClearSelection,
}: InfoPanelProps) {
  const [page, setPage] = useState(0);
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const rotating = rotationEnabled && !selectedTx && !paused && !reducedMotion && snapshot !== null;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % pages.length),
      8_000,
    );
    return () => window.clearInterval(timer);
  }, [rotating]);

  const chain = snapshot?.chain ?? selectedTx?.chain ?? 'bitcoin';
  const bitcoin = chain === 'bitcoin';
  const demo = snapshot?.mode === 'demo';
  const latest = snapshot?.blocks[0];
  const blockLink = latest && !demo ? explorerUrl(chain, latest.hash, 'block') : null;
  const txLink = selectedTx && !demo ? explorerUrl(chain, selectedTx.id, 'tx') : null;
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
    >
      <div className="info-panel-top">
        <span className="info-panel-caption">
          <i /> LE PANNEAU DU QUAI
        </span>
        {selectedTx && onClearSelection ? (
          <button
            className="info-icon-button"
            onClick={onClearSelection}
            aria-label="Libérer le panneau d’informations"
          >
            <Icon name="close" size={16} />
          </button>
        ) : (
          <Icon name="signal" size={16} />
        )}
      </div>

      {selectedTx ? (
        <div className="info-panel-content info-selected" key={selectedTx.id}>
          <p className="info-kicker">VOYAGEUR SÉLECTIONNÉ · PANNEAU FIXÉ</p>
          <h3>
            Une transaction,
            <br />
            un voyageur.
          </h3>
          <span className="info-transaction-hash" title={selectedTx.id}>
            {shortHash(selectedTx.id)}
          </span>
          <dl className="info-details">
            <Detail label={demo ? 'État simulé' : 'État dans la source'}>
              {selectedTx.status === 'pending' ? 'En attente' : 'Incluse dans un bloc observé'}
            </Detail>
            <Detail label={bitcoin ? 'Frais par vByte' : 'Prix du gas observé'}>
              {number(selectedTx.feeRate, 3)} {bitcoin ? 'sat/vB' : 'Gwei'}
            </Detail>
            <Detail label={bitcoin ? 'Taille virtuelle' : 'Limite de gas déclarée'}>
              {number(selectedTx.size)} {bitcoin ? 'vB' : 'gas'}
            </Detail>
            <Detail label="Valeur fournie">{selectedTx.value}</Detail>
            <Detail label="Nature">
              {selectedTx.kind === 'contract' ? 'Données ou création de contrat' : 'Transfert'}
            </Detail>
          </dl>
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
                <p className="info-hero">
                  {number(snapshot?.feeRate ?? null, 2)}
                  <span>{bitcoin ? 'sat/vB' : 'Gwei'}</span>
                </p>
                <p className="info-hero-caption">
                  {bitcoin ? 'Frais conseillés · environ 30 min' : 'Frais de base du dernier bloc'}
                </p>
                <dl className="info-details">
                  <Detail label={bitcoin || demo ? 'En attente dans la source' : 'Mempool mondial'}>
                    {snapshot?.pendingCount === null || !snapshot
                      ? 'Non mesuré'
                      : `${number(snapshot.pendingCount)} transactions`}
                  </Detail>
                  <Detail label="Échantillon reçu">
                    {snapshot ? `${number(snapshot.transactions.length)} transactions` : '—'}
                  </Detail>
                  <Detail label="Source">{snapshot?.source ?? 'En attente'}</Detail>
                </dl>
                <p className="info-explanation">
                  {bitcoin
                    ? 'Les frais influencent la priorité. Le délai d’inclusion reste incertain.'
                    : 'Les frais de base excluent le pourboire. Aucun inventaire mondial des transactions en attente n’est fourni.'}
                </p>
              </>
            )}
            {page === 1 && (
              <>
                <h3>Le dernier départ.</h3>
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
                  {demo
                    ? 'Ce départ est une illustration pédagogique.'
                    : 'Observé ne signifie pas finalisé. Le prochain départ n’a pas d’échéance garantie.'}
                </p>
              </>
            )}
            {page === 2 && (
              <>
                <h3>À chacun sa place.</h3>
                <span className="info-projection-label">Projection pédagogique</span>
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
                <p className="info-explanation">
                  Les voyageurs avancent selon leurs frais et la place disponible. Les moins
                  prioritaires peuvent revenir au quai.
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
            {rotationEnabled ? 'Défilement automatique' : 'Activer le défilement'}
            {(paused || reducedMotion) && rotationEnabled ? ' · en pause' : ''}
          </button>
        </>
      )}

      <div className={`info-panel-source info-source-${snapshot?.status ?? 'loading'}`}>
        <span>
          <i />
          {sourceState}
        </span>
        {snapshot && (
          <time dateTime={new Date(snapshot.observedAt).toISOString()}>
            Relevé à {new Date(snapshot.observedAt).toLocaleTimeString('fr-CH')}
          </time>
        )}
      </div>
    </aside>
  );
}
