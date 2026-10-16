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
import { activeBitcoinBlockTemplate } from './lib/passengerMotion';

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
  const [browseTargets, setBrowseTargets] = useState<Record<ChainId, HTMLDivElement | null>>({
    bitcoin: null,
    ethereum: null,
  });
  const registerBrowseTarget = useCallback((id: ChainId, element: HTMLDivElement | null) => {
    setBrowseTargets((current) =>
      current[id] === element ? current : { ...current, [id]: element },
    );
  }, []);
  const bitcoinBrowseTarget = useCallback(
    (element: HTMLDivElement | null) => registerBrowseTarget('bitcoin', element),
    [registerBrowseTarget],
  );
  const ethereumBrowseTarget = useCallback(
    (element: HTMLDivElement | null) => registerBrowseTarget('ethereum', element),
    [registerBrowseTarget],
  );
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
  const informationToggle = useRef<HTMLButtonElement>(null);
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
  const activeTemplate = snapshot ? activeBitcoinBlockTemplate(snapshot) : null;
  const selected = selection
    ? (feeds[selection.chain].snapshot?.transactions.find((tx) => tx.id === selection.id) ??
      selection.transaction)
    : null;
  const fairUrl = safeExternalUrl(brand.fairOnChainUrl);
  const closeInformation = useCallback(() => {
    setInfoOpen(false);
    setSelection(null);
    informationToggle.current?.focus();
  }, []);

  useEffect(() => {
    // Only the selected observation is retained when it leaves the bounded source sample.
    setSelection((current) => {
      if (!current) return current;
      const latest = current.chain === 'bitcoin' ? bitcoin.snapshot : ethereum.snapshot;
      const observed = latest?.transactions.find((tx) => tx.id === current.id);
      if (observed) {
        return observed === current.transaction ? current : { ...current, transaction: observed };
      }
      const inclusion = latest?.inclusions?.find((entry) =>
        entry.transactionIds.some((id) => id.toLowerCase() === current.id.toLowerCase()),
      );
      if (
        !inclusion ||
        (current.transaction.status === 'confirmed' &&
          current.transaction.blockHash === inclusion.block.hash)
      ) {
        return current;
      }
      return {
        ...current,
        transaction: {
          ...current.transaction,
          status: 'confirmed',
          blockHash: inclusion.block.hash,
        },
      };
    });
  }, [bitcoin.snapshot, ethereum.snapshot]);

  useEffect(() => {
    if (view === 'visual') navigationFocus.current?.focus();
    else contentClose.current?.focus();
  }, [view]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // A transaction browser consumes Escape first; close its containing panel
      // only on a subsequent key press.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (view !== 'visual') {
        event.preventDefault();
        setView('visual');
      } else if (infoOpen) {
        event.preventDefault();
        closeInformation();
      }
    };
    const screen = () => setFullScreen(document.fullscreenElement !== null);
    document.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', screen);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', screen);
    };
  }, [view, infoOpen, closeInformation]);

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
            const nodeTemplate = current ? activeBitcoinBlockTemplate(current) : null;
            const previousTemplate = current?.blockTemplate ?? feed.expiredBlockTemplate;
            const displayedTemplate = nodeTemplate ?? previousTemplate;
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
                  <div className="chain-departure-line">
                    <span className="chain-departure-label">
                      <span className="chain-departure-label-full">
                        {mode === 'demo' ? 'Depuis le départ simulé' : 'Depuis le dernier départ'}
                      </span>
                      <span className="chain-departure-label-compact" aria-hidden="true">
                        Départ
                      </span>
                    </span>
                    <DepartureTimer departedAt={lastDepartures[id]} demo={mode === 'demo'} />
                    <div
                      ref={id === 'bitcoin' ? bitcoinBrowseTarget : ethereumBrowseTarget}
                      className="chain-transaction-controls"
                      data-transaction-controls={id}
                    />
                  </div>
                </header>
                <div className="scene-stage">
                  {current && current.status !== 'unavailable' ? (
                    <StreetScene
                      key={`${id}:${mode}`}
                      snapshot={current}
                      browseTarget={browseTargets[id]}
                      paused={paused}
                      speed={speed}
                      reducedMotion={reducedMotion}
                      feeDisplayUnit={feeDisplayUnit}
                      onDeparture={recordDeparture}
                      onActivity={recordActivity}
                      onSelect={selectTransaction}
                      selectedId={selected?.chain === id ? selected.id : undefined}
                      selectedFallback={selected?.chain === id ? selected : undefined}
                      theme={theme}
                      mirrored={id === 'bitcoin'}
                      onClearSelection={clearSelection}
                      onCloseInfo={closeInformation}
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
                      selectedTx={selected?.chain === id ? selected : null}
                      selectedHistorical={selected?.chain === id}
                      paused={paused}
                      reducedMotion={reducedMotion}
                      onClearSelection={clearSelection}
                      onClose={closeInformation}
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
                <p
                  className="chain-coverage"
                  title={current?.coverage}
                  data-template-count={nodeTemplate?.transactionCount}
                >
                  {mode === 'demo'
                    ? 'Données fictives'
                    : nodeTemplate
                      ? `Candidat complet : ${nodeTemplate.transactionCount.toLocaleString('fr-CH')} tx proposées hors coinbase`
                      : previousTemplate
                        ? 'Ancien candidat du nœud · estimation'
                        : current?.bitcoinArrivals
                          ? 'Échantillon mixte · arrivées réelles'
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
                  {nodeTemplate
                    ? `détails individuels reçus (maximum ${PENDING_SAMPLE_LIMIT})`
                    : 'en attente échantillonnées'}
                  {current?.bitcoinArrivals &&
                    ` · dont ${current.bitcoinArrivals.transactionIds.length.toLocaleString('fr-CH')} arrivées récentes`}
                  {displayedTemplate
                    ? ` · #${displayedTemplate.height.toLocaleString('fr-CH')}${nodeTemplate ? '' : ` · ${displayedTemplate.transactionCount.toLocaleString('fr-CH')} transactions proposées hors coinbase`} · ${displayedTemplate.source}`
                    : current?.sampling
                      ? ` · ${current.sampling.source}`
                      : ''}
                  {current?.observedAt
                    ? ` · relevé ${new Date(displayedTemplate?.observedAt ?? (current.bitcoinArrivals ? current.observedAt : current.sampling?.observedAt) ?? current.observedAt).toLocaleTimeString('fr-CH')}`
                    : ''}
                  {nodeTemplate && ' · Aucune preuve qu’un pool le mine.'}
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
                    illustre ses besoins en espace ou en gas, avec une différence de taille
                    accentuée. L’accessoire bleu cyan identifie une transaction classée comme
                    interaction ou création de contrat dans les données reçues. La ville ne montre
                    pas toutes les transactions.
                  </Lesson>
                  <Lesson
                    n="02"
                    title="Pourquoi deux wagons ?"
                    detail="À l’arrivée d’un nouveau bloc, le premier wagon se prépare pendant au moins trois secondes pour Bitcoin et 1,5 seconde pour Ethereum : les transactions dont l’inclusion est vérifiée embarquent, tandis que les autres retournent sur le quai. Les compléments identifiés pendant cette préparation rejoignent le même départ. Il part ensuite avec les inclusions connues, une fois leurs passages terminés. Le second wagon monte à sa place, puis un nouveau second arrive du bas. Les anciennes observations regroupées gardent jusqu’à 512 identifiants pendant 30 minutes : si une inclusion est retrouvée, leur voyageur revient du groupe et rejoint le départ du bloc concerné. Les observations au-delà de ces limites restent représentées sans suivi individuel. Seule la source confirme une inclusion : l’animation ne change pas le statut."
                  >
                    Le wagon du haut projette le prochain bloc ; celui du bas projette le bloc qui
                    pourrait suivre. Pour Bitcoin, « Candidat du nœud » indique une sélection
                    proposée par le nœud observé ; sinon le premier wagon reste une estimation. Le
                    second wagon reste une estimation. La place représentée utilise les vBytes pour
                    Bitcoin et le gas pour Ethereum. Hors candidat fourni, les frais ordonnent les
                    priorités lorsque la place manque. Un voyageur déjà embarqué peut conserver une
                    réservation si le tarif recommandé Bitcoin augmente ou s’il disparaît simplement
                    du nouvel échantillon. Dans ce dernier cas, l’horloge signale une observation
                    conservée, sans certifier sa présence actuelle dans le mempool. Ces projections
                    ne garantissent ni l’ordre ni l’inclusion. Un candidat du nœud ne prouve pas
                    qu’un pool minier le mine.
                  </Lesson>
                  <Lesson n="03" title="Bitcoin : partager un espace limité">
                    Les frais s’expriment en satoshis par vByte. Les mineurs choisissent les
                    transactions selon plusieurs contraintes, dont les dépendances entre
                    transactions. Un tarif élevé ne garantit ni place ni délai. L’indicateur du haut
                    affiche en BTC ou en dollars la médiane des frais de toutes les transactions du
                    candidat du nœud, hors coinbase, quand ce calcul complet est disponible. Sinon,
                    il donne le coût médian estimé du seul échantillon reçu, en le signalant. Aucune
                    de ces médianes ne représente tout le mempool ni des frais confirmés.
                  </Lesson>
                  <Lesson n="04" title="Ethereum : le gas et la priorité">
                    Le gas mesure le travail demandé. Avec EIP-1559, le prix effectif dépend
                    notamment des frais de base, du plafond et du pourboire. Le nonce, les
                    contraintes de gas et les transactions privées influencent aussi l’inclusion. Le
                    coût médian affiché utilise le prix du gas observé et la limite de gas déclarée
                    de chaque transaction de l’échantillon. Il ne mesure pas les frais réellement
                    payés.
                  </Lesson>
                  <Lesson
                    n="05"
                    title="Un mempool est une vue locale"
                    detail="La rubrique Flux privilégie les événements envoyés par le fournisseur : ajouts Bitcoin et notifications pending Ethereum. Une notification Ethereum peut être une promotion depuis queued ou une réémission, sans être une première arrivée mondiale. Le relevé périodique de deux inventaires complets reste un secours distinct ; il compte les entrées séparément des disparitions. Le débit est une moyenne sur la durée indiquée, avec une courbe des observations récentes. Sur Bitcoin, les détails réels des ajouts du flux alimentent jusqu’à 384 places à l’intérieur de l’échantillon de 1 920 transactions ; leur présence dans ce fournisseur ne garantit ni sélection dans le candidat du nœud ni inclusion. Le complément reste issu du candidat ou du relevé disponible : cet échantillon mixte n’est pas un classement global des frais. Sur Ethereum, le groupe +X hors échantillon signale les notifications absentes de la sélection pending lors de la première publication du lot ; certains identifiants peuvent déjà être conservés dans les observations de la scène. Ce groupe n’est pas un effectif à additionner aux voyageurs et ne monte pas dans un wagon. La borne réseau haute garde un autre rôle : les inclusions découvertes dans un bloc reçu. Une coupure ne restitue pas les événements manqués, et une disparition ne prouve aucune confirmation."
                  >
                    Chaque nœud voit sa propre file. Pour Ethereum, le bloc candidat du fournisseur
                    n’est pas un mempool global. Une absence à l’écran ne signifie pas qu’une
                    transaction n’existe pas. « Mempool source » affiche le comptage du fournisseur
                    observé, lorsqu’il le donne. Sur Ethereum, il réunit pending et queued ; les
                    transactions différées peuvent attendre un nonce précédent. L’échantillon
                    visible ne remplace jamais un compteur indisponible. La rubrique Flux donne
                    aussi une idée des arrivées observées. Sur Bitcoin, les arrivées détaillées
                    rejoignent l’échantillon et deviennent des bonshommes individuels. Sur Ethereum,
                    un groupe « +X hors échantillon » complète les entrées latérales. Un premier
                    relevé ou une panne ne sont jamais affichés comme un flux nul.
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
                      Blocs et frais conseillés : mempool.space par défaut. Le candidat du nœud
                      obtenu par getblocktemplate est prioritaire, via Bitcoin PublicNode par
                      défaut. Son nombre complet de transactions hors coinbase, son poids et sa
                      médiane complète de frais sont calculés avant de limiter les détails
                      individuels à {PENDING_SAMPLE_LIMIT}. Une représentation collective peut
                      compléter ces détails, sans inventer de transactions individuelles. Cette
                      proposition ne décrit pas tout le mempool et aucun pool minier n’est réputé la
                      miner. En secours, le classement utilise le pool RPC complet, puis la
                      projection mempool.space et enfin ses seules transactions récentes ; le
                      périmètre estimé reste annoncé.
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
                    <dd>
                      {activeTemplate
                        ? `Candidat du nœud · ${activeTemplate.source}`
                        : (snapshot?.source ?? 'Connexion en cours')}
                    </dd>
                  </div>
                  {activeTemplate && (
                    <>
                      <div>
                        <dt>Candidat proposé</dt>
                        <dd>
                          #{activeTemplate.height.toLocaleString('fr-CH')} ·{' '}
                          {activeTemplate.transactionCount.toLocaleString('fr-CH')} transactions
                          hors coinbase · {activeTemplate.weight.toLocaleString('fr-CH')} WU ·
                          jusqu’à {PENDING_SAMPLE_LIMIT} détails individuels · relevé à{' '}
                          <time dateTime={new Date(activeTemplate.observedAt).toISOString()}>
                            {new Date(activeTemplate.observedAt).toLocaleTimeString('fr-CH')}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Blocs et comptage du mempool</dt>
                        <dd>{snapshot?.source}</dd>
                      </div>
                    </>
                  )}
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
              aria-label="Vitesse d’animation"
            >
              <option value={0.5}>0,5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={5}>5×</option>
              <option value={10}>10×</option>
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
          {paused ? 'Animation en pause · données actualisées · ' : ''}
          T-shirt : frais relatifs à l’échantillon · Tête = vBytes / limite de gas · Embarquement ≠
          confirmation
        </p>
        <div className="immersion-actions">
          <button
            ref={informationToggle}
            className={infoOpen ? 'active' : ''}
            aria-label={
              infoOpen ? 'Masquer le panneau d’informations' : 'Afficher le panneau d’informations'
            }
            aria-expanded={infoOpen}
            onClick={() => {
              if (infoOpen) closeInformation();
              else setInfoOpen(true);
            }}
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
