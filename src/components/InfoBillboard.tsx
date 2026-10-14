import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/model';
import {
  formatEstimatedFeeAmount,
  hasUsableUsdQuote,
  medianTransactionFee,
  medianTransactionFeeNote,
  usdQuoteNote,
  type FeeDisplayUnit,
} from '../lib/feeDisplay';
import { number } from '../lib/format';
import { providerMempool } from '../lib/mempoolDisplay';
import { latestBlockValueDisplay } from '../lib/blockValueDisplay';
import type { SceneActivity } from './InfoPanel';
import { Icon } from './Icon';
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

type BillboardPage = {
  value: string;
  unit: string;
  label: string;
  lines: string[];
  note: string;
  estimated?: boolean;
  smallValue?: boolean;
};

export function InfoBillboard({
  snapshot,
  activity,
  paused,
  reducedMotion,
  selected,
  feeDisplayUnit,
  theme,
  top = true,
}: InfoBillboardProps) {
  const [page, setPage] = useState(0);
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
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % pages.length),
      4_000,
    );
    return () => window.clearInterval(timer);
  }, [rotating]);

  const bitcoin = snapshot.chain === 'bitcoin';
  const chainName = bitcoin ? 'Bitcoin' : 'Ethereum';
  const demo = snapshot.mode === 'demo';
  const mempool = providerMempool(snapshot);
  const sampleSize = snapshot.transactions.filter((tx) => tx.status === 'pending').length;
  const median = medianTransactionFee(snapshot);
  const quote = demo ? undefined : snapshot.usdQuote;
  const usableQuote = hasUsableUsdQuote(quote);
  const feeAmount = formatEstimatedFeeAmount(
    snapshot.chain,
    median.nativeAmount,
    feeDisplayUnit,
    quote,
  );
  const feeParts = feeAmount.match(/^(≈\s*)?(.+?)\s(BTC|ETH|\$ US)$/);
  const latest = snapshot.status === 'unavailable' ? undefined : snapshot.blocks[0];
  const blockValue = latestBlockValueDisplay(snapshot);
  const sourceLabel = demo
    ? 'Simulation'
    : snapshot.status === 'ok'
      ? 'Direct'
      : snapshot.status === 'stale'
        ? 'Ancien relevé'
        : 'Indisponible';

  const information: BillboardPage[] = [
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
        `Échantillon : ${number(median.sampleSize)} tx`,
        feeDisplayUnit === 'usd' && !usableQuote
          ? 'Cours indisponible'
          : bitcoin
            ? 'Coût estimé'
            : 'Limite de gas déclarée',
      ],
      note: `${medianTransactionFeeNote(snapshot.chain, median.sampleSize, demo)}${
        feeDisplayUnit === 'usd' ? ` ${usdQuoteNote(quote, demo)}` : ''
      }`,
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
      note: 'Comptage des voyageurs de la scène uniquement. Les deux wagons projettent les prochains blocs ; une place à bord ne prouve aucune inclusion.',
    },
  ];
  const current = information[page] ?? information[0];
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
      data-page={pages[page]}
      data-auto-rotating={rotating}
      data-status={snapshot.status}
    >
      <header className="info-billboard-header">
        <span>{theme === 'heg' ? 'HEG' : 'INFO'}</span>
        <span>{bitcoin ? 'BTC' : 'ETH'}</span>
      </header>
      <div className="info-billboard-screen" key={page} title={current.note}>
        <p className="info-billboard-page">{pages[page]}</p>
        <p className={`info-billboard-value info-billboard-value--${valueSize}`}>
          {current.estimated && <span className="info-billboard-estimate">≈ </span>}
          {current.value}
        </p>
        {current.unit && <p className="info-billboard-unit">{current.unit}</p>}
        <h3 className="info-billboard-label">{current.label}</h3>
        <div className="info-billboard-lines">
          {current.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
      <div className="info-billboard-footer">
        <nav className="info-billboard-navigation" aria-label={`Rubriques ${chainName}`}>
          {pages.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={`Afficher ${label.toLowerCase()} · ${chainName}`}
              aria-pressed={page === index}
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
      <p className="info-billboard-source">
        <i aria-hidden="true" /> {sourceLabel}
        {page === 0 && mempool.status === 'stale' ? ' · compteur ancien' : ''}
        {page === 1 && feeDisplayUnit === 'usd' && usableQuote && quote?.status === 'stale'
          ? ' · cours conservé'
          : ''}
      </p>
    </section>
  );
}
