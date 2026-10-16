import { memo, useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n';
import type { Snapshot } from '../../shared/model';
import { advanceProviderFlowArrival } from '../lib/poolFlowDisplay';
import { number } from '../lib/format';
import { ARRIVAL_LANE_X } from '../lib/streetGeometry';
import './ProviderFlowArrivals.css';

/** One finite collective illustration per provider interval, without invented transactions. */
export const ProviderFlowArrivals = memo(function ProviderFlowArrivals({
  snapshot,
  projectX,
  mirrored,
  paused,
  reducedMotion,
}: {
  snapshot: Snapshot;
  projectX: (x: number) => number;
  mirrored: boolean;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const { locale, t } = useI18n();
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const [state, setState] = useState(() => advanceProviderFlowArrival(null, snapshot));
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    setState((previous) => advanceProviderFlowArrival(previous, snapshot));
  }, [snapshot]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  const arrival = state.arrival;
  if (snapshot.chain === 'bitcoin' || !arrival) return null;
  const width = Math.min(122, Math.max(70, projectX(460) - projectX(426)));
  const x = Math.min(projectX(ARRIVAL_LANE_X), projectX(460) - width / 2 - 3);
  const style = { '--provider-flow-shift': `${Math.min(32, width / 4)}px` } as CSSProperties;
  const seconds = n((arrival.observedAt - arrival.fromObservedAt) / 1_000, 1);
  return (
    <g
      className="provider-flow-arrivals"
      data-provider-flow-arrivals={snapshot.chain}
      data-flow-count={arrival.count}
      data-flow-kind={arrival.kind}
      data-flow-observed-at={arrival.observedAt}
      data-flow-paused={paused || hidden}
      data-flow-reduced={reducedMotion}
      data-flow-origin="ordinary-lateral-entry"
      role="group"
      aria-label={t(
        `Arrivées collectives : ${n(arrival.count)} ${arrival.kind === 'events' ? 'notifications pending reçues du fournisseur' : 'identifiants entrés dans l’inventaire du fournisseur'} en ${seconds} s, hors de la sélection pending à la première publication de cet intervalle. ${arrival.kind === 'events' ? 'Une notification peut être une promotion depuis queued ou une réémission, pas une nouvelle entrée mondiale. ' : ''}Certains peuvent déjà être conservés parmi les observations de la scène ; ce groupe ne s’ajoute pas au nombre de voyageurs individuels et ne prouve aucune inclusion.`,
        `Collective arrivals: ${n(arrival.count)} ${arrival.kind === 'events' ? 'pending notifications received from the provider' : 'identifiers entering the provider’s inventory'} in ${seconds} s, outside the pending selection when this interval was first published. ${arrival.kind === 'events' ? 'A notification may be a queued promotion or re-emission, not a new worldwide arrival. ' : ''}Some may already be retained among the scene’s observations; this group does not add to the individual passenger count or prove inclusion.`,
      )}
      transform={`translate(${x} 260)`}
      style={style}
    >
      <g
        key={arrival.key}
        className="provider-flow-arrivals-motion"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          setState((current) =>
            current.arrival?.key === arrival.key ? { ...current, arrival: null } : current,
          );
        }}
      >
        <g transform={mirrored ? 'scale(-1 1)' : undefined}>
          <g aria-hidden="true" className="provider-flow-arrivals-symbols">
            {[-20, -10, 0, 10, 20].map((offset, index) => (
              <g key={offset} transform={`translate(${offset} ${index % 2 === 0 ? -4 : 0})`}>
                <circle cy="-10" r="3.6" />
                <path d="M-5 0v-3a5 5 0 0 1 10 0v3z" />
              </g>
            ))}
          </g>
          <rect x={-width / 2} y="6" width={width} height="31" rx="5" />
          <text y="18" textAnchor="middle">
            +{n(arrival.count)}
          </text>
          <text className="provider-flow-arrivals-caption" y="30" textAnchor="middle">
            {t('hors échantillon', 'outside sample')}
          </text>
        </g>
      </g>
    </g>
  );
});
