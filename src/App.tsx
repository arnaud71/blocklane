import { useEffect, useState } from 'react';
import type { ChainId, Tx } from '../shared/model';
import { StreetScene } from './components/StreetScene';
import { Icon } from './components/Icon';
import { brand, safeExternalUrl } from './config/brand';
import { useSnapshot } from './hooks/useSnapshot';
import { explorerUrl, number, shortHash } from './lib/format';

const chains = {
  bitcoin: { name: 'Bitcoin', symbol: '₿', ticker: 'BTC', className: 'bitcoin' },
  ethereum: { name: 'Ethereum', symbol: '◆', ticker: 'ETH', className: 'ethereum' },
} as const;

export function App() {
  const [chain, setChain] = useState<ChainId>('bitcoin');
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [view, setView] = useState<'visual' | 'learn' | 'sources'>('visual');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'heg' | 'neutral'>('heg');
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const { snapshot, connectionError, retry } = useSnapshot(chain, mode);
  const selected = snapshot?.transactions.find((tx) => tx.id === selectedId) ?? null;
  function setSelected(tx: Tx | null) {
    setSelectedId(tx?.id ?? null);
  }
  const network = chains[chain];
  const fairUrl = safeExternalUrl(brand.fairOnChainUrl);
  const latest = snapshot?.blocks[0];
  const health = snapshot?.status;
  const sourceLabel =
    mode === 'demo'
      ? 'Simulation pédagogique'
      : health === 'ok'
        ? 'Données en direct'
        : health === 'stale'
          ? 'Dernières données conservées'
          : health === 'unavailable' || connectionError
            ? 'Source indisponible'
            : 'Connexion à la source…';

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);

  function changeChain(value: ChainId) {
    setChain(value);
    setSelected(null);
  }
  function changeMode(value: 'live' | 'demo') {
    setMode(value);
    setSelected(null);
  }

  const txLink = selected && mode === 'live' ? explorerUrl(chain, selected.id, 'tx') : null;
  return (
    <div className={`app theme-${theme}`}>
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <header className="topbar">
        <a className="wordmark" href="#main" aria-label="BlockLane accueil">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          {brand.name}
          <span className="wordmark-dot">.</span>
        </a>
        <div className="topbar-subtitle">
          {brand.tagline}
          <span>Bitcoin & Ethereum</span>
        </div>
        <div className="topbar-right">
          <span className="version">BÊTA 0.1</span>
          <span className="institution-mark">
            {theme === 'heg' ? brand.institution : 'BL'}
            <span>{theme === 'heg' ? 'ÉDITION CAMPUS' : 'OBSERVATOIRE'}</span>
          </span>
        </div>
      </header>

      <aside className="sidebar" aria-label="Navigation principale">
        <span className="nav-caption">EXPLORER</span>
        <button
          className={view === 'visual' ? 'nav-item active' : 'nav-item'}
          onClick={() => setView('visual')}
          aria-current={view === 'visual' ? 'page' : undefined}
        >
          <Icon name="city" />
          La ville
          <span className="nav-dot" />
        </button>
        <button
          className={view === 'learn' ? 'nav-item active' : 'nav-item'}
          onClick={() => setView('learn')}
          aria-current={view === 'learn' ? 'page' : undefined}
        >
          <Icon name="book" />
          Comprendre
        </button>
        <button
          className={view === 'sources' ? 'nav-item active' : 'nav-item'}
          onClick={() => setView('sources')}
          aria-current={view === 'sources' ? 'page' : undefined}
        >
          <Icon name="signal" />
          Les données
        </button>
        <div className="sidebar-networks">
          <span className="nav-caption">RÉSEAUX</span>
          {(Object.keys(chains) as ChainId[]).map((id) => (
            <button
              className={`network-link ${chain === id ? 'chosen' : ''}`}
              key={id}
              onClick={() => changeChain(id)}
            >
              <span className={`coin tiny ${chains[id].className}`}>{chains[id].symbol}</span>
              {chains[id].name}
              <span className="network-ticker">{chains[id].ticker}</span>
            </button>
          ))}
          <span className="coming">D’autres horizons, bientôt.</span>
        </div>
        <div className="campus-note">
          <Icon name="leaf" />
          <p>
            La blockchain devient
            <br />
            <strong>un terrain d’apprentissage.</strong>
          </p>
          <span>Une perspective HEG · identité provisoire</span>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === 'heg' ? 'neutral' : 'heg')}
        >
          Identité : {theme === 'heg' ? 'HEG' : 'neutre'} <span>↔</span>
        </button>
      </aside>

      <main id="main" tabIndex={-1}>
        <div className="intro">
          <div>
            <p className="eyebrow">
              <span /> EXPLORER. OBSERVER. COMPRENDRE.
            </p>
            <h1>
              La blockchain,
              <br />
              <em>en mouvement.</em>
            </h1>
            <p className="intro-copy">
              Une transaction, un voyageur. Un bloc, un départ.
              <br />
              Bienvenue dans la ville où les réseaux prennent vie.
            </p>
          </div>
          <div className="intro-aside">
            <span className="intro-coordinate">46°11′ N &nbsp; 6°08′ E</span>
            <span className="intro-label">
              UN AUTRE REGARD
              <br />
              SUR LA BLOCKCHAIN
            </span>
            <div className="orbit">
              <span>↗</span>
              <i />
              <i />
            </div>
          </div>
        </div>

        <div className="explore-toolbar">
          <div className="chain-tabs" aria-label="Choisir une blockchain">
            {(Object.keys(chains) as ChainId[]).map((id) => (
              <button
                key={id}
                className={chain === id ? 'chain-tab selected' : 'chain-tab'}
                onClick={() => changeChain(id)}
                aria-pressed={chain === id}
              >
                <span className={`coin ${chains[id].className}`}>{chains[id].symbol}</span>
                {chains[id].name}
                <span className="tab-ticker">{chains[id].ticker}</span>
              </button>
            ))}
          </div>
          <div className="mode-switch" aria-label="Source des données">
            <button
              className={mode === 'live' ? 'selected' : ''}
              onClick={() => changeMode('live')}
              aria-pressed={mode === 'live'}
            >
              <span className="live-dot" />
              Direct
            </button>
            <button
              className={mode === 'demo' ? 'selected' : ''}
              onClick={() => changeMode('demo')}
              aria-pressed={mode === 'demo'}
            >
              Simulation
            </button>
          </div>
        </div>

        <section className="metrics" aria-label="Indicateurs du réseau">
          <Metric
            label={
              chain === 'ethereum' && mode === 'live' ? 'Mempool global' : 'Transactions en attente'
            }
            value={number(snapshot?.pendingCount ?? null)}
            unit="transactions"
            icon="people"
            note={
              chain === 'ethereum' && mode === 'live'
                ? 'Non mesuré par cette source'
                : 'Vue de la source observée'
            }
          />
          <Metric
            label={
              chain === 'bitcoin' ? 'Frais conseillés · ~30 min' : 'Frais de base du dernier bloc'
            }
            value={number(snapshot?.feeRate ?? null, 2)}
            unit={chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}
            icon="signal"
            note={
              mode === 'demo'
                ? 'Valeur simulée'
                : chain === 'ethereum'
                  ? 'Pourboire exclu · ce n’est pas le prix total'
                  : 'Indication, sans garantie d’inclusion'
            }
          />
          <Metric
            label="Dernier bloc observé"
            value={latest ? `#${number(latest.height)}` : '—'}
            unit=""
            icon="cube"
            note={mode === 'demo' ? 'Bloc synthétique' : 'Inclus ne signifie pas finalisé'}
          />
          <Metric
            label="Voyageurs dans la ville"
            value={snapshot ? number(Math.min(80, snapshot.transactions.length)) : '—'}
            unit="transactions représentées"
            icon="city"
            note="Échantillon borné, jamais le réseau entier"
          />
        </section>

        {view === 'visual' && (
          <>
            <section className="scene-card" aria-label={`Visualisation ${network.name}`}>
              <div className="scene-header">
                <div className="scene-heading">
                  <span className="scene-number">01</span>
                  <div>
                    <h2>{network.name} Avenue</h2>
                    <span>
                      {theme === 'heg' ? 'Campus HEG' : 'Quartier des réseaux'} · Vue des
                      transactions
                    </span>
                  </div>
                </div>
                <span
                  className={`data-status ${health === 'ok' && mode === 'live' ? 'healthy' : ''}`}
                  role="status"
                >
                  <span />
                  {sourceLabel}
                </span>
              </div>
              <div className="scene-stage">
                {snapshot && snapshot.status !== 'unavailable' ? (
                  <StreetScene
                    snapshot={snapshot}
                    paused={paused}
                    speed={speed}
                    reducedMotion={reducedMotion}
                    onSelect={setSelected}
                    selectedId={selected?.id}
                    theme={theme}
                  />
                ) : (
                  <div className="empty-state">
                    <Icon name="city" size={54} />
                    <h3>
                      {snapshot?.status === 'unavailable' || connectionError
                        ? 'Le réseau se fait attendre.'
                        : 'La ville se prépare…'}
                    </h3>
                    <p>
                      {snapshot?.message ??
                        connectionError ??
                        'Connexion aux données publiques du réseau.'}
                    </p>
                    {(snapshot?.status === 'unavailable' || connectionError) && (
                      <div className="empty-actions">
                        <button className="button-primary" onClick={retry}>
                          Réessayer
                        </button>
                        <button className="button-secondary" onClick={() => changeMode('demo')}>
                          Explorer la simulation
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="mobile-pan-hint">
                ↔ Faites glisser la ville pour explorer les deux quais.
              </p>
              <div className="scene-controls">
                <div className="legend">
                  <span>
                    <i className="legend-dot fast" />
                    Frais élevés
                  </span>
                  <span>
                    <i className="legend-dot normal" />
                    Frais modérés
                  </span>
                  <span>
                    <i className="legend-dot slow" />
                    Frais faibles
                  </span>
                </div>
                <div className="animation-controls">
                  <button
                    onClick={() => setPaused(!paused)}
                    aria-pressed={paused}
                    aria-label={paused ? 'Reprendre l’animation' : 'Mettre l’animation en pause'}
                  >
                    <Icon name={paused ? 'play' : 'pause'} size={16} />
                    {paused ? 'Reprendre' : 'Pause'}
                  </button>
                  {mode === 'demo' && (
                    <label>
                      Vitesse{' '}
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
                  )}
                  <button
                    aria-pressed={reducedMotion}
                    onClick={() => setReducedMotion(!reducedMotion)}
                  >
                    Mouvements {reducedMotion ? 'réduits' : 'actifs'}
                  </button>
                </div>
              </div>
              <div className="coverage-note">
                <Icon name="signal" size={14} />
                <p>
                  {snapshot?.coverage ??
                    'La couverture sera affichée dès que la source aura répondu.'}{' '}
                  {snapshot?.observedAt ? (
                    <span>
                      Observé à {new Date(snapshot.observedAt).toLocaleTimeString('fr-CH')}.
                    </span>
                  ) : null}
                </p>
              </div>
              {snapshot?.status === 'stale' && (
                <p className="stale-warning" role="alert">
                  {snapshot.message ?? connectionError} Les données affichées ne sont plus à jour.
                </p>
              )}
            </section>

            <div className="below-scene">
              <section className="transaction-card">
                <div className="section-top">
                  <h2>{selected ? 'Votre voyageur' : 'Dans la ville'}</h2>
                  {selected ? (
                    <button
                      className="icon-button"
                      aria-label="Fermer la transaction"
                      onClick={() => setSelected(null)}
                    >
                      <Icon name="close" size={17} />
                    </button>
                  ) : (
                    <span>
                      {network.ticker} · {mode === 'demo' ? 'SIMULATION' : 'ÉCHANTILLON'}
                    </span>
                  )}
                </div>
                {selected ? (
                  <div className="tx-detail">
                    <p className="tx-id">{selected.id}</p>
                    <dl>
                      <div>
                        <dt>État</dt>
                        <dd>
                          {selected.status === 'pending'
                            ? 'En attente dans la source'
                            : 'Incluse dans un bloc observé'}
                        </dd>
                      </div>
                      <div>
                        <dt>{chain === 'bitcoin' ? 'Frais par vByte' : 'Prix du gas'}</dt>
                        <dd>
                          {number(selected.feeRate, 3)} {snapshot?.feeUnit}
                        </dd>
                      </div>
                      <div>
                        <dt>{chain === 'bitcoin' ? 'Taille virtuelle' : 'Limite de gas'}</dt>
                        <dd>
                          {number(selected.size)} {chain === 'bitcoin' ? 'vB' : 'gas'}
                        </dd>
                      </div>
                      <div>
                        <dt>Nature</dt>
                        <dd>
                          {selected.kind === 'contract'
                            ? 'Données ou création de contrat'
                            : 'Transfert'}
                        </dd>
                      </div>
                    </dl>
                    {txLink ? (
                      <a
                        href={txLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-link"
                      >
                        Voir dans l’explorateur <Icon name="external" size={14} />
                      </a>
                    ) : (
                      <p className="muted">Transaction synthétique · aucun lien vers le réseau</p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="card-description">
                      Cliquez sur un voyageur pour découvrir sa transaction.
                    </p>
                    <div className="tx-list">
                      {snapshot?.transactions.slice(0, 3).map((tx) => (
                        <button className="tx-row" key={tx.id} onClick={() => setSelected(tx)}>
                          <span
                            className={`traveler-token ${tx.kind === 'contract' ? 'contract' : ''}`}
                          >
                            <Icon name="people" size={17} />
                          </span>
                          <span>
                            <strong>{shortHash(tx.id)}</strong>
                            <small>
                              {tx.status === 'pending' ? 'En attente' : 'Dans un bloc observé'}
                            </small>
                          </span>
                          <span className="tx-fee">
                            {number(tx.feeRate, 2)}
                            <small>{snapshot.feeUnit}</small>
                          </span>
                          <Icon name="arrow" size={15} />
                        </button>
                      ))}
                    </div>
                    {snapshot?.transactions.length === 0 && (
                      <p className="muted">Aucune transaction dans l’échantillon reçu.</p>
                    )}
                  </>
                )}
              </section>
              <section className="learn-teaser">
                <span className="eyebrow">LE SAVIEZ-VOUS ?</span>
                <h2>
                  Pourquoi certains
                  <br />
                  voyageurs passent avant ?
                </h2>
                <p>
                  Les frais comptent. Les règles du réseau aussi. Découvrez ce qui influence le
                  prochain départ.
                </p>
                <button className="text-link" onClick={() => setView('learn')}>
                  Comprendre les frais <Icon name="arrow" size={18} />
                </button>
                <div className="teaser-ticket" aria-hidden="true">
                  <span>
                    BLOCK
                    <br />
                    PASS
                  </span>
                  <i />
                </div>
              </section>
            </div>
          </>
        )}

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
                Chaque personnage représente une transaction de notre échantillon. Sa couleur
                indique ses frais relatifs et sa taille illustre ses besoins en espace ou en gas. La
                ville ne montre pas toutes les transactions.
              </Lesson>
              <Lesson n="02" title="Les transports représentent des blocs">
                Un bloc rassemble des transactions. En direct, les transports illustrent des blocs
                observés ; ils ne prédisent pas le prochain bloc. En simulation, les départs sont
                volontairement animés.
              </Lesson>
              <Lesson n="03" title="Bitcoin : partager un espace limité">
                Les frais s’expriment en satoshis par vByte. Les mineurs choisissent les
                transactions selon plusieurs contraintes, dont les dépendances entre transactions.
                Un tarif élevé ne garantit ni place ni délai.
              </Lesson>
              <Lesson n="04" title="Ethereum : le gas et la priorité">
                Le gas mesure le travail demandé. Avec EIP-1559, le prix effectif dépend notamment
                des frais de base, du plafond et du pourboire. Le nonce, les contraintes de gas et
                les transactions privées influencent aussi l’inclusion.
              </Lesson>
              <Lesson n="05" title="Un mempool est une vue locale">
                Chaque nœud voit sa propre file. Pour Ethereum, le bloc candidat du fournisseur
                n’est pas un mempool global. Une absence à l’écran ne signifie pas qu’une
                transaction n’existe pas.
              </Lesson>
              <Lesson n="06" title="Un départ n’est pas une finalité">
                Une inclusion récente peut être remise en cause par une réorganisation. Ethereum
                distingue notamment les états safe et finalized. Cette première version affiche
                l’inclusion observée, sans certifier la finalité.
              </Lesson>
            </div>
            <button className="button-primary" onClick={() => setView('visual')}>
              Retourner dans la ville <Icon name="arrow" size={17} />
            </button>
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
                  API mempool.space par défaut. Blocs récents, transactions récentes en attente et
                  frais recommandés. Source remplaçable par un service compatible hébergé par la
                  HEG.
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
                  JSON-RPC mainnet, PublicNode par défaut. Dernier bloc et bloc candidat lorsque le
                  fournisseur le permet. Ce dernier ne couvre pas toutes les transactions en
                  attente, ni les transactions privées.
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
                  Environ toutes les 10 secondes en direct. Dernière observation affichée dans la
                  ville.
                </dd>
              </div>
              <div>
                <dt>En cas de panne</dt>
                <dd>
                  Les données conservées portent l’étiquette « dernières données ». La simulation
                  doit être choisie explicitement.
                </dd>
              </div>
              <div>
                <dt>Confidentialité</dt>
                <dd>
                  Aucun portefeuille connecté, aucune signature, aucun suivi publicitaire. Les liens
                  externes sont ouverts à votre demande.
                </dd>
              </div>
            </dl>
          </section>
        )}

        <footer>
          <span>
            <strong>{brand.name}.</strong> Une ville pour comprendre les réseaux.
          </span>
          <span>
            {fairUrl && (
              <a href={fairUrl} target="_blank" rel="noopener noreferrer">
                FairOnChain ↗
              </a>
            )}
            Lecture seule · Bêta 0.1.0
          </span>
        </footer>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  icon: 'city' | 'people' | 'cube' | 'signal';
}) {
  return (
    <article className="metric">
      <div className="metric-label">
        {label}
        <Icon name={icon} size={17} />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <span className="metric-note">{note}</span>
    </article>
  );
}

function Lesson({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <article>
      <span className="lesson-number">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}
