import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SVGProps,
} from 'react';
import type { Block, ChainId, Snapshot, Tx } from '../../shared/model';
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
  ARRIVAL_LANE_X,
  type WagonKind,
} from '../lib/streetGeometry';
import { number } from '../lib/format';
import { blockUsagePercent, wagonBlockOccupancy } from '../lib/blockCapacity';
import { feeColorForRate } from '../lib/feeColors';
import { formatTransactionFee, formatFeeRate, type FeeDisplayUnit } from '../lib/feeDisplay';
import { PassengerCanvas } from './PassengerCanvas';
import type { CanvasClip, CanvasPassengerFrame } from '../lib/passengerCanvas';
import { InfoPanel, type SceneActivity } from './InfoPanel';
import { useUsableUsdQuote } from '../hooks/useSourceFreshness';
import './StreetScene.css';

const DynamicInfoPanel = memo(InfoPanel);
const WAGON_COLOR = '#79b8a0';
const CLOSED_DOORS = { entry: false, exit: false };
const VIEW_START_X = 172;
const CORRIDOR_X = 298;
const MIN_VIEW_WIDTH = 236;

function occupancyPercentLabel(percentage: number | null, estimate = false): string {
  if (percentage === null) return '—';
  const value =
    percentage > 0 && percentage < 0.01 ? '<0,01' : number(percentage, percentage < 1 ? 2 : 1);
  return `${estimate ? '≈ ' : ''}${value} %`;
}

function wagonPassengerClips(
  y: number,
  doors: { entry: boolean; exit: boolean },
  moving: boolean,
  preparing: boolean,
): readonly CanvasClip[] {
  const clips: CanvasClip[] = [
    {
      x: WAGON_X + 3,
      y: y + 40,
      width: WAGON_WIDTH - 6,
      height: WAGON_HEIGHT - 51,
      radius: 6,
    },
  ];
  if (doors.entry || moving || preparing) {
    clips.push({ x: WAGON_X + 72, y: y + ENTRY_DOOR_Y - 34, width: 54, height: 56 });
  }
  if (doors.exit || moving || preparing) {
    clips.push({ x: WAGON_X + 72, y: y + EXIT_DOOR_Y - 34, width: 54, height: 56 });
  }
  return clips;
}

const DEPARTURE_PASSENGER_CLIPS = wagonPassengerClips(NEXT_WAGON_Y, CLOSED_DOORS, true, false);

function ReadableText({
  mirrored,
  x,
  ...props
}: SVGProps<SVGTextElement> & { mirrored: boolean; x: number }) {
  return (
    <text {...props} x={x} transform={mirrored ? `translate(${2 * x} 0) scale(-1 1)` : undefined} />
  );
}

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
  onDeparture?: (chain: ChainId, departedAt: number) => void;
  onActivity?: (chain: ChainId, activity: SceneActivity) => void;
  mirrored?: boolean;
}

function SideDoor({
  y,
  open,
  purpose,
  mirrored,
}: {
  y: number;
  open: boolean;
  purpose: 'entry' | 'exit';
  mirrored: boolean;
}) {
  return (
    <g
      className={`street-side-door${open ? ' street-side-door--open' : ''}`}
      data-door={purpose}
      data-side={mirrored ? 'left' : 'right'}
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
  chain,
  capacity,
  confirmedBlock,
  simulated = false,
  doors,
  moving = false,
  handoffProgress,
  preparationProgress,
  arrivalProgress,
  offsetY = 0,
  opacity = 1,
  mirrored,
}: {
  kind: WagonKind | 'handoff';
  y: number;
  label: string;
  caption: string;
  passengers: PassengerPose[];
  chain: ChainId;
  capacity: number | null;
  confirmedBlock?: Block | null;
  simulated?: boolean;
  doors: { entry: boolean; exit: boolean };
  moving?: boolean;
  handoffProgress?: number;
  preparationProgress?: number;
  arrivalProgress?: number;
  offsetY?: number;
  opacity?: number;
  mirrored: boolean;
}) {
  const headlightGradientId = useId().replace(/:/g, '') + '-headlight-beam';
  const entryOpen = !moving && doors.entry;
  const exitOpen = !moving && doors.exit;
  const headlightsOn = moving || preparationProgress !== undefined;
  const brakeLightsOn =
    moving &&
    kind !== 'next' &&
    ((handoffProgress !== undefined && handoffProgress >= 0.7) ||
      (arrivalProgress !== undefined && arrivalProgress >= 0.7));
  const [captionMain, ...captionDetails] = caption.split(' · ');
  const occupancy = useMemo(
    () =>
      wagonBlockOccupancy(
        passengers.map((pose) => pose.tx),
        capacity,
        confirmedBlock,
      ),
    [passengers, capacity, confirmedBlock],
  );
  const unit = chain === 'bitcoin' ? 'vB' : 'gas';
  const occupancyLabel = occupancyPercentLabel(occupancy.percentage, occupancy.kind === 'sample');
  const transactionCountLabel = `${number(occupancy.transactionCount)} TX · ${occupancyLabel}`;
  const transactionCountDescription = `${simulated ? 'Données simulées. ' : ''}${number(occupancy.transactionCount)} transactions de l’échantillon représentées à bord. ${
    occupancy.kind === 'block'
      ? `Occupation ${simulated ? 'du bloc simulé' : 'réelle du bloc'} ${confirmedBlock?.hash} complet : ${number(occupancy.used, 2)} ${unit} sur ${number(occupancy.capacity)} ${unit}, soit ${occupancyLabel}. Ce taux concerne tout le bloc, tandis que le compteur TX compte seulement les voyageurs représentés.`
      : occupancy.kind === 'sample'
        ? `Estimation de la place représentée à bord : ${number(occupancy.used, 2)} ${unit} sur ${number(occupancy.capacity)} ${unit}, soit ${occupancyLabel}. ${chain === 'ethereum' ? 'Limites de gas déclarées divisées par la limite du dernier bloc observé ; elles ne mesurent pas le gas réellement consommé et la limite du prochain bloc peut évoluer.' : 'Somme des tailles virtuelles divisée par le budget de poids du bloc exprimé en vB ; les frais de structure du bloc ne sont pas inclus.'} Les places réservées hors du wagon sont exclues. Cet échantillon limité ne représente pas tout le futur bloc.`
        : 'Occupation indisponible : capacité ou consommation nécessaire absente.'
  }`;
  return (
    <g
      className={`street-vertical-wagon street-vertical-wagon--${kind} ${kind === 'next' ? 'street-first-wagon' : 'street-later-wagon'}${kind === 'handoff' ? ' street-projection--handoff' : ''}`}
      data-projection={kind === 'handoff' ? 'next' : kind}
      data-moving={moving}
      data-handoff-progress={handoffProgress}
      data-preparation-progress={preparationProgress}
      data-arrival-progress={arrivalProgress}
      data-headlights={headlightsOn}
      data-brake-lights={brakeLightsOn}
      transform={`translate(0 ${offsetY})`}
      opacity={opacity}
    >
      <ReadableText
        mirrored={mirrored}
        x={230}
        y={y - 27}
        fill="#c3d8bd"
        fontSize="9"
        textAnchor="middle"
        aria-hidden="true"
      >
        <tspan x={230}>{captionMain}</tspan>
        <tspan x={230} dy="11" fontSize="8" fill="#9fbba2">
          {captionDetails.join(' · ')}
        </tspan>
      </ReadableText>
      <defs>
        <linearGradient id={headlightGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff4bb" stopOpacity="0" />
          <stop offset="1" stopColor="#fff4bb" stopOpacity=".38" />
        </linearGradient>
      </defs>
      <g transform={`translate(${WAGON_X} ${y})`} aria-hidden="true">
        <g className="street-wagon-headlight-emission">
          <path d="M10 11 -3-48 34-48 21 11Z" fill={`url(#${headlightGradientId})`} />
          <path d="M64 11 51-48 88-48 75 11Z" fill={`url(#${headlightGradientId})`} />
        </g>
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
        <g className="street-wagon-headlight-emission">
          <ellipse cx="15.5" cy="10" rx="13" ry="10" fill="#fff4bb" opacity=".16" />
          <ellipse cx="69.5" cy="10" rx="13" ry="10" fill="#fff4bb" opacity=".16" />
          <ellipse cx="15.5" cy="10" rx="8" ry="6" fill="#fff4bb" opacity=".36" />
          <ellipse cx="69.5" cy="10" rx="8" ry="6" fill="#fff4bb" opacity=".36" />
        </g>
        <rect
          className="street-wagon-headlight-lamp"
          x="10"
          y="7"
          width="11"
          height="6"
          rx="3"
          stroke="#40564a"
          strokeWidth="1"
        />
        <rect
          className="street-wagon-headlight-lamp"
          x="64"
          y="7"
          width="11"
          height="6"
          rx="3"
          stroke="#40564a"
          strokeWidth="1"
        />
        <rect x="8" y="14" width="69" height="24" rx="7" fill="#203d35" />
        <ReadableText
          mirrored={mirrored}
          x={42.5}
          y="30"
          fill="#d5e3c7"
          fontSize="8"
          textAnchor="middle"
        >
          {label}
        </ReadableText>
        <rect x="13" y="46" width="58" height="140" rx="7" fill="#203d35" />
        <path d="M17 91h50M17 121h50M17 151h50" stroke="#567d6c" strokeWidth="2" />
        <g className="street-wagon-brake-emission">
          <ellipse cx="14" cy="207" rx="12" ry="10" fill="#f33f43" opacity=".2" />
          <ellipse cx="71" cy="207" rx="12" ry="10" fill="#f33f43" opacity=".2" />
          <ellipse cx="14" cy="207" rx="7" ry="6" fill="#ff7670" opacity=".34" />
          <ellipse cx="71" cy="207" rx="7" ry="6" fill="#ff7670" opacity=".34" />
        </g>
        <circle
          className="street-wagon-brake-lamp"
          cx="14"
          cy="207"
          r="3.5"
          stroke="#612d30"
          strokeWidth="1"
        />
        <circle
          className="street-wagon-brake-lamp"
          cx="71"
          cy="207"
          r="3.5"
          stroke="#612d30"
          strokeWidth="1"
        />
      </g>
      <g transform={`translate(${WAGON_X} ${y})`}>
        <SideDoor y={ENTRY_DOOR_Y} open={entryOpen} purpose="entry" mirrored={mirrored} />
        <SideDoor y={EXIT_DOOR_Y} open={exitOpen} purpose="exit" mirrored={mirrored} />
      </g>
      <g
        className="street-wagon-transaction-count"
        role="img"
        aria-label={transactionCountDescription}
        data-transaction-count={occupancy.transactionCount}
        data-occupancy-percent={occupancy.percentage ?? undefined}
        data-resource-used={occupancy.used ?? undefined}
        data-resource-capacity={occupancy.capacity ?? undefined}
        data-resource-unit={unit}
        data-occupancy-kind={occupancy.kind}
      >
        <title>{transactionCountDescription}</title>
        <rect
          x={WAGON_X + 6}
          y={y + 190}
          width="73"
          height="14"
          rx="4"
          fill="#d1dfc0"
          stroke="#203d35"
          strokeWidth=".8"
        />
        <ReadableText
          mirrored={mirrored}
          x={WAGON_X + WAGON_WIDTH / 2}
          y={y + 201}
          fill="#173c30"
          fontSize={
            transactionCountLabel.length > 16 ? 7 : transactionCountLabel.length > 13 ? 8 : 9.5
          }
          fontWeight="700"
          textAnchor="middle"
          aria-hidden="true"
        >
          {transactionCountLabel}
        </ReadableText>
      </g>
    </g>
  );
}

function WaitingArchive({
  count,
  tracked,
  unknown,
  projectX,
  mirrored,
}: {
  count: number;
  tracked: number;
  unknown: number;
  projectX: (x: number) => number;
  mirrored: boolean;
}) {
  if (count === 0) return null;
  const label = (count >= MAX_WAITING_ARCHIVE_COUNT ? '≥ ' : '') + number(count);
  const center = projectX(WAITING_ARCHIVE_POSITION.x);
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
      <rect
        x={center - 65}
        y="655"
        width="130"
        height="49"
        rx="6"
        fill="#153d2e"
        stroke="#789884"
      />
      <g aria-hidden="true">
        {[-12, -6, 0].map((offset) => (
          <g
            key={offset}
            transform={`translate(${center - 35 + offset} ${WAITING_ARCHIVE_POSITION.y})`}
          >
            <ellipse cy="1" rx="7" ry="3" fill="#0b2925" opacity=".55" />
            <path d="M-3-7-4 0M3-7 4 0" stroke="#183d36" strokeWidth="3" />
            <path d="M-4-17Q0-19 4-17L6-7H-6Z" fill="#afc3a3" />
            <path d="M-5-15-7-8M5-15 7-9" stroke="#d2ad84" strokeWidth="2" />
            <circle cy="-22" r="4.6" fill="#d2ad84" />
            <path d="M-4-24q4-6 8 0Z" fill="#344d39" />
          </g>
        ))}
        <ReadableText
          mirrored={mirrored}
          x={center + 24}
          y="668"
          textAnchor="middle"
          fill="#d3dec0"
          fontSize="9"
        >
          Observations
        </ReadableText>
        <ReadableText
          mirrored={mirrored}
          x={center + 24}
          y="680"
          textAnchor="middle"
          fill="#d3dec0"
          fontSize="9"
        >
          Suivies : {number(tracked)}
        </ReadableText>
        <ReadableText
          mirrored={mirrored}
          x={center + 24}
          y="696"
          textAnchor="middle"
          fill="#d3dec0"
          fontSize="8"
        >
          Sans suivi : {number(unknown)}
        </ReadableText>
      </g>
    </g>
  );
}

const PlatformBackdrop = memo(function PlatformBackdrop({
  viewWidth,
  projectX,
  mirrored,
}: {
  viewWidth: number;
  projectX: (x: number) => number;
  mirrored: boolean;
}) {
  const viewEnd = VIEW_START_X + viewWidth;
  const arrivalStart = projectX(426);
  const fileStart = projectX(310);
  const fileEnd = projectX(420);
  const narrow = viewWidth < 360;
  return (
    <g aria-hidden="true">
      <rect x={VIEW_START_X} width={viewWidth} height={SCENE_HEIGHT} fill="#234a3b" />
      <rect x="185" width="90" height={SCENE_HEIGHT} fill="#15352f" />
      <path d="M181 0v740M279 0v740" stroke="#83987b" strokeWidth="5" />
      <path d="M230 0v740" stroke="#adc4a3" strokeWidth="2" strokeDasharray="22 23" opacity=".32" />
      <rect x="282" width={viewEnd - 282} height={SCENE_HEIGHT} fill="#385a43" />
      <rect x={fileStart} width={fileEnd - fileStart} height={SCENE_HEIGHT} fill="#45644a" />
      <rect x={arrivalStart} width={viewEnd - arrivalStart} height={SCENE_HEIGHT} fill="#294d3d" />
      <path d="M298 77v634" stroke="#c7cba0" strokeWidth="2" strokeDasharray="4 8" opacity=".3" />
      <path
        d={`M${projectX(ARRIVAL_LANE_X)} 120v512`}
        stroke="#90ad8e"
        strokeWidth="2"
        strokeDasharray="4 11"
        opacity=".35"
      />
      <ReadableText
        mirrored={mirrored}
        x={CORRIDOR_X}
        y="92"
        textAnchor="middle"
        fill="#c8d8b5"
        fontSize={narrow ? 8 : 10}
        letterSpacing=".6"
      >
        PASSAGE
      </ReadableText>
      <ReadableText
        mirrored={mirrored}
        x={(fileStart + fileEnd) / 2}
        y="92"
        textAnchor="middle"
        fill="#e0e6c7"
        fontSize={narrow ? 11 : 13}
        letterSpacing="1"
      >
        FILE
      </ReadableText>
      {!narrow && (
        <ReadableText
          mirrored={mirrored}
          x={(fileStart + fileEnd) / 2}
          y="110"
          textAnchor="middle"
          fill="#a6bea0"
          fontSize="9"
        >
          ORDRE D’ARRIVÉE
        </ReadableText>
      )}
      <ReadableText
        mirrored={mirrored}
        x={(arrivalStart + viewEnd) / 2}
        y="92"
        textAnchor="middle"
        fill="#d3dec0"
        fontSize={narrow ? 7.5 : 11}
      >
        {narrow ? 'ENTRÉE' : 'ARRIVÉES'}
      </ReadableText>
    </g>
  );
});

export const StreetScene = memo(function StreetScene({
  snapshot,
  paused,
  speed,
  reducedMotion,
  onSelect,
  selectedId,
  onClearSelection,
  showInfo = true,
  feeDisplayUnit = 'native',
  onDeparture,
  onActivity,
  mirrored = false,
}: StreetSceneProps) {
  const id = useId().replace(/:/g, '');
  const viewport = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(SCENE_WIDTH - VIEW_START_X);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = (width: number, height: number) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const nextWidth = Math.max(MIN_VIEW_WIDTH, (SCENE_HEIGHT * width) / height);
      if (!Number.isFinite(nextWidth)) return;
      setViewWidth((current) => (Math.abs(current - nextWidth) < 0.5 ? current : nextWidth));
    };
    const initial = element.getBoundingClientRect();
    update(initial.width, initial.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const viewEnd = VIEW_START_X + viewWidth;
  const projectionScale = (viewEnd - CORRIDOR_X) / (SCENE_WIDTH - CORRIDOR_X);
  const projectX = useMemo(
    () => (x: number) => (x <= CORRIDOR_X ? x : CORRIDOR_X + (x - CORRIDOR_X) * projectionScale),
    [projectionScale],
  );
  const projectPose = useMemo(() => {
    const projected = new WeakMap<PassengerPose, PassengerPose>();
    return (pose: PassengerPose): PassengerPose => {
      const cached = projected.get(pose);
      if (cached) return cached;
      const radians =
        pose.movementAngle === undefined ? undefined : (pose.movementAngle * Math.PI) / 180;
      const result = {
        ...pose,
        x: projectX(pose.x),
        queueX: projectX(pose.queueX),
        movementAngle:
          radians === undefined
            ? undefined
            : (Math.atan2(
                Math.sin(radians),
                Math.cos(radians) * (pose.x > CORRIDOR_X ? projectionScale : 1),
              ) *
                180) /
              Math.PI,
      };
      projected.set(pose, result);
      return result;
    };
  }, [projectX, projectionScale]);
  const motion = usePassengerMotion({
    snapshot,
    paused: paused || snapshot.status !== 'ok',
    speed,
    reducedMotion,
  });
  useEffect(() => {
    if (motion.lastDepartureAt !== null) onDeparture?.(snapshot.chain, motion.lastDepartureAt);
  }, [motion.lastDepartureAt, onDeparture, snapshot.chain]);
  const demo = snapshot.mode === 'demo';
  const moving = motion.handoffProgress !== null;
  const preparing = motion.preparationProgress != null;
  const progress = motion.handoffProgress ?? 0;
  const arriving = motion.laterArrivalProgress != null;
  const arrivalProgress = motion.laterArrivalProgress ?? 1;
  const laterY = SCENE_HEIGHT + 12 + (LATER_WAGON_Y - SCENE_HEIGHT - 12) * arrivalProgress;
  const wagonY = moving ? LATER_WAGON_Y + (NEXT_WAGON_Y - LATER_WAGON_Y) * progress : laterY;
  const { next, later, carried, pedestrians } = useMemo(
    () => ({
      next: motion.passengers.filter(
        (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'next',
      ),
      later: motion.passengers.filter(
        (pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'later',
      ),
      carried: motion.passengers.filter((pose) => pose.inWagon && pose.inHandoff),
      pedestrians: motion.passengers
        .filter((pose) => !pose.inWagon)
        .sort((left, right) => left.y - right.y),
    }),
    [motion.passengers],
  );
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
  const feeColor = useMemo(() => {
    const colors = new WeakMap<Tx, string>();
    return (pose: PassengerPose) => {
      const cached = colors.get(pose.tx);
      if (cached !== undefined) return cached;
      const color = feeColorForRate(pose.tx.feeRate, averageFeeRate);
      colors.set(pose.tx, color);
      return color;
    };
  }, [averageFeeRate]);
  const quote = demo ? null : snapshot.usdQuote;
  const quoteUsable = useUsableUsdQuote(quote);
  const feeLabel = useMemo(() => {
    const labels = new WeakMap<Tx, string>();
    const currentQuote = quoteUsable ? quote : null;
    return (tx: Tx) => {
      const cached = labels.get(tx);
      if (cached !== undefined) return cached;
      const label =
        feeDisplayUnit === 'usd'
          ? `${tx.chain === 'ethereum' ? 'estimation avec limite de gas' : 'frais estimés'} : ${formatTransactionFee(tx, 'usd', currentQuote)} ; taux observé ${formatFeeRate(tx.chain, tx.feeRate, 'native')}`
          : formatTransactionFee(tx, 'native');
      labels.set(tx, label);
      return label;
    };
  }, [feeDisplayUnit, quote, quoteUsable]);
  const departurePassengers = useMemo(
    () =>
      motion.departingPassengers.map((pose) => ({
        pose: projectPose(pose),
        color: feeColor(pose),
        interactive: false,
      })),
    [motion.departingPassengers, projectPose, feeColor],
  );
  const canvasFrame = useMemo<CanvasPassengerFrame>(() => {
    const firstDoors = moving ? CLOSED_DOORS : (motion.doors?.next ?? CLOSED_DOORS);
    const secondDoors = moving || arriving ? CLOSED_DOORS : (motion.doors?.later ?? CLOSED_DOORS);
    const firstClips = wagonPassengerClips(NEXT_WAGON_Y, firstDoors, moving, preparing);
    const secondClips = wagonPassengerClips(wagonY, secondDoors, moving || arriving, preparing);
    const departureOffset = moving ? -progress * (SCENE_HEIGHT + WAGON_HEIGHT) : 0;
    const describe = (pose: PassengerPose) => ({
      pose: projectPose(pose),
      color: feeColor(pose),
      feeLabel: feeLabel(pose.tx),
      interactive: true,
    });
    return {
      view: { startX: VIEW_START_X, width: viewWidth, height: SCENE_HEIGHT, mirrored },
      departure: moving
        ? {
            passengers: departurePassengers,
            clips: DEPARTURE_PASSENGER_CLIPS,
            offsetY: departureOffset,
          }
        : undefined,
      passengers: [
        ...(!moving ? next : []).map((pose) => ({
          ...describe(pose),
          clips: firstClips,
        })),
        ...(moving ? carried : later).map((pose) => ({
          ...describe(pose),
          clips: secondClips,
        })),
        ...pedestrians.map(describe),
      ],
    };
  }, [
    moving,
    arriving,
    preparing,
    progress,
    wagonY,
    motion.doors,
    departurePassengers,
    next,
    carried,
    later,
    pedestrians,
    projectPose,
    feeColor,
    feeLabel,
    viewWidth,
    mirrored,
  ]);
  const boardedCount = motion.passengers.filter(
    (pose) => pose.inWagon && pose.sourceObserved,
  ).length;
  const activity = useMemo(
    () => ({
      walking:
        motion.counts.arriving +
        motion.counts.reordering +
        motion.counts.walking +
        motion.counts.boarding +
        motion.counts.preparing,
      boarded: boardedCount,
      returning: motion.counts.exiting + motion.counts.returning,
      waiting: motion.counts.queue,
    }),
    [
      motion.counts.arriving,
      motion.counts.reordering,
      motion.counts.walking,
      motion.counts.boarding,
      motion.counts.preparing,
      motion.counts.exiting,
      motion.counts.returning,
      motion.counts.queue,
      boardedCount,
    ],
  );
  const styles = useMemo(
    () => ({ '--scene-duration': `${18 / speed}s` }) as CSSProperties,
    [speed],
  );
  const lastActivityAt = useRef(0);
  useEffect(() => {
    if (!onActivity) return;
    const publish = () => {
      lastActivityAt.current = performance.now();
      onActivity(snapshot.chain, activity);
    };
    const delay = Math.max(0, 250 - (performance.now() - lastActivityAt.current));
    if (delay === 0) {
      publish();
      return;
    }
    const timer = window.setTimeout(publish, delay);
    return () => window.clearTimeout(timer);
  }, [onActivity, snapshot.chain, activity]);
  return (
    <div className="scene-workspace scene-workspace--immersive">
      <div ref={viewport} className="street-scene-viewport">
        <div
          className={`street-scene street-platform-scene${paused ? ' street-scene--paused' : ''}${reducedMotion ? ' street-scene--reduced-motion' : ''}${demo ? ' street-scene--demo' : ''}`}
          style={styles}
        >
          <svg
            className="street-scene-svg street-scene-svg--vertical"
            data-average-fee-rate={averageFeeRate ?? undefined}
            viewBox={`${VIEW_START_X} 0 ${viewWidth} ${SCENE_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            data-mirrored={mirrored}
            role="group"
            aria-labelledby={`${id}-title ${id}-desc`}
          >
            <title id={`${id}-title`}>
              La rue de {snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}
            </title>
            <desc id={`${id}-desc`}>
              Les deux wagons à l’arrêt projettent les prochains blocs. À réception d’un bloc réel,
              le premier est ajusté aux inclusions connues avant son départ, le second prend sa
              place. Les voyageurs arrivent depuis le bord {mirrored ? 'gauche' : 'droit'} et
              circulent sur le quai extérieur. Les portes restent fermées pendant les déplacements.
              Le déplacement ne confirme aucune transaction.{' '}
              {demo ? 'Données simulées.' : 'Les inclusions sont fournies par la source.'} Cliquez
              sur un voyageur ou utilisez « Parcourir les transactions » au clavier.
            </desc>
            <g
              transform={
                mirrored ? `translate(${2 * VIEW_START_X + viewWidth} 0) scale(-1 1)` : undefined
              }
            >
              <PlatformBackdrop viewWidth={viewWidth} projectX={projectX} mirrored={mirrored} />
              <g aria-hidden="true">
                <ReadableText
                  mirrored={mirrored}
                  x={(282 + viewEnd) / 2}
                  y="35"
                  textAnchor="middle"
                  fill="#c3d8bd"
                  fontSize={viewWidth < 360 ? 9 : 11}
                  letterSpacing=".5"
                >
                  {demo ? 'SIMULATION' : 'ÉCHANTILLON OBSERVÉ'}
                </ReadableText>
                <rect
                  x={(282 + viewEnd) / 2 - Math.min(172, viewEnd - 298) / 2}
                  y="710"
                  width={Math.min(172, viewEnd - 298)}
                  height="22"
                  rx="5"
                  fill="#12382c"
                />
                <ReadableText
                  mirrored={mirrored}
                  x={(282 + viewEnd) / 2}
                  y="725"
                  textAnchor="middle"
                  fill="#d3dec0"
                  fontSize={viewWidth < 360 ? 8 : 9.5}
                >
                  {preparing
                    ? `Embarquement · ${motion.preparationPassengerCount}`
                    : `${snapshot.chain === 'bitcoin' ? 'vB' : 'gas'} · P ${occupancyPercentLabel(blockUsagePercent(projectionUsed.next, motion.candidateCapacity), true)} · S ${occupancyPercentLabel(blockUsagePercent(projectionUsed.later, motion.candidateCapacity), true)}`}
                  <title>
                    Réservations des projections dans l’échantillon : prochain{' '}
                    {number(projectionUsed.next, 2)}
                    {' / '}
                    {number(motion.candidateCapacity)} {snapshot.chain === 'bitcoin' ? 'vB' : 'gas'}
                    {' ; suivant '}
                    {number(projectionUsed.later, 2)}
                    {' / '}
                    {number(motion.candidateCapacity)} {snapshot.chain === 'bitcoin' ? 'vB' : 'gas'}
                    .
                    {snapshot.chain === 'ethereum' &&
                      ' Limites de gas déclarées, estimation prudente.'}
                  </title>
                </ReadableText>
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
                chain={snapshot.chain}
                capacity={motion.candidateCapacity}
                confirmedBlock={moving || preparing ? motion.departingBlock : undefined}
                simulated={demo}
                doors={moving ? CLOSED_DOORS : (motion.doors?.next ?? CLOSED_DOORS)}
                moving={moving}
                preparationProgress={
                  preparing ? (motion.preparationProgress ?? undefined) : undefined
                }
                offsetY={moving ? -progress * (SCENE_HEIGHT + WAGON_HEIGHT) : 0}
                mirrored={mirrored}
              />
              <Wagon
                kind={moving ? 'handoff' : 'later'}
                y={wagonY}
                label={moving ? 'PROCHAIN' : arriving ? 'ARRIVÉE' : 'SUIVANT'}
                caption={moving ? 'PROCHAIN BLOC · ESTIMATION' : 'BLOC SUIVANT · ESTIMATION'}
                passengers={moving ? carried : later}
                chain={snapshot.chain}
                capacity={motion.candidateCapacity}
                simulated={demo}
                doors={moving || arriving ? CLOSED_DOORS : (motion.doors?.later ?? CLOSED_DOORS)}
                moving={moving || arriving}
                handoffProgress={moving ? progress : undefined}
                preparationProgress={
                  preparing ? (motion.preparationProgress ?? undefined) : undefined
                }
                arrivalProgress={arriving ? arrivalProgress : undefined}
                mirrored={mirrored}
              />
              <WaitingArchive
                count={motion.waitingArchiveCount ?? 0}
                tracked={motion.waitingArchiveTrackedCount ?? 0}
                unknown={motion.waitingArchiveUnknownCount ?? 0}
                projectX={projectX}
                mirrored={mirrored}
              />
            </g>
          </svg>
          <PassengerCanvas
            frame={canvasFrame}
            selectedId={selectedId}
            onSelect={onSelect}
            chain={snapshot.chain}
          />
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
});
