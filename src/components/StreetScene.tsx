import { memo, useId, useMemo, type CSSProperties } from 'react';
import type { Snapshot, Tx } from '../../shared/model';
import { usePassengerMotion } from '../hooks/usePassengerMotion';
import type { PassengerPose } from '../lib/passengerMotion';
import {
  SCENE_WIDTH,
  SCENE_HEIGHT,
  WAGON_X,
  WAGON_WIDTH,
  WAGON_HEIGHT,
  OBSERVED_WAGON_Y,
  CANDIDATE_WAGON_Y,
  ENTRY_DOOR_Y,
  EXIT_DOOR_Y,
  type WagonKind,
} from '../lib/streetGeometry';
import { number } from '../lib/format';
import { Passenger } from './Passenger';
import { InfoPanel } from './InfoPanel';
import './StreetScene.css';

const DynamicInfoPanel = memo(InfoPanel);
const WAGON_COLOR = '#79b8a0';
const CLOSED_DOORS = { entry: false, exit: false };

export interface StreetSceneProps {
  snapshot: Snapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onSelect: (tx: Tx) => void;
  selectedId?: string;
  theme?: 'heg' | 'neutral';
  onClearSelection?: () => void;
  immersive?: boolean;
  showInfo?: boolean;
}

function SideDoor({ y, open, purpose }: { y: number; open: boolean; purpose: 'entry' | 'exit' }) {
  return (
    <g
      className={`street-side-door${open ? ' street-side-door--open' : ''}`}
      data-door={purpose}
      data-side="right"
      data-open={open}
      transform={`translate(${WAGON_WIDTH - 7} ${y - 16})`}
      aria-hidden="true"
    >
      <rect x="5" y="8" width="22" height="20" rx="2" fill="#b9c5a3" />
      <path d="M11 12h14M11 18h14M11 24h14" stroke="#637866" strokeWidth="1.5" />
      <rect x="0" y="0" width="13" height="32" rx="2" fill="#102d27" stroke="#193c31" />
      <rect
        className="street-side-door-top"
        width="13"
        height="16"
        rx="2"
        fill={WAGON_COLOR}
        stroke="#193c31"
      />
      <rect
        className="street-side-door-bottom"
        y="16"
        width="13"
        height="16"
        rx="2"
        fill={WAGON_COLOR}
        stroke="#193c31"
      />
      <circle cx="6.5" cy="-5" r="2.5" fill={open ? '#dbd992' : '#486e58'} />
    </g>
  );
}

function Wagon({
  kind,
  y,
  label,
  passengers,
  doors,
  moving = false,
  handoffProgress,
  offsetY = 0,
  opacity = 1,
  selectedId,
  onSelect,
  feeColor,
}: {
  kind: WagonKind | 'handoff';
  y: number;
  label: string;
  passengers: PassengerPose[];
  doors: { entry: boolean; exit: boolean };
  moving?: boolean;
  handoffProgress?: number;
  offsetY?: number;
  opacity?: number;
  selectedId?: string;
  onSelect: (tx: Tx) => void;
  feeColor: (pose: PassengerPose) => string;
}) {
  const clipId = useId().replace(/:/g, '') + '-wagon-interior';
  const entryOpen = !moving && doors.entry;
  const exitOpen = !moving && doors.exit;
  return (
    <g
      className={`street-vertical-wagon street-vertical-wagon--${kind} ${kind === 'observed' ? 'street-observed-wagon' : 'street-candidate-wagon'}${kind === 'handoff' ? ' street-candidate--handoff' : ''}`}
      data-moving={moving}
      data-handoff-progress={handoffProgress}
      transform={`translate(0 ${offsetY})`}
      opacity={opacity}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={WAGON_X + 3}
            y={y + 40}
            width={WAGON_WIDTH - 6}
            height={WAGON_HEIGHT - 51}
            rx="6"
          />
          {entryOpen && <rect x={WAGON_X + 72} y={y + ENTRY_DOOR_Y - 34} width="36" height="56" />}
          {exitOpen && <rect x={WAGON_X + 72} y={y + EXIT_DOOR_Y - 34} width="36" height="56" />}
        </clipPath>
      </defs>
      <g transform={`translate(${WAGON_X} ${y})`} aria-hidden="true">
        <ellipse cx="43" cy="116" rx="47" ry="117" fill="#061714" opacity=".4" />
        <rect x="-5" y="25" width="9" height="35" rx="4" fill="#10231e" />
        <rect x="81" y="25" width="9" height="35" rx="4" fill="#10231e" />
        <rect x="-5" y="170" width="9" height="35" rx="4" fill="#10231e" />
        <rect x="81" y="170" width="9" height="35" rx="4" fill="#10231e" />
        <rect
          width={WAGON_WIDTH}
          height={WAGON_HEIGHT}
          rx="17"
          fill={WAGON_COLOR}
          stroke="#172d26"
          strokeWidth="3"
        />
        <rect x="8" y="14" width="69" height="24" rx="7" fill="#203d35" />
        <text x="42.5" y="30" fill="#d5e3c7" fontSize="8" textAnchor="middle">
          {label}
        </text>
        <rect x="13" y="46" width="58" height="140" rx="7" fill="#203d35" />
        <path d="M17 91h50M17 121h50M17 151h50" stroke="#567d6c" strokeWidth="2" />
        <rect x="9" y="195" width="67" height="9" rx="4" fill="#d1dfc0" />
        <circle cx="14" cy="207" r="3" fill="#e89c73" />
        <circle cx="71" cy="207" r="3" fill="#e89c73" />
      </g>
      <g clipPath={`url(#${clipId})`}>
        {passengers.map((pose) => (
          <Passenger
            key={pose.tx.id}
            pose={pose}
            selected={selectedId === pose.tx.id}
            feeColor={feeColor(pose)}
            onSelect={onSelect}
          />
        ))}
      </g>
      <g transform={`translate(${WAGON_X} ${y})`}>
        <SideDoor y={ENTRY_DOOR_Y} open={entryOpen} purpose="entry" />
        <SideDoor y={EXIT_DOOR_Y} open={exitOpen} purpose="exit" />
      </g>
    </g>
  );
}

const PlatformBackdrop = memo(function PlatformBackdrop({ theme }: { theme: 'heg' | 'neutral' }) {
  return (
    <g aria-hidden="true">
      <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="#234a3b" />
      <rect width="175" height={SCENE_HEIGHT} fill="#1b4034" />
      <rect x="185" width="90" height={SCENE_HEIGHT} fill="#15352f" />
      <path d="M181 0v740M279 0v740" stroke="#83987b" strokeWidth="5" />
      <path d="M230 0v740" stroke="#adc4a3" strokeWidth="2" strokeDasharray="22 23" opacity=".32" />
      <rect x="282" width="178" height={SCENE_HEIGHT} fill="#385a43" />
      <path d="M298 77v634" stroke="#c7cba0" strokeWidth="2" strokeDasharray="4 8" opacity=".3" />
      <text x="318" y="37" fill="#d3dec0" fontSize="11" letterSpacing="1">
        QUAI · CÔTÉ DROIT
      </text>
      <rect x="305" y="60" width="140" height="28" rx="5" fill="#153d2e" />
      <text x="317" y="78" fill="#d3dec0" fontSize="11">
        FILE D’ATTENTE
      </text>
      <g transform="translate(28 188)">
        <rect width="123" height="98" rx="6" fill="#829e84" stroke="#183c30" strokeWidth="3" />
        <path d="m-5 0 65-39 67 39Z" fill="#b8c6a1" stroke="#183c30" strokeWidth="3" />
        <rect x="15" y="17" width="25" height="25" fill="#294f40" />
        <rect x="85" y="17" width="25" height="25" fill="#294f40" />
        <text x="62" y="63" fill="#183f32" textAnchor="middle" fontSize="16" fontWeight="700">
          {theme === 'heg' ? 'HEG' : 'CAMPUS'}
        </text>
        <rect x="46" y="69" width="32" height="29" fill="#294f40" />
      </g>
      <g transform="translate(38 483)">
        <rect width="110" height="105" rx="5" fill="#497767" stroke="#183c30" strokeWidth="3" />
        <rect x="13" y="15" width="83" height="34" fill="#1c4436" />
        <path d="M47 16v32M73 16v32" stroke="#87ad8a" strokeWidth="2" />
        <text x="55" y="73" textAnchor="middle" fill="#d8dfbc" fontSize="11">
          LAB · DONNÉES
        </text>
      </g>
      {[112, 412, 697].map((y) => (
        <g key={y} transform={`translate(86 ${y})`}>
          <ellipse cy="2" rx="29" ry="9" fill="#102e24" />
          <path d="M-3 0v-43h6V0" fill="#a89770" />
          <ellipse cy="-48" rx="27" ry="25" fill="#3d7353" />
          <ellipse cy="-57" rx="20" ry="13" fill="#618b62" />
        </g>
      ))}
    </g>
  );
});

export function StreetScene({
  snapshot,
  paused,
  speed,
  reducedMotion,
  onSelect,
  selectedId,
  theme = 'heg',
  onClearSelection,
  showInfo = true,
}: StreetSceneProps) {
  const id = useId().replace(/:/g, '');
  const motion = usePassengerMotion({
    snapshot,
    paused: paused || snapshot.status !== 'ok',
    speed,
    reducedMotion,
  });
  const demo = snapshot.mode === 'demo';
  const moving = motion.handoffProgress !== null;
  const progress = motion.handoffProgress ?? 0;
  const wagonY = CANDIDATE_WAGON_Y + (OBSERVED_WAGON_Y - CANDIDATE_WAGON_Y) * progress;
  const observed = motion.passengers.filter(
    (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'observed',
  );
  const candidate = motion.passengers.filter(
    (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'candidate',
  );
  const carried = motion.passengers.filter((pose) => pose.inWagon && pose.inHandoff);
  const pedestrians = motion.passengers
    .filter((pose) => !pose.inWagon)
    .sort((left, right) => left.y - right.y);
  const observedLabel = snapshot.blocks[0] ? `#${number(snapshot.blocks[0].height)}` : 'Non fourni';
  const feeBounds = motion.passengers.reduce(
    (bounds, pose) => ({
      min: Math.min(bounds.min, pose.tx.feeRate),
      max: Math.max(bounds.max, pose.tx.feeRate),
    }),
    { min: Infinity, max: 0 },
  );
  const feeColor = (pose: PassengerPose) => {
    const relative =
      feeBounds.max === feeBounds.min
        ? 0.5
        : (pose.tx.feeRate - feeBounds.min) / (feeBounds.max - feeBounds.min);
    return relative > 0.66 ? '#efaf72' : relative > 0.33 ? '#79bbb3' : '#afc3a3';
  };
  const activity = useMemo(
    () => ({
      walking: motion.counts.walking + motion.counts.boarding,
      boarded: motion.passengers.filter((pose) => pose.inWagon).length,
      returning: motion.counts.exiting + motion.counts.returning,
      waiting: motion.counts.queue,
    }),
    [motion.counts, motion.passengers],
  );
  const styles = { '--scene-duration': `${18 / speed}s` } as CSSProperties;
  return (
    <div className="scene-workspace scene-workspace--immersive">
      <div className="street-scene-viewport">
        <div
          className={`street-scene street-platform-scene${paused ? ' street-scene--paused' : ''}${reducedMotion ? ' street-scene--reduced-motion' : ''}${demo ? ' street-scene--demo' : ''}`}
          style={styles}
        >
          <svg
            className="street-scene-svg street-scene-svg--vertical"
            viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
            role="group"
            aria-labelledby={`${id}-title ${id}-desc`}
          >
            <title id={`${id}-title`}>
              La rue de {snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}
            </title>
            <desc id={`${id}-desc`}>
              Les wagons restent centrés. Les voyageurs circulent sur le quai à droite, entrent par
              la porte haute et sortent par la porte basse après l’arrêt. Le déplacement ne confirme
              aucune transaction.{' '}
              {demo ? 'Données simulées.' : 'Les inclusions sont fournies par la source.'}{' '}
              Sélectionnez un voyageur au clavier ou à la souris.
            </desc>
            <PlatformBackdrop theme={theme} />
            <g aria-hidden="true">
              <text x="13" y="35" fill="#c3d8bd" fontSize="11">
                {demo ? 'SIMULATION' : 'ÉCHANTILLON OBSERVÉ'}
              </text>
              <text x="230" y="54" fill="#c3d8bd" fontSize="11" textAnchor="middle">
                {moving ? 'BLOC PRÉCÉDENT' : `BLOC ${demo ? 'SIMULÉ' : 'OBSERVÉ'}`}
              </text>
              <rect x="304" y="710" width="144" height="22" rx="5" fill="#12382c" />
              <text x="314" y="725" fill="#d3dec0" fontSize="10">
                Candidat · {motion.candidateUsed} / {motion.candidateCapacity}
              </text>
            </g>
            <Wagon
              kind="observed"
              y={OBSERVED_WAGON_Y}
              label={moving ? 'PRÉCÉDENT' : observedLabel}
              passengers={observed}
              doors={moving ? CLOSED_DOORS : (motion.doors?.observed ?? CLOSED_DOORS)}
              moving={moving}
              offsetY={moving ? -progress * (SCENE_HEIGHT + WAGON_HEIGHT) : 0}
              opacity={moving ? 1 - progress : 1}
              selectedId={selectedId}
              onSelect={onSelect}
              feeColor={feeColor}
            />
            <Wagon
              kind={moving ? 'handoff' : 'candidate'}
              y={wagonY}
              label={moving ? 'TRANSFERT' : 'CANDIDAT'}
              passengers={moving ? carried : candidate}
              doors={moving ? CLOSED_DOORS : (motion.doors?.candidate ?? CLOSED_DOORS)}
              moving={moving}
              handoffProgress={moving ? progress : undefined}
              selectedId={selectedId}
              onSelect={onSelect}
              feeColor={feeColor}
            />
            {pedestrians.map((pose) => (
              <Passenger
                key={pose.tx.id}
                pose={pose}
                selected={selectedId === pose.tx.id}
                feeColor={feeColor(pose)}
                onSelect={onSelect}
              />
            ))}
          </svg>
        </div>
      </div>
      {showInfo && (
        <DynamicInfoPanel
          snapshot={snapshot}
          selectedTx={snapshot.transactions.find((tx) => tx.id === selectedId) ?? null}
          activity={activity}
          paused={paused || snapshot.status !== 'ok'}
          reducedMotion={reducedMotion}
          onClearSelection={onClearSelection}
        />
      )}
    </div>
  );
}
