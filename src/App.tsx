import { useCallback, useEffect, useRef, useState } from 'react';
import { PENDING_SAMPLE_LIMIT, type ChainId, type Tx } from '../shared/model';
import { StreetScene } from './components/StreetScene';
import { SharedCampus } from './components/SharedCampus';
import { GlobalQueue } from './components/GlobalQueue';
import { InfoPanel, type SceneActivity } from './components/InfoPanel';
import { InfoBillboard } from './components/InfoBillboard';
import { DepartureTimer } from './components/DepartureTimer';
import { Icon } from './components/Icon';
import { brand, safeExternalUrl } from './config/brand';
import { useSnapshot } from './hooks/useSnapshot';
import type { FeeDisplayUnit } from './lib/feeDisplay';
import { useProviderMempool } from './hooks/useSourceFreshness';
import { globalQueueGroupSize } from './lib/globalQueue';

const chains = {
  bitcoin: { name: 'Bitcoin', symbol: '₿', ticker: 'BTC' },
  ethereum: { name: 'Ethereum', symbol: '◆', ticker: 'ETH' },
} as const;
const chainIds: ChainId[] = ['bitcoin', 'ethereum'];
const EMPTY_ACTIVITY: SceneActivity = { walking: 0, boarded: 0, returning: 0, waiting: 0 };

export function App() {
  const [chain, setChain] = useState<ChainId>('bitcoin');
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [view, setView] = useState<'visual' | 'learn' | 'sources'>('visual');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [feeDisplayUnit, setFeeDisplayUnit] = useState<FeeDisplayUnit>('native');
  const [lastDepartures, setLastDepartures] = useState<Record<ChainId, number | null>>({
    bitcoin: null,
    ethereum: null,
  });
  const recordDeparture = useCallback((id: ChainId, departedAt: number) => {
    setLastDepartures((current) =>
      current[id] === departedAt ? current : { ...current, [id]: departedAt },
    );
  }, []);
  const [sceneActivity, setSceneActivity] = useState<Record<ChainId, SceneActivity>>({
    bitcoin: EMPTY_ACTIVITY,
    ethereum: EMPTY_ACTIVITY,
  });
  const recordActivity = useCallback((id: ChainId, activity: SceneActivity) => {
    setSceneActivity((current) =>
      current[id].walking === activity.walking &&
      current[id].boarded === activity.boarded &&
      current[id].returning === activity.returning &&
      current[id].waiting === activity.waiting
        ? current
        : { ...current, [id]: activity },
    );
  }, []);
  const [selection, setSelection] = useState<{
    chain: ChainId;
    id: string;
    transaction: Tx;
  } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [theme, setTheme] = useState<'heg' | 'neutral'>('heg');
  const [fullScreen, setFullScreen] = useState(false);
  const [screenMessage, setScreenMessage] = useState('');
  const contentClose = useRef<HTMLButtonElement>(null);
  const navigationFocus = useRef<HTMLButtonElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const bitcoin = useSnapshot('bitcoin', mode);
  const ethereum = useSnapshot('ethereum', mode);
  const bitcoinPool = useProviderMempool(bitcoin.snapshot);
  const ethereumPool = useProviderMempool(ethereum.snapshot);
  const queueGroupSize = globalQueueGroupSize([bitcoinPool.total, ethereumPool.total]);
  const feeds = { bitcoin, ethereum };
  const snapshot = feeds[chain].snapshot;
  const selected = selection
    ? (feeds[selection.chain].snapshot?.transactions.find((tx) => tx.id === selection.id) ??
      (feeds[selection.chain].snapshot?.inclusions?.some(
        (inclusion) =>
          inclusion.block.hash === selection.transaction.blockHash &&
          inclusion.transactionIds.includes(selection.id),
      )
        ? selection.transaction
        : null))
    : null;
  const fairUrl = safeExternalUrl(brand.fairOnChainUrl);

  useEffect(() => {
    if (view === 'visual') navigationFocus.current?.focus();
    else contentClose.current?.focus();
  }, [view]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelection(null);
      setView('visual');
    };
    const screen = () => setFullScreen(document.fullscreenElement !== null);
    document.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', screen);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', screen);
    };
  }, []);

  function changeChain(value: ChainId) {
    setChain(value);
    setSelection(null);
  }
  function changeMode(value: 'live' | 'demo') {
    if (value !== mode) {
      setLastDepartures({ bitcoin: null, ethereum: null });
      setSceneActivity({ bitcoin: EMPTY_ACTIVITY, ethereum: EMPTY_ACTIVITY });
    }
    setMode(value);
    setSelection(null);
  }
  const selectTransaction = useCallback((tx: Tx) => {
    setChain(tx.chain);
    setSelection({ chain: tx.chain, id: tx.id, transaction: tx });
    setInfoOpen(true);
  }, []);
  const clearSelection = useCallback(() => setSelection(null), []);
  async function toggleFullScreen() {
    setScreenMessage('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenMessage('Le navigateur a refusé le plein écran. La vue immersive reste disponible.');
    }
  }

  return (
    <div className={`app immersive-app theme-${theme}`}>
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <header className="immersion-topbar">
        <a className="wordmark" href="#main" aria-label="BlockLane accueil">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          {brand.name}
          <span className="wordmark-dot">.</span>
        </a>
        <div className="chain-tabs" aria-label="Réseau du panneau d’informations">
          {chainIds.map((id) => (
            <button
              key={id}
              className={`chain-tab ${chain === id ? 'selected' : ''}`}
              aria-label={chains[id].name}
              aria-pressed={chain === id}
              onClick={() => changeChain(id)}
            >
              <span className={`coin tiny ${id}`}>{chains[id].symbol}</span>
              <span className="control-label-full">{chains[id].name}</span>
              <span className="control-label-compact" aria-hidden="true">
                {chains[id].ticker}
              </span>
            </button>
          ))}
        </div>
        <div className="mode-switch" aria-label="Source des données">
          <button
            className={mode === 'live' ? 'selected' : ''}
            aria-pressed={mode === 'live'}
            onClick={() => changeMode('live')}
          >
            <span className="live-dot" />
            Direct
          </button>
          <button
            className={mode === 'demo' ? 'selected' : ''}
            aria-pressed={mode === 'demo'}
            onClick={() => changeMode('demo')}
          >
            Simulation
          </button>
        </div>
        <nav className="immersion-navigation" aria-label="Navigation principale">
          <button
            onClick={(event) => {
              navigationFocus.current = event.currentTarget;
              setView('learn');
            }}
            aria-label="Comprendre"
          >
            <Icon name="book" size={17} />
            <span>Comprendre</span>
          </button>
          <button
            onClick={(event) => {
              navigationFocus.current = event.currentTarget;
              setView('sources');
            }}
            aria-label="Les données"
          >
            <Icon name="signal" size={17} />
            <span>Les données</span>
          </button>
          <button
            onClick={() => setTheme(theme === 'heg' ? 'neutral' : 'heg')}
            aria-label={`Changer l’identité visuelle, actuellement ${theme === 'heg' ? 'HEG' : 'neutre'}`}
          >
            <span>Identité :</span> {theme === 'heg' ? 'HEG' : 'neutre'}
          </button>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="immersion-main">
        <h1 className="visually-hidden">Bitcoin et Ethereum en mouvement</h1>
        <div
          className="twin-streets"
          aria-label="Bitcoin et Ethereum visibles simultanément"
          inert={view !== 'visual'}
        >
          {chainIds.map((id) => {
            const feed = feeds[id];
            const current = feed.snapshot;
            const network = chains[id];
            const label =
              mode === 'demo'
                ? 'Simulation pédagogique'
                : current?.status === 'ok'
                  ? 'Données en direct'
                  : current?.status === 'stale'
                    ? 'Dernières données conservées'
                    : current?.status === 'unavailable' || feed.connectionError
                      ? 'Source indisponible'
                      : 'Connexion à la source…';
            const compactLabel =
              mode === 'demo'
                ? 'Simulation'
                : current?.status === 'ok'
                  ? 'Direct'
                  : current?.status === 'stale'
                    ? 'Données anciennes'
                    : current?.status === 'unavailable' || feed.connectionError
                      ? 'Indisponible'
                      : 'Connexion…';
            return (
              <section
                key={id}
                className={`chain-pane chain-pane--${id}`}
                data-chain={id}
                aria-label={`Visualisation ${network.name}`}
              >
                <header className="chain-heading">
                  <div className="chain-title">
                    <span className={`coin ${id}`}>{network.symbol}</span>
                    <h2>
                      {network.name}
                      <span className="chain-avenue"> Avenue</span>
                    </h2>
                    <span
                      className={`data-status ${current?.status === 'ok' && mode === 'live' ? 'healthy' : ''}`}
                      role="status"
                      aria-label={label}
                      title={label}
                    >
                      <span className="data-status-dot" />
                      <span className="data-status-label">{label}</span>
                      <span className="data-status-compact" aria-hidden="true">
                        {compactLabel}
                      </span>
                    </span>
                  </div>
                  {current ? (
                    <InfoBillboard
                      snapshot={current}
                      activity={
                        current.status === 'unavailable' ? EMPTY_ACTIVITY : sceneActivity[id]
                      }
                      paused={paused}
                      reducedMotion={reducedMotion}
                      selected={selected?.chain === id}
                      feeDisplayUnit={feeDisplayUnit}
                      theme={theme}
                      top
                    />
                  ) : (
                    <div className="billboard-loading">Connexion à la source…</div>
                  )}
                  <p className="chain-departure-line">
                    {mode === 'demo' ? 'Depuis le départ simulé' : 'Depuis le dernier départ'}{' '}
                    <DepartureTimer departedAt={lastDepartures[id]} demo={mode === 'demo'} />
                  </p>
                </header>
                <div className="scene-stage">
                  {current && current.status !== 'unavailable' ? (
                    <StreetScene
                      key={`${id}:${mode}`}
                      snapshot={current}
                      paused={paused}
                      speed={speed}
                      reducedMotion={reducedMotion}
                      feeDisplayUnit={feeDisplayUnit}
                      onDeparture={recordDeparture}
                      onActivity={recordActivity}
                      onSelect={selectTransaction}
                      selectedId={selected?.chain === id ? selected.id : undefined}
                      theme={theme}
                      mirrored={id === 'bitcoin'}
                      onClearSelection={clearSelection}
                      immersive
                      showInfo={infoOpen && chain === id}
                    />
                  ) : (
                    <div className="empty-state">
                      <Icon name="city" size={40} />
                      <h3>
                        {current?.status === 'unavailable' || feed.connectionError
                          ? 'Le réseau se fait attendre.'
                          : 'La ville se prépare…'}
                      </h3>
                      <p>
                        {current?.message ??
                          feed.connectionError ??
                          'Connexion aux données publiques du réseau.'}
                      </p>
                      {(current?.status === 'unavailable' || feed.connectionError) && (
                        <div className="empty-actions">
                          <button className="button-primary" onClick={feed.retry}>
                            Réessayer
                          </button>
                          <button className="button-secondary" onClick={() => changeMode('demo')}>
                            Explorer la simulation
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {infoOpen && chain === id && (!current || current.status === 'unavailable') && (
                    <InfoPanel
                      feeDisplayUnit={feeDisplayUnit}
                      snapshot={current}
                      selectedTx={null}
                      paused={paused}
                      reducedMotion={reducedMotion}
                    />
                  )}
                </div>
                {current?.status === 'stale' && (
                  <p className="stale-warning" role="alert">
                    {current.message ?? feed.connectionError} Les données affichées ne sont plus à
                    jour.
                  </p>
                )}
                <GlobalQueue
                  snapshot={current}
                  chain={id}
                  mode={mode}
                  transactionsPerGroup={queueGroupSize}
                />
                <p className="chain-coverage" title={current?.coverage}>
                  {mode === 'demo'
                    ? 'Données fictives'
                    : current?.sampling
                      ? 'Top des pending · pool observé'
                      : 'Sélection partielle'}{' '}
                  ·{' '}
                  {current
                    ? Math.min(
                        PENDING_SAMPLE_LIMIT,
                        current.transactions.filter((tx) => tx.status === 'pending').length,
                      )
                    : 0}{' '}
                  en attente échantillonnées
                  {current?.sampling ? ` · ${current.sampling.source}` : ''}
                  {current?.observedAt
                    ? ` · relevé ${new Date(current.sampling?.observedAt ?? current.observedAt).toLocaleTimeString('fr-CH')}`
                    : ''}
                </p>
              </section>
            );
          })}
          <SharedCampus theme={theme} />
        </div>
        {view !== 'visual' && (
          <div className="content-overlay">
            <button
              ref={contentClose}
              className="content-close button-secondary"
              onClick={() => setView('visual')}
            >
              <Icon name="close" size={17} />
              Retourner dans la ville
            </button>
            {view === 'learn' && (
              <section className="content-panel">
                <p className="eyebrow">LIRE LA VILLE</p>
                <h2>
                  Un réseau complexe.
                  <br />
                  Une métaphore simple.
                </h2>
                <div className="learning-grid">
                  <Lesson n="01" title="Les voyageurs sont des transactions">
                    Chaque personnage représente une transaction de notre échantillon. Son t-shirt
                    passe du jaune pour des frais faibles à l'orange à la moyenne, puis au rouge
                    pour des frais élevés. La référence est la moyenne des voyageurs en attente
                    actuellement affichés sur cette blockchain, pas une moyenne mondiale. Sur le
                    quai, les places déjà attribuées restent dans l'ordre d'arrivée observé. Les
                    nouveaux voyageurs occupent les places libres par frais décroissants. Sa tête
                    illustre ses besoins en espace ou en gas. La ville ne montre pas toutes les
                    transactions.
                  </Lesson>
                  <Lesson
                    n="02"
                    title="Pourquoi deux wagons ?"
                    detail="À l’arrivée d’un nouveau bloc, le premier wagon se prépare pendant au moins une seconde : les transactions dont l’inclusion est vérifiée embarquent rapidement, tandis que les autres retournent sur le quai. Il part ensuite avec les inclusions connues. Le second wagon monte à sa place, puis un nouveau second arrive du bas. Les anciennes observations regroupées gardent jusqu’à 512 identifiants pendant 30 minutes : si une inclusion est retrouvée, leur voyageur revient du groupe et rejoint le départ du bloc concerné. Les observations au-delà de ces limites restent représentées sans suivi individuel. Seule la source confirme une inclusion : l’animation ne change pas le statut."
                  >
                    Le wagon du haut projette le prochain bloc ; celui du bas projette le bloc qui
                    pourrait suivre. Leurs voyageurs viennent de notre échantillon de transactions
                    en attente et leur sélection évolue selon les frais et la place disponible.
                    Chaque wagon dispose de 12 unités pédagogiques : elles ne représentent pas la
                    capacité réelle et ne garantissent ni l’ordre ni l’inclusion.
                  </Lesson>
                  <Lesson n="03" title="Bitcoin : partager un espace limité">
                    Les frais s’expriment en satoshis par vByte. Les mineurs choisissent les
                    transactions selon plusieurs contraintes, dont les dépendances entre
                    transactions. Un tarif élevé ne garantit ni place ni délai. L’indicateur du haut
                    affiche le coût médian estimé par transaction en attente de notre échantillon,
                    en BTC ou en dollars. Cet échantillon privilégie les frais élevés et ne
                    représente pas la médiane de tout le réseau.
                  </Lesson>
                  <Lesson n="04" title="Ethereum : le gas et la priorité">
                    Le gas mesure le travail demandé. Avec EIP-1559, le prix effectif dépend
                    notamment des frais de base, du plafond et du pourboire. Le nonce, les
                    contraintes de gas et les transactions privées influencent aussi l’inclusion. Le
                    coût médian affiché utilise le prix du gas observé et la limite de gas déclarée
                    de chaque transaction de l’échantillon. Il ne mesure pas les frais réellement
                    payés.
                  </Lesson>
                  <Lesson n="05" title="Un mempool est une vue locale">
                    Chaque nœud voit sa propre file. Pour Ethereum, le bloc candidat du fournisseur
                    n’est pas un mempool global. Une absence à l’écran ne signifie pas qu’une
                    transaction n’existe pas. « Mempool source » affiche le comptage du fournisseur
                    observé, lorsqu’il le donne. Sur Ethereum, il réunit pending et queued ; les
                    transactions différées peuvent attendre un nonce précédent. L’échantillon
                    visible ne remplace jamais un compteur indisponible.
                  </Lesson>
                  <Lesson n="06" title="Un départ n’est pas une finalité">
                    Une inclusion récente peut être remise en cause par une réorganisation. Ethereum
                    distingue notamment les états safe et finalized. Cette première version affiche
                    l’inclusion observée, sans certifier la finalité.
                  </Lesson>
                </div>
              </section>
            )}

            {view === 'sources' && (
              <section className="content-panel">
                <p className="eyebrow">LA TRANSPARENCE FAIT PARTIE DU PAYSAGE</p>
                <h2>
                  D’où viennent
                  <br />
                  les voyageurs ?
                </h2>
                <div className="source-grid">
                  <article>
                    <span className="coin bitcoin">₿</span>
                    <h3>Bitcoin</h3>
                    <p>
                      Blocs et frais conseillés : mempool.space par défaut. Le classement des frais
                      utilise le mempool complet d’un RPC distinct, Bitcoin PublicNode par défaut,
                      lorsque sa collecte aboutit. Sinon, une sélection partielle est signalée.
                    </p>
                    <a
                      className="text-link"
                      href="https://mempool.space/docs/api/rest"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Documentation API <Icon name="external" size={14} />
                    </a>
                  </article>
                  <article>
                    <span className="coin ethereum">◆</span>
                    <h3>Ethereum</h3>
                    <p>
                      JSON-RPC mainnet, PublicNode par défaut. Le classement utilise les
                      transactions pending éligibles du pool complet lorsque le fournisseur le
                      permet ; le bloc candidat sert de repli partiel. Cette vue locale ne couvre
                      pas les transactions privées ni tous les nœuds.
                    </p>
                    <a
                      className="text-link"
                      href="https://ethereum.org/developers/docs/apis/json-rpc/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Standard JSON-RPC <Icon name="external" size={14} />
                    </a>
                  </article>
                </div>
                <dl className="source-details">
                  <div>
                    <dt>Source active</dt>
                    <dd>{snapshot?.source ?? 'Connexion en cours'}</dd>
                  </div>
                  <div>
                    <dt>Couverture</dt>
                    <dd>{snapshot?.coverage ?? 'Non disponible'}</dd>
                  </div>
                  <div>
                    <dt>Actualisation</dt>
                    <dd>
                      Lecture 3 secondes après chaque réponse en direct, cache partagé de 3 secondes
                      après collecte. Le temps de collecte s’ajoute à ces délais. Dernière
                      observation affichée dans la ville.
                    </dd>
                  </div>
                  <div>
                    <dt>En cas de panne</dt>
                    <dd>
                      Les données conservées portent l’étiquette « dernières données ». La
                      simulation doit être choisie explicitement.
                    </dd>
                  </div>
                  <div>
                    <dt>Confidentialité</dt>
                    <dd>
                      Aucun portefeuille connecté, aucune signature, aucun suivi publicitaire. Les
                      liens externes sont ouverts à votre demande.
                    </dd>
                  </div>
                </dl>
              </section>
            )}
          </div>
        )}
      </main>
      <div className="immersion-controls">
        <div className="animation-controls">
          <button
            className="fee-unit-switch"
            role="switch"
            aria-checked={feeDisplayUnit === 'usd'}
            aria-label="Afficher les frais en dollars américains"
            title="Basculer entre les frais natifs et leur estimation en dollars américains"
            onClick={() =>
              setFeeDisplayUnit((current) => (current === 'native' ? 'usd' : 'native'))
            }
          >
            <span className="fee-unit-switch-track" aria-hidden="true">
              <i />
            </span>
            Frais : {feeDisplayUnit === 'usd' ? '$ US' : 'natifs'}
          </button>
          <button
            aria-pressed={paused}
            aria-label={paused ? 'Reprendre l’animation' : 'Mettre l’animation en pause'}
            onClick={() => setPaused(!paused)}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
            <span className="pause-label">{paused ? 'Reprendre' : 'Pause'}</span>
          </button>
          <label>
            <span className="speed-label">Vitesse</span>{' '}
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              aria-label="Vitesse de simulation"
            >
              <option value={0.5}>0,5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </label>
          <button
            aria-pressed={reducedMotion}
            aria-label={reducedMotion ? 'Activer les mouvements' : 'Réduire les mouvements'}
            onClick={() => setReducedMotion(!reducedMotion)}
          >
            <span className="control-label-full">
              Mouvements {reducedMotion ? 'réduits' : 'actifs'}
            </span>
            <span className="control-label-compact" aria-hidden="true">
              Mouv. {reducedMotion ? 'réduits' : 'actifs'}
            </span>
          </button>
        </div>
        <p className="immersion-hint">
          T-shirt : jaune faible → rouge fort · Tête = vBytes / gas · Embarquement ≠ confirmation
        </p>
        <div className="immersion-actions">
          <button
            className={infoOpen ? 'active' : ''}
            aria-label={
              infoOpen ? 'Masquer le panneau d’informations' : 'Afficher le panneau d’informations'
            }
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen(!infoOpen)}
          >
            <Icon name="signal" size={16} />
            <span className="control-label-full">Informations</span>
            <span className="control-label-compact" aria-hidden="true">
              Infos
            </span>
          </button>
          {document.fullscreenEnabled && (
            <button
              onClick={() => void toggleFullScreen()}
              aria-label={fullScreen ? 'Quitter le plein écran' : 'Plein écran'}
            >
              <span className="control-label-full">
                {fullScreen ? 'Quitter le plein écran' : 'Plein écran'}
              </span>
              <span className="control-label-compact" aria-hidden="true">
                {fullScreen ? 'Réduire' : 'Écran'}
              </span>
            </button>
          )}
          {fairUrl && (
            <a href={fairUrl} target="_blank" rel="noopener noreferrer">
              FairOnChain ↗
            </a>
          )}
        </div>
      </div>
      {screenMessage && (
        <p className="fullscreen-message" role="status">
          {screenMessage}
        </p>
      )}
    </div>
  );
}

function Lesson({
  n,
  title,
  children,
  detail,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  detail?: string;
}) {
  return (
    <article>
      <span className="lesson-number">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {detail && <p>{detail}</p>}
    </article>
  );
}
