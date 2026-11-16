import { useI18n, languageTag } from './i18n';
import { sourceCoverage, sourceMessage, sourceName } from './lib/sourceDescription';
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
  const { locale, setLocale, t } = useI18n();
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
  const [screenMessage, setScreenMessage] = useState(false);
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
    setScreenMessage(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenMessage(true);
    }
  }

  return (
    <div className={`app immersive-app theme-${theme}`}>
      <a className="skip-link" href="#main">
        {t('Aller au contenu', 'Skip to content')}
      </a>
      <header className="immersion-topbar">
        <a className="wordmark" href="#main" aria-label={t('BlockLane accueil', 'BlockLane home')}>
          <span className="brand-mark">
            <i />
            <i />
          </span>
          {brand.name}
          <span className="wordmark-dot">.</span>
        </a>
        <div
          className="chain-tabs"
          aria-label={t('Réseau du panneau d’informations', 'Information panel network')}
        >
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
        <div className="mode-switch" aria-label={t('Source des données', 'Data source')}>
          <button
            className={mode === 'live' ? 'selected' : ''}
            aria-pressed={mode === 'live'}
            onClick={() => changeMode('live')}
          >
            <span className="live-dot" />
            {t('Direct', 'Live')}
          </button>
          <button
            className={mode === 'demo' ? 'selected' : ''}
            aria-pressed={mode === 'demo'}
            onClick={() => changeMode('demo')}
          >
            {t('Simulation', 'Demo')}
          </button>
        </div>
        <div
          className="language-switch"
          role="group"
          aria-label={t('Langue de l’interface', 'Interface language')}
        >
          <button
            type="button"
            lang="fr"
            aria-label="Français"
            aria-pressed={locale === 'fr'}
            onClick={() => setLocale('fr')}
          >
            FR
          </button>
          <button
            type="button"
            lang="en"
            aria-label="English"
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
        </div>
        <nav
          className="immersion-navigation"
          aria-label={t('Navigation principale', 'Main navigation')}
        >
          <button
            onClick={(event) => {
              navigationFocus.current = event.currentTarget;
              setView('learn');
            }}
            aria-label={t('Comprendre', 'Learn')}
          >
            <Icon name="book" size={17} />
            <span>{t('Comprendre', 'Learn')}</span>
          </button>
          <button
            onClick={(event) => {
              navigationFocus.current = event.currentTarget;
              setView('sources');
            }}
            aria-label={t('Les données', 'Data sources')}
          >
            <Icon name="signal" size={17} />
            <span>{t('Les données', 'Data sources')}</span>
          </button>
          <button
            onClick={() => setTheme(theme === 'heg' ? 'neutral' : 'heg')}
            aria-label={t(
              `Changer l’identité visuelle, actuellement ${theme === 'heg' ? 'HEG' : 'neutre'}`,
              `Change branding, currently ${theme === 'heg' ? 'HEG' : 'neutral'}`,
            )}
          >
            <span>{t('Identité :', 'Brand:')}</span>{' '}
            {theme === 'heg' ? 'HEG' : t('neutre', 'neutral')}
          </button>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="immersion-main">
        <h1 className="visually-hidden">
          {t('Bitcoin et Ethereum en mouvement', 'Bitcoin and Ethereum in motion')}
        </h1>
        <div
          className="twin-streets"
          aria-label={t(
            'Bitcoin et Ethereum visibles simultanément',
            'Bitcoin and Ethereum shown together',
          )}
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
                ? t('Simulation pédagogique', 'Educational demo')
                : current?.status === 'ok'
                  ? t('Données en direct', 'Live data')
                  : current?.status === 'stale'
                    ? t('Dernières données conservées', 'Last observations retained')
                    : current?.status === 'unavailable' || feed.connectionError
                      ? t('Source indisponible', 'Source unavailable')
                      : t('Connexion à la source…', 'Connecting to the source…');
            const compactLabel =
              mode === 'demo'
                ? t('Simulation', 'Demo')
                : current?.status === 'ok'
                  ? t('Direct', 'Live')
                  : current?.status === 'stale'
                    ? t('Données anciennes', 'Stale data')
                    : current?.status === 'unavailable' || feed.connectionError
                      ? t('Indisponible', 'Unavailable')
                      : t('Connexion…', 'Connecting…');
            return (
              <section
                key={id}
                className={`chain-pane chain-pane--${id}`}
                data-chain={id}
                aria-label={t(`Visualisation ${network.name}`, `${network.name} visualization`)}
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
                    <div className="billboard-loading">
                      {t('Connexion à la source…', 'Connecting to the source…')}
                    </div>
                  )}
                  <div className="chain-departure-line">
                    <span className="chain-departure-label">
                      <span className="chain-departure-label-full">
                        {mode === 'demo'
                          ? t('Depuis le départ simulé', 'Since the simulated departure')
                          : t('Depuis le dernier départ', 'Since the last departure')}
                      </span>
                      <span className="chain-departure-label-compact" aria-hidden="true">
                        {t('Départ', 'Departure')}
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
                          ? t('Le réseau se fait attendre.', 'Waiting for the network.')
                          : t('La ville se prépare…', 'The city is getting ready…')}
                      </h3>
                      <p>{sourceMessage(current, feed.connectionError, locale)}</p>
                      {(current?.status === 'unavailable' || feed.connectionError) && (
                        <div className="empty-actions">
                          <button className="button-primary" onClick={feed.retry}>
                            {t('Réessayer', 'Retry')}
                          </button>
                          <button className="button-secondary" onClick={() => changeMode('demo')}>
                            {t('Explorer la simulation', 'Explore the demo')}
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
                    {sourceMessage(current, feed.connectionError, locale)}
                    {t(
                      ' Les données affichées ne sont plus à jour.',
                      ' The displayed data are no longer up to date.',
                    )}
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
                  title={current ? sourceCoverage(current, locale) : undefined}
                  data-template-count={nodeTemplate?.transactionCount}
                >
                  {mode === 'demo'
                    ? t('Données fictives', 'Demo data')
                    : nodeTemplate
                      ? t(
                          `Candidat complet : ${nodeTemplate.transactionCount.toLocaleString(languageTag(locale))} tx proposées hors coinbase`,
                          `Complete candidate: ${nodeTemplate.transactionCount.toLocaleString(languageTag(locale))} proposed tx excluding coinbase`,
                        )
                      : previousTemplate
                        ? t(
                            'Ancien candidat du nœud · estimation',
                            'Stale node candidate · estimate',
                          )
                        : current?.bitcoinArrivals
                          ? t(
                              'Échantillon mixte · arrivées réelles',
                              'Mixed sample · real arrivals',
                            )
                          : current?.sampling
                            ? t('Top des pending · pool observé', 'Top pending · observed pool')
                            : t('Sélection partielle', 'Limited selection')}{' '}
                  ·{' '}
                  {current
                    ? Math.min(
                        PENDING_SAMPLE_LIMIT,
                        current.transactions.filter((tx) => tx.status === 'pending').length,
                      )
                    : 0}{' '}
                  {nodeTemplate
                    ? t(
                        `détails individuels reçus (maximum ${PENDING_SAMPLE_LIMIT})`,
                        `individual details received (maximum ${PENDING_SAMPLE_LIMIT})`,
                      )
                    : t('en attente échantillonnées', 'sampled pending transactions')}
                  {current?.bitcoinArrivals &&
                    t(
                      ` · dont ${current.bitcoinArrivals.transactionIds.length.toLocaleString(languageTag(locale))} arrivées récentes`,
                      ` · including ${current.bitcoinArrivals.transactionIds.length.toLocaleString(languageTag(locale))} recent arrivals`,
                    )}
                  {displayedTemplate
                    ? ` · #${displayedTemplate.height.toLocaleString(languageTag(locale))}${nodeTemplate ? '' : t(` · ${displayedTemplate.transactionCount.toLocaleString(languageTag(locale))} transactions proposées hors coinbase`, ` · ${displayedTemplate.transactionCount.toLocaleString(languageTag(locale))} proposed transactions excluding coinbase`)} · ${displayedTemplate.source}`
                    : current?.sampling
                      ? ` · ${current.sampling.source}`
                      : ''}
                  {current?.observedAt
                    ? `${t(' · relevé ', ' · observed ')}${new Date(displayedTemplate?.observedAt ?? (current.bitcoinArrivals ? current.observedAt : current.sampling?.observedAt) ?? current.observedAt).toLocaleTimeString(languageTag(locale))}`
                    : ''}
                  {nodeTemplate &&
                    t(
                      ' · Aucune preuve qu’un pool le mine.',
                      ' · No evidence that a mining pool is mining this candidate.',
                    )}
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
              {t('Retourner dans la ville', 'Back to the city')}
            </button>
            {view === 'learn' && (
              <section className="content-panel">
                <p className="eyebrow">{t('LIRE LA VILLE', 'READ THE CITY')}</p>
                <h2>
                  {t('Un réseau complexe.', 'A complex network.')}
                  <br />
                  {t('Une métaphore simple.', 'A simple metaphor.')}
                </h2>
                <div className="learning-grid">
                  <Lesson
                    n="01"
                    title={t('Les voyageurs sont des transactions', 'Travelers are transactions')}
                  >
                    {t(
                      "Chaque personnage représente une transaction de notre échantillon. Son t-shirt passe du jaune pour des frais faibles à l'orange à la moyenne, puis au rouge pour des frais élevés. La référence est la moyenne des voyageurs en attente actuellement affichés sur cette blockchain, pas une moyenne mondiale. Sur le quai, les places déjà attribuées restent dans l'ordre d'arrivée observé. Les nouveaux voyageurs occupent les places libres par frais décroissants. Sa tête illustre ses besoins en espace ou en gas, avec une différence de taille accentuée. L’accessoire bleu cyan identifie une transaction classée comme interaction ou création de contrat dans les données reçues. La ville ne montre pas toutes les transactions.",
                      'Each character represents a transaction in our sample. Its shirt ranges from yellow for lower fees, through orange at the average, to red for higher fees. The reference is the average of the pending travelers currently shown on this chain, not a worldwide average. On the platform, assigned places retain their observed arrival order. New travelers fill free places in descending fee order. Their head size illustrates their space or gas requirements, with an amplified size difference. A cyan accessory identifies a transaction classified as a contract interaction or deployment in the received data. The city does not show every transaction.',
                    )}
                  </Lesson>
                  <Lesson
                    n="02"
                    title={t('Pourquoi deux wagons ?', 'Why two carriages?')}
                    detail={t(
                      'À l’arrivée d’un nouveau bloc, le premier wagon se prépare pendant au moins trois secondes pour Bitcoin et 1,5 seconde pour Ethereum : les transactions dont l’inclusion est vérifiée embarquent, tandis que les autres retournent sur le quai. Les compléments identifiés pendant cette préparation rejoignent le même départ. Il part ensuite avec les inclusions connues, une fois leurs passages terminés. Le second wagon monte à sa place, puis un nouveau second arrive du bas. Les anciennes observations regroupées gardent jusqu’à 512 identifiants pendant 30 minutes : si une inclusion est retrouvée, leur voyageur revient du groupe et rejoint le départ du bloc concerné. Les observations au-delà de ces limites restent représentées sans suivi individuel. Seule la source confirme une inclusion : l’animation ne change pas le statut.',
                      "When a new block arrives, the first carriage prepares for at least three seconds on Bitcoin and 1.5 seconds on Ethereum: transactions with verified inclusion board, while the others return to the platform. Additional inclusions identified during preparation join the same departure. The carriage leaves with the known inclusions after their paths are complete. The second carriage moves into its place, and a new second carriage arrives from below. Grouped older observations retain up to 512 identifiers for 30 minutes: if an inclusion is found, that traveler returns from the group and joins the corresponding block departure. Observations beyond those limits remain represented without individual tracking. Only the source verifies inclusion; animation does not change a transaction's status.",
                    )}
                  >
                    {t(
                      'Le wagon du haut projette le prochain bloc ; celui du bas projette le bloc qui pourrait suivre. Pour Bitcoin, « Candidat du nœud » indique une sélection proposée par le nœud observé ; sinon le premier wagon reste une estimation. Le second wagon reste une estimation. La place représentée utilise les vBytes pour Bitcoin et le gas pour Ethereum. Hors candidat fourni, les frais ordonnent les priorités lorsque la place manque. Un voyageur déjà embarqué peut conserver une réservation si le tarif recommandé Bitcoin augmente ou s’il disparaît simplement du nouvel échantillon. Dans ce dernier cas, l’horloge signale une observation conservée, sans certifier sa présence actuelle dans le mempool. Ces projections ne garantissent ni l’ordre ni l’inclusion. Un candidat du nœud ne prouve pas qu’un pool minier le mine.',
                      'The upper carriage projects the next block; the lower one projects a block that could follow. On Bitcoin, “Node candidate” identifies a selection proposed by the observed node; otherwise the first carriage remains an estimate. The second carriage is always an estimate. Represented space uses vBytes on Bitcoin and gas on Ethereum. Outside a supplied node candidate, fees determine priority when space is scarce. A boarded traveler may retain a reservation if the recommended Bitcoin rate rises or if it simply disappears from the latest sample. In that case, a clock marks a retained observation without proving current mempool presence. These projections guarantee neither ordering nor inclusion. A node candidate does not prove that a mining pool is mining it.',
                    )}
                  </Lesson>
                  <Lesson
                    n="03"
                    title={t(
                      'Bitcoin : partager un espace limité',
                      'Bitcoin: sharing limited space',
                    )}
                  >
                    {t(
                      'Les frais s’expriment en satoshis par vByte. Les mineurs choisissent les transactions selon plusieurs contraintes, dont les dépendances entre transactions. Un tarif élevé ne garantit ni place ni délai. L’indicateur du haut affiche en BTC ou en dollars la médiane des frais de toutes les transactions du candidat du nœud, hors coinbase, quand ce calcul complet est disponible. Sinon, il donne le coût médian estimé du seul échantillon reçu, en le signalant. Aucune de ces médianes ne représente tout le mempool ni des frais confirmés.',
                      'Fees are expressed in satoshis per vByte. Miners select transactions under several constraints, including transaction dependencies. A high rate guarantees neither space nor timing. When the complete calculation is available, the upper board shows the median fee of all transactions in the node candidate, excluding coinbase, in BTC or dollars. Otherwise it explicitly shows the estimated median cost of the received sample only. Neither median represents the entire mempool or confirmed fees.',
                    )}
                  </Lesson>
                  <Lesson
                    n="04"
                    title={t('Ethereum : le gas et la priorité', 'Ethereum: gas and priority')}
                  >
                    {t(
                      'Le gas mesure le travail demandé. Avec EIP-1559, le prix effectif dépend notamment des frais de base, du plafond et du pourboire. Le nonce, les contraintes de gas et les transactions privées influencent aussi l’inclusion. Le coût médian affiché utilise le prix du gas observé et la limite de gas déclarée de chaque transaction de l’échantillon. Il ne mesure pas les frais réellement payés.',
                      "Gas measures the requested work. Under EIP-1559, the effective price depends on the base fee, fee cap and priority fee. Nonces, gas constraints and private transactions also affect inclusion. The displayed median cost uses the observed gas price and each sampled transaction's declared gas limit. It does not measure fees actually paid.",
                    )}
                  </Lesson>
                  <Lesson
                    n="05"
                    title={t('Un mempool est une vue locale', 'A mempool is a local view')}
                    detail={t(
                      'La rubrique Flux privilégie les événements envoyés par le fournisseur : ajouts Bitcoin et notifications pending Ethereum. Une notification Ethereum peut être une promotion depuis queued ou une réémission, sans être une première arrivée mondiale. Le relevé périodique de deux inventaires complets reste un secours distinct ; il compte les entrées séparément des disparitions. Le débit est une moyenne sur la durée indiquée, avec une courbe des observations récentes. Sur Bitcoin, les détails réels des ajouts du flux alimentent jusqu’à 384 places à l’intérieur de l’échantillon de 1 920 transactions ; leur présence dans ce fournisseur ne garantit ni sélection dans le candidat du nœud ni inclusion. Le complément reste issu du candidat ou du relevé disponible : cet échantillon mixte n’est pas un classement global des frais. Sur Ethereum, le groupe +X hors échantillon signale les notifications absentes de la sélection pending lors de la première publication du lot ; certains identifiants peuvent déjà être conservés dans les observations de la scène. Ce groupe n’est pas un effectif à additionner aux voyageurs et ne monte pas dans un wagon. La borne réseau haute garde un autre rôle : les inclusions découvertes dans un bloc reçu. Une coupure ne restitue pas les événements manqués, et une disparition ne prouve aucune confirmation.',
                      'The Flow page prioritizes events sent by the provider: Bitcoin additions and Ethereum pending notifications. An Ethereum notification may be a promotion from queued or a rebroadcast, rather than a first worldwide arrival. Periodic differences between two complete inventories remain a separate fallback, counting entries separately from disappearances. The rate averages the stated interval, with a chart of recent observations. On Bitcoin, real added details occupy up to 384 places within the 1,920-transaction sample; presence at that provider guarantees neither membership in the node candidate nor inclusion. The candidate or available observation fills the rest: this mixed sample is not a global fee ranking. On Ethereum, +X outside sample marks notifications absent from the pending selection when that batch was first published; some identifiers may already be retained as historical observations. This group must not be added to individual traveler counts and never boards a carriage. The upper network terminal has a different role: inclusions discovered in a received block. A disconnected feed does not replay missed events, and disappearance proves no confirmation.',
                    )}
                  >
                    {t(
                      'Chaque nœud voit sa propre file. Pour Ethereum, le bloc candidat du fournisseur n’est pas un mempool global. Une absence à l’écran ne signifie pas qu’une transaction n’existe pas. « Mempool source » affiche le comptage du fournisseur observé, lorsqu’il le donne. Sur Ethereum, il réunit pending et queued ; les transactions différées peuvent attendre un nonce précédent. L’échantillon visible ne remplace jamais un compteur indisponible. La rubrique Flux donne aussi une idée des arrivées observées. Sur Bitcoin, les arrivées détaillées rejoignent l’échantillon et deviennent des bonshommes individuels. Sur Ethereum, un groupe « +X hors échantillon » complète les entrées latérales. Un premier relevé ou une panne ne sont jamais affichés comme un flux nul.',
                      "Each node has its own queue. An Ethereum provider's pending block is not a global mempool. Absence from the screen does not mean that a transaction does not exist. “Provider mempool” shows the observed provider's count when available. On Ethereum it includes pending and queued; queued transactions may await a preceding nonce. The visible sample never replaces an unavailable count. The Flow page also gives an idea of observed arrivals. Detailed Bitcoin arrivals join the sample as individual travelers. On Ethereum, a +X outside sample group supplements the lateral entrances. A first observation or an outage is never shown as zero flow.",
                    )}
                  </Lesson>
                  <Lesson
                    n="06"
                    title={t('Un départ n’est pas une finalité', 'Departure is not finality')}
                  >
                    {t(
                      'Une inclusion récente peut être remise en cause par une réorganisation. Ethereum distingue notamment les états safe et finalized. Cette première version affiche l’inclusion observée, sans certifier la finalité.',
                      'A recent inclusion can be undone by a chain reorganization. Ethereum distinguishes states including safe and finalized. This version shows observed inclusion without certifying finality.',
                    )}
                  </Lesson>
                </div>
              </section>
            )}

            {view === 'sources' && (
              <section className="content-panel">
                <p className="eyebrow">
                  {t(
                    'LA TRANSPARENCE FAIT PARTIE DU PAYSAGE',
                    'TRANSPARENCY IS PART OF THE LANDSCAPE',
                  )}
                </p>
                <h2>
                  {t('D’où viennent', 'Where do the')}
                  <br />
                  {t('les voyageurs ?', 'travelers come from?')}
                </h2>
                <div className="source-grid">
                  <article>
                    <span className="coin bitcoin">₿</span>
                    <h3>Bitcoin</h3>
                    <p>
                      {t(
                        'Blocs et frais conseillés : mempool.space par défaut. Le candidat du nœud obtenu par getblocktemplate est prioritaire, via Bitcoin PublicNode par défaut. Son nombre complet de transactions hors coinbase, son poids et sa médiane complète de frais sont calculés avant de limiter les détails individuels à ',
                        'Blocks and recommended fees: mempool.space by default. A node candidate obtained through getblocktemplate takes priority, using Bitcoin PublicNode by default. Its complete non-coinbase transaction count, weight and median fee are calculated before individual details are limited to  ',
                      )}
                      {PENDING_SAMPLE_LIMIT}
                      {t(
                        '. Une représentation collective peut compléter ces détails, sans inventer de transactions individuelles. Cette proposition ne décrit pas tout le mempool et aucun pool minier n’est réputé la miner. En secours, le classement utilise le pool RPC complet, puis la projection mempool.space et enfin ses seules transactions récentes ; le périmètre estimé reste annoncé.',
                        '. A collective representation may supplement these details without inventing individual transactions. This proposal does not describe the entire mempool, and no mining pool is assumed to mine it. Fallback ranking uses the complete RPC pool, then the mempool.space projection, then only its recent transactions; the estimated scope remains explicit.',
                      )}
                    </p>
                    <a
                      className="text-link"
                      href="https://mempool.space/docs/api/rest"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('Documentation API ', 'API documentation ')}
                      <Icon name="external" size={14} />
                    </a>
                  </article>
                  <article>
                    <span className="coin ethereum">◆</span>
                    <h3>Ethereum</h3>
                    <p>
                      {t(
                        'JSON-RPC mainnet, PublicNode par défaut. Le classement utilise les transactions pending éligibles du pool complet lorsque le fournisseur le permet ; le bloc candidat sert de repli partiel. Cette vue locale ne couvre pas les transactions privées ni tous les nœuds.',
                        'Mainnet JSON-RPC, PublicNode by default. Ranking uses eligible pending transactions from the full pool when supported by the provider; the pending block is a limited fallback. This local view does not cover private transactions or every node.',
                      )}
                    </p>
                    <a
                      className="text-link"
                      href="https://ethereum.org/developers/docs/apis/json-rpc/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('Standard JSON-RPC ', 'JSON-RPC standard ')}
                      <Icon name="external" size={14} />
                    </a>
                  </article>
                </div>
                <dl className="source-details">
                  <div>
                    <dt>{t('Source active', 'Active source')}</dt>
                    <dd>
                      {activeTemplate
                        ? t(
                            `Candidat du nœud · ${activeTemplate.source}`,
                            `Node candidate · ${activeTemplate.source}`,
                          )
                        : (sourceName(snapshot, locale) ?? t('Connexion en cours', 'Connecting'))}
                    </dd>
                  </div>
                  {activeTemplate && (
                    <>
                      <div>
                        <dt>{t('Candidat proposé', 'Proposed candidate')}</dt>
                        <dd>
                          #{activeTemplate.height.toLocaleString(languageTag(locale))} ·{' '}
                          {activeTemplate.transactionCount.toLocaleString(languageTag(locale))}
                          {t(
                            ' transactions hors coinbase · ',
                            ' transactions excluding coinbase · ',
                          )}
                          {activeTemplate.weight.toLocaleString(languageTag(locale))}
                          {t(' WU · jusqu’à ', ' WU · up to ')}
                          {PENDING_SAMPLE_LIMIT}
                          {t(
                            ' détails individuels · relevé à',
                            ' individual details · observed at',
                          )}{' '}
                          <time dateTime={new Date(activeTemplate.observedAt).toISOString()}>
                            {new Date(activeTemplate.observedAt).toLocaleTimeString(
                              languageTag(locale),
                            )}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Blocs et comptage du mempool', 'Blocks and mempool count')}</dt>
                        <dd>{sourceName(snapshot, locale)}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>{t('Couverture', 'Coverage')}</dt>
                    <dd>{sourceCoverage(snapshot, locale)}</dd>
                  </div>
                  <div>
                    <dt>{t('Actualisation', 'Refresh policy')}</dt>
                    <dd>
                      {t(
                        'Lecture 3 secondes après chaque réponse en direct, cache partagé de 3 secondes après collecte. Le temps de collecte s’ajoute à ces délais. Dernière observation affichée dans la ville.',
                        'Polled three seconds after each live response, with a shared three-second cache after collection. Collection time is additional. The city displays the latest observation time.',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('En cas de panne', 'On failure')}</dt>
                    <dd>
                      {t(
                        'Les données conservées portent l’étiquette « dernières données ». La simulation doit être choisie explicitement.',
                        'Retained data are marked as last observations. Demo mode must be selected explicitly.',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Confidentialité', 'Privacy')}</dt>
                    <dd>
                      {t(
                        'Aucun portefeuille connecté, aucune signature, aucun suivi publicitaire. Les liens externes sont ouverts à votre demande.',
                        'No wallet connection, signing or advertising tracking. External links open only when you request them.',
                      )}
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
            aria-label={t('Afficher les frais en dollars américains', 'Show fees in US dollars')}
            title={t(
              'Basculer entre les frais natifs et leur estimation en dollars américains',
              'Switch between native fees and their estimated US dollar value',
            )}
            onClick={() =>
              setFeeDisplayUnit((current) => (current === 'native' ? 'usd' : 'native'))
            }
          >
            <span className="fee-unit-switch-track" aria-hidden="true">
              <i />
            </span>
            {t('Frais : ', 'Fees: ')}
            {feeDisplayUnit === 'usd' ? '$ US' : t('natifs', 'native')}
          </button>
          <button
            aria-pressed={paused}
            aria-label={
              paused
                ? t('Reprendre l’animation', 'Resume animation')
                : t('Mettre l’animation en pause', 'Pause animation')
            }
            onClick={() => setPaused(!paused)}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
            <span className="pause-label">{paused ? t('Reprendre', 'Resume') : 'Pause'}</span>
          </button>
          <label>
            <span className="speed-label">{t('Vitesse', 'Speed')}</span>{' '}
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              aria-label={t('Vitesse d’animation', 'Animation speed')}
            >
              <option value={0.5}>{t('0,5×', '0.5×')}</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={5}>5×</option>
              <option value={10}>10×</option>
            </select>
          </label>
          <button
            aria-pressed={reducedMotion}
            aria-label={
              reducedMotion
                ? t('Activer les mouvements', 'Enable motion')
                : t('Réduire les mouvements', 'Reduce motion')
            }
            onClick={() => setReducedMotion(!reducedMotion)}
          >
            <span className="control-label-full">
              {t('Mouvements ', 'Motion ')}
              {reducedMotion ? t('réduits', 'reduced') : t('actifs', 'enabled')}
            </span>
            <span className="control-label-compact" aria-hidden="true">
              {t('Mouv. ', 'Motion ')}
              {reducedMotion ? t('réduits', 'reduced') : t('actifs', 'enabled')}
            </span>
          </button>
        </div>
        <p className="immersion-hint">
          {paused
            ? t(
                'Animation en pause · données actualisées · ',
                'Animation paused · data still updating · ',
              )
            : ''}
          {t(
            'T-shirt : frais relatifs à l’échantillon · Tête = vBytes / limite de gas · Embarquement ≠ confirmation',
            'Shirt: fees relative to the sample · Head: vBytes / gas limit · Boarding ≠ confirmation',
          )}
        </p>
        <div className="immersion-actions">
          <button
            ref={informationToggle}
            className={infoOpen ? 'active' : ''}
            aria-label={
              infoOpen
                ? t('Masquer le panneau d’informations', 'Hide information panel')
                : t('Afficher le panneau d’informations', 'Show information panel')
            }
            aria-expanded={infoOpen}
            onClick={() => {
              if (infoOpen) closeInformation();
              else setInfoOpen(true);
            }}
          >
            <Icon name="signal" size={16} />
            <span className="control-label-full">{t('Informations', 'Information')}</span>
            <span className="control-label-compact" aria-hidden="true">
              {t('Infos', 'Info')}
            </span>
          </button>
          {document.fullscreenEnabled && (
            <button
              onClick={() => void toggleFullScreen()}
              aria-label={
                fullScreen
                  ? t('Quitter le plein écran', 'Exit full screen')
                  : t('Plein écran', 'Full screen')
              }
            >
              <span className="control-label-full">
                {fullScreen
                  ? t('Quitter le plein écran', 'Exit full screen')
                  : t('Plein écran', 'Full screen')}
              </span>
              <span className="control-label-compact" aria-hidden="true">
                {fullScreen ? t('Réduire', 'Exit full screen') : t('Écran', 'Screen')}
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
          {t(
            'Le navigateur a refusé le plein écran. La vue immersive reste disponible.',
            'The browser declined full screen. The immersive view remains available.',
          )}
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
