import { memo, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type { Snapshot, Tx } from '../../shared/model';
import { usePassengerMotion } from '../hooks/usePassengerMotion';
import type { PassengerPose } from '../lib/passengerMotion';
import { MAX_WAITING_ARCHIVE_COUNT, WAITING_ARCHIVE_POSITION } from '../lib/passengerMotion';
import {
  SCENE_WIDTH,
  SCENE_HEIGHT,
  WAGON_X,
  WAGON_WIDTH,
  WAGON_HEIGHT,
  NEXT_WAGON_Y,
  LATER_WAGON_Y,
  ENTRY_DOOR_Y,
  EXIT_DOOR_Y,
  type WagonKind,
} from '../lib/streetGeometry';
import { number } from '../lib/format';
import { feeColorForRate } from '../lib/feeColors';
import { formatTransactionFee, formatFeeRate, type FeeDisplayUnit } from '../lib/feeDisplay';
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
  feeDisplayUnit?: FeeDisplayUnit;
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
  caption,
  passengers,
  doors,
  moving = false,
  handoffProgress,
  preparationProgress,
  arrivalProgress,
  offsetY = 0,
  opacity = 1,
  historical = false,
  selectedId,
  onSelect,
  feeColor,
  feeLabel,
}: {
  kind: WagonKind | 'handoff';
  y: number;
  label: string;
  caption: string;
  passengers: PassengerPose[];
  doors: { entry: boolean; exit: boolean };
  moving?: boolean;
  handoffProgress?: number;
  preparationProgress?: number;
  arrivalProgress?: number;
  offsetY?: number;
  opacity?: number;
  historical?: boolean;
  selectedId?: string;
  onSelect: (tx: Tx) => void;
  feeColor: (pose: PassengerPose) => string;
  feeLabel?: (tx: Tx) => string;
}) {
  const clipId = useId().replace(/:/g, '') + '-wagon-interior';
  const entryOpen = !moving && doors.entry;
  const exitOpen = !moving && doors.exit;
  const preservePassages = moving || preparationProgress !== undefined;
  return (
    <g
      className={`street-vertical-wagon street-vertical-wagon--${kind} ${kind === 'next' ? 'street-first-wagon' : 'street-later-wagon'}${kind === 'handoff' ? ' street-projection--handoff' : ''}`}
      data-projection={kind === 'handoff' ? 'next' : kind}
      data-moving={moving}
      data-handoff-progress={handoffProgress}
      data-preparation-progress={preparationProgress}
      data-arrival-progress={arrivalProgress}
      transform={`translate(0 ${offsetY})`}
      opacity={opacity}
    >
      <text x="230" y={y - 18} fill="#c3d8bd" fontSize="10" textAnchor="middle" aria-hidden="true">
        {caption}
      </text>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={WAGON_X + 3}
            y={y + 40}
            width={WAGON_WIDTH - 6}
            height={WAGON_HEIGHT - 51}
            rx="6"
          />
          {(entryOpen || preservePassages) && (
            <rect x={WAGON_X + 72} y={y + ENTRY_DOOR_Y - 34} width="54" height="56" />
          )}
          {(exitOpen || preservePassages) && (
            <rect x={WAGON_X + 72} y={y + EXIT_DOOR_Y - 34} width="54" height="56" />
          )}
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
      <g transform={`translate(${WAGON_X} ${y})`}>
        <SideDoor y={ENTRY_DOOR_Y} open={entryOpen} purpose="entry" />
        <SideDoor y={EXIT_DOOR_Y} open={exitOpen} purpose="exit" />
      </g>
      <g clipPath={`url(#${clipId})`}>
        {passengers.map((pose) => (
          <Passenger
            key={pose.tx.id}
            pose={pose}
            selected={!historical && selectedId === pose.tx.id}
            feeColor={feeColor(pose)}
            feeLabel={feeLabel?.(pose.tx)}
            onSelect={onSelect}
            interactive={!historical}
          />
        ))}
      </g>
    </g>
  );
}

function WaitingArchive({
  count,
  tracked,
  unknown,
}: {
  count: number;
  tracked: number;
  unknown: number;
}) {
  if (count === 0) return null;
  const label = (count >= MAX_WAITING_ARCHIVE_COUNT ? '≥ ' : '') + number(count);
  return (
    <g
      role="img"
      aria-label={`${label} observations anciennes regroupées sur le quai. ${number(tracked)} identifiants conservés pour retrouver leurs inclusions, ${number(unknown)} observations sans suivi individuel. Un regroupement ne signifie pas une attente actuelle sur le réseau.`}
      data-waiting-archive-count={count}
    >
      <title>
        {label} observations regroupées : {number(tracked)} identifiants conservés,{' '}
        {number(unknown)} sans suivi. Le suivi est borné à 512 identifiants et 30 minutes ; une
        confirmation vérifiée peut retrouver son voyageur.
      </title>
      <rect x="318" y="655" width="130" height="49" rx="6" fill="#153d2e" stroke="#789884" />
      <g aria-hidden="true">
        {[-12, -6, 0].map((offset) => (
          <g
            key={offset}
            transform={`translate(${WAITING_ARCHIVE_POSITION.x + offset} ${WAITING_ARCHIVE_POSITION.y})`}
          >
            <ellipse cy="1" rx="7" ry="3" fill="#0b2925" opacity=".55" />
            <path d="M-3-7-4 0M3-7 4 0" stroke="#183d36" strokeWidth="3" />
            <path d="M-4-17Q0-19 4-17L6-7H-6Z" fill="#afc3a3" />
            <path d="M-5-15-7-8M5-15 7-9" stroke="#d2ad84" strokeWidth="2" />
            <circle cy="-22" r="4.6" fill="#d2ad84" />
            <path d="M-4-24q4-6 8 0Z" fill="#344d39" />
          </g>
        ))}
        <text x="405" y="668" textAnchor="middle" fill="#d3dec0" fontSize="9">
          Observations
        </text>
        <text x="405" y="680" textAnchor="middle" fill="#d3dec0" fontSize="9">
          Suivies : {number(tracked)}
        </text>
        <text x="405" y="696" textAnchor="middle" fill="#d3dec0" fontSize="9">
          Sans suivi : {number(unknown)}
        </text>
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
      <text x="313" y="78" fill="#d3dec0" fontSize="9.3">
        FILE · ORDRE D’ARRIVÉE
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
  feeDisplayUnit = 'native',
}: StreetSceneProps) {
  const id = useId().replace(/:/g, '');
  const [compactScene, setCompactScene] = useState(
    () => window.matchMedia('(max-width: 700px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const resize = () => setCompactScene(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const motion = usePassengerMotion({
    snapshot,
    paused: paused || snapshot.status !== 'ok',
    speed,
    reducedMotion,
  });
  const demo = snapshot.mode === 'demo';
  const moving = motion.handoffProgress !== null;
  const preparing = motion.preparationProgress != null;
  const progress = motion.handoffProgress ?? 0;
  const arriving = motion.laterArrivalProgress != null;
  const arrivalProgress = motion.laterArrivalProgress ?? 1;
  const laterY = SCENE_HEIGHT + 12 + (LATER_WAGON_Y - SCENE_HEIGHT - 12) * arrivalProgress;
  const wagonY = moving ? LATER_WAGON_Y + (NEXT_WAGON_Y - LATER_WAGON_Y) * progress : laterY;
  const next = motion.passengers.filter(
    (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'next',
  );
  const later = motion.passengers.filter(
    (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'later',
  );
  const carried = motion.passengers.filter((pose) => pose.inWagon && pose.inHandoff);
  const pedestrians = motion.passengers
    .filter((pose) => !pose.inWagon)
    .sort((left, right) => left.y - right.y);
  const blockLabel = motion.departingBlock
    ? `#${number(motion.departingBlock.height)}`
    : 'BLOC REÇU';
  const projectionUsed = motion.projectionUsed ?? { next: motion.candidateUsed ?? 0, later: 0 };
  const averageFeeRate = useMemo(() => {
    const rates = motion.passengers
      .filter((pose) => pose.sourceObserved && pose.tx.status === 'pending')
      .map((pose) => pose.tx.feeRate)
      .filter((rate) => Number.isFinite(rate) && rate >= 0);
    return rates.length
      ? rates.reduce((average, rate, index) => average + (rate - average) / (index + 1), 0)
      : null;
  }, [motion.passengers]);
  const feeColor = (pose: PassengerPose) => feeColorForRate(pose.tx.feeRate, averageFeeRate);
  const feeLabel = (tx: Tx) =>
    feeDisplayUnit === 'usd'
      ? `${tx.chain === 'ethereum' ? 'estimation avec limite de gas' : 'frais estimés'} : ${formatTransactionFee(tx, 'usd', demo ? null : snapshot.usdQuote)} ; taux observé ${formatFeeRate(tx.chain, tx.feeRate, 'native')}`
      : formatTransactionFee(tx, 'native');
  const activity = useMemo(
    () => ({
      walking:
        motion.counts.arriving +
        motion.counts.reordering +
        motion.counts.walking +
        motion.counts.boarding +
        motion.counts.preparing,
      boarded: motion.passengers.filter((pose) => pose.inWagon && pose.sourceObserved).length,
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
            data-average-fee-rate={averageFeeRate ?? undefined}
            viewBox={
              compactScene
                ? `172 0 ${SCENE_WIDTH - 172} ${SCENE_HEIGHT}`
                : `0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`
            }
            role="group"
            aria-labelledby={`${id}-title ${id}-desc`}
          >
            <title id={`${id}-title`}>
              La rue de {snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}
            </title>
            <desc id={`${id}-desc`}>
              Les deux wagons à l’arrêt projettent les prochains blocs. À réception d’un bloc réel,
              le premier est ajusté aux inclusions connues avant son départ, le second prend sa
              place. Les voyageurs circulent sur le quai droit et les portes restent fermées pendant
              les déplacements. Le déplacement ne confirme aucune transaction.{' '}
              {demo ? 'Données simulées.' : 'Les inclusions sont fournies par la source.'}{' '}
              Sélectionnez un voyageur au clavier ou à la souris.
            </desc>
            <PlatformBackdrop theme={theme} />
            <g aria-hidden="true">
              <text x="13" y="35" fill="#c3d8bd" fontSize="11">
                {demo ? 'SIMULATION' : 'ÉCHANTILLON OBSERVÉ'}
              </text>
              <rect x="304" y="710" width="144" height="22" rx="5" fill="#12382c" />
              <text x="314" y="725" fill="#d3dec0" fontSize="9.5">
                {preparing
                  ? `Embarquement · ${motion.preparationPassengerCount}`
                  : `Proch. ${projectionUsed.next}/12 · Suiv. ${projectionUsed.later}/12`}
              </text>
            </g>
            <Wagon
              kind="next"
              y={NEXT_WAGON_Y}
              label={moving || preparing ? blockLabel : 'PROCHAIN'}
              caption={
                moving
                  ? `${demo ? 'BLOC SIMULÉ' : motion.departureRecovered ? 'INCLUSIONS RETROUVÉES' : 'BLOC CONFIRMÉ'} · DÉPART`
                  : preparing
                    ? motion.departureRecovered
                      ? 'INCLUSIONS RETROUVÉES · RATTRAPAGE'
                      : 'BLOC REÇU · AJUSTEMENT'
                    : 'PROCHAIN BLOC · ESTIMATION'
              }
              passengers={moving ? (motion.departingPassengers ?? []) : next}
              doors={moving ? CLOSED_DOORS : (motion.doors?.next ?? CLOSED_DOORS)}
              moving={moving}
              preparationProgress={
                preparing ? (motion.preparationProgress ?? undefined) : undefined
              }
              offsetY={moving ? -progress * (SCENE_HEIGHT + WAGON_HEIGHT) : 0}
              historical={moving}
              selectedId={selectedId}
              onSelect={onSelect}
              feeColor={feeColor}
              feeLabel={feeLabel}
            />
            <Wagon
              kind={moving ? 'handoff' : 'later'}
              y={wagonY}
              label={moving ? 'PROCHAIN' : arriving ? 'ARRIVÉE' : 'SUIVANT'}
              caption={moving ? 'PROCHAIN BLOC · ESTIMATION' : 'BLOC SUIVANT · ESTIMATION'}
              passengers={moving ? carried : later}
              doors={moving || arriving ? CLOSED_DOORS : (motion.doors?.later ?? CLOSED_DOORS)}
              moving={moving || arriving}
              handoffProgress={moving ? progress : undefined}
              preparationProgress={
                preparing ? (motion.preparationProgress ?? undefined) : undefined
              }
              arrivalProgress={arriving ? arrivalProgress : undefined}
              selectedId={selectedId}
              onSelect={onSelect}
              feeColor={feeColor}
              feeLabel={feeLabel}
            />
            <WaitingArchive
              count={motion.waitingArchiveCount ?? 0}
              tracked={motion.waitingArchiveTrackedCount ?? 0}
              unknown={motion.waitingArchiveUnknownCount ?? 0}
            />
            {pedestrians.map((pose) => (
              <Passenger
                key={pose.tx.id}
                pose={pose}
                selected={selectedId === pose.tx.id}
                feeColor={feeColor(pose)}
                feeLabel={feeLabel(pose.tx)}
                onSelect={onSelect}
              />
            ))}
          </svg>
        </div>
      </div>
      {showInfo && (
        <DynamicInfoPanel
          snapshot={snapshot}
          feeDisplayUnit={feeDisplayUnit}
          selectedTx={
            snapshot.transactions.find((tx) => tx.id === selectedId) ??
            motion.passengers.find(
              (pose) =>
                pose.tx.id === selectedId &&
                snapshot.inclusions?.some(
                  (inclusion) =>
                    inclusion.block.hash === pose.tx.blockHash &&
                    inclusion.transactionIds.includes(pose.tx.id),
                ),
            )?.tx ??
            null
          }
          activity={activity}
          paused={paused || snapshot.status !== 'ok'}
          reducedMotion={reducedMotion}
          onClearSelection={onClearSelection}
        />
      )}
    </div>
  );
}
