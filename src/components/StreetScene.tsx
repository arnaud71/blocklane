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
import type { BitcoinBlockTemplate, Block, ChainId, Snapshot, Tx } from '../../shared/model';
import { usePassengerMotion } from '../hooks/usePassengerMotion';
import type { PassengerPose } from '../lib/passengerMotion';
import {
  MAX_WAITING_ARCHIVE_COUNT,
  WAITING_ARCHIVE_POSITION,
  activeBitcoinBlockTemplate,
} from '../lib/passengerMotion';
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
  HISTORICAL_QUEUE_AREA,
  createQueueLayout,
  type WagonKind,
} from '../lib/streetGeometry';
import { number as formatNumber } from '../lib/format';
import { languageTag, useI18n, type Locale } from '../i18n';
import {
  bitcoinCandidateRepresentation,
  blockUsagePercent,
  wagonBlockOccupancy,
} from '../lib/blockCapacity';
import { feeColorForRate } from '../lib/feeColors';
import { passengerPlanningReason } from '../lib/passengerPresentation';
import { isHistoricalPassenger } from '../lib/passengerStatus';
import { formatTransactionFee, formatFeeRate, type FeeDisplayUnit } from '../lib/feeDisplay';
import { PassengerCanvas } from './PassengerCanvas';
import { NetworkRemainder } from './NetworkRemainder';
import { ProviderFlowArrivals } from './ProviderFlowArrivals';
import { confirmedBlockRemainder } from '../lib/networkRemainder';
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

function occupancyPercentLabel(
  percentage: number | null,
  estimate = false,
  locale: Locale = 'fr',
): string {
  if (percentage === null) return '—';
  const value =
    percentage > 0 && percentage < 0.01
      ? locale === 'fr'
        ? '<0,01'
        : '<0.01'
      : formatNumber(percentage, percentage < 1 ? 2 : 1, locale);
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

function useSceneText() {
  const { locale, t } = useI18n();
  return {
    locale,
    t,
    number: (value: number | null, digits = 0) => formatNumber(value, digits, locale),
  };
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
  browseTarget?: HTMLElement | null;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onSelect: (tx: Tx) => void;
  selectedId?: string;
  selectedFallback?: Tx;
  theme?: 'heg' | 'neutral';
  onClearSelection?: () => void;
  onCloseInfo?: () => void;
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
  nodeTemplate,
  templateRepresentation,
  blockRepresentation,
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
  nodeTemplate?: BitcoinBlockTemplate | null;
  templateRepresentation?: { individualCount: number; groupedCount: number } | null;
  blockRepresentation?: NonNullable<ReturnType<typeof confirmedBlockRemainder>> | null;
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
  const { locale, t, number } = useSceneText();
  const headlightGradientId = useId().replace(/:/g, '') + '-headlight-beam';
  const templatePatternId = headlightGradientId + '-collective';
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
        nodeTemplate,
      ),
    [passengers, capacity, confirmedBlock, nodeTemplate],
  );
  const collectiveBlock =
    confirmedBlock && blockRepresentation?.groupedCount ? blockRepresentation : null;
  const unit = chain === 'bitcoin' ? 'vB' : 'gas';
  const occupancyLabel = occupancyPercentLabel(
    occupancy.percentage,
    occupancy.kind === 'sample',
    locale,
  );
  const transactionCountLabel = `${number(occupancy.transactionCount)} TX · ${occupancyLabel}`;
  const retainedObservationCount = passengers.filter(
    (pose) => !pose.sourceObserved && pose.tx.status === 'pending',
  ).length;
  const transactionCountDescriptionFrench = `${simulated ? 'Données simulées. ' : ''}${occupancy.kind === 'template' ? `${number(occupancy.transactionCount)} transactions proposées dans le candidat complet du nœud. ${number(templateRepresentation?.individualCount ?? 0)} membres ont un bonhomme individuel dans la scène, y compris ceux encore sur le quai ; ${number(templateRepresentation?.groupedCount ?? occupancy.transactionCount)} sont représentés collectivement. ` : `${number(occupancy.transactionCount)} transactions observées représentées à bord. `}${retainedObservationCount ? `Observations conservées hors de l’échantillon actuel : ${number(retainedObservationCount)}. L’horloge indique que leur présence actuelle dans le mempool est inconnue. ` : ''}${
    occupancy.kind === 'template'
      ? `Occupation proposée du candidat complet hors coinbase : ${number(occupancy.used, 2)} ${unit} sur ${number(occupancy.capacity)} ${unit}, soit ${occupancyLabel}. Calcul sur toutes les transactions proposées ; en-tête et coinbase exclus.`
      : occupancy.kind === 'block'
        ? `Occupation ${simulated ? 'du bloc simulé' : 'réelle du bloc'} ${confirmedBlock?.hash} complet : ${number(occupancy.used, 2)} ${unit} sur ${number(occupancy.capacity)} ${unit}, soit ${occupancyLabel}. Ce taux concerne tout le bloc, tandis que le compteur TX compte seulement les voyageurs individualisés à bord.`
        : occupancy.kind === 'sample'
          ? `Estimation de la place représentée à bord : ${number(occupancy.used, 2)} ${unit} sur ${number(occupancy.capacity)} ${unit}, soit ${occupancyLabel}. ${chain === 'ethereum' ? 'Limites de gas déclarées divisées par la limite du dernier bloc observé ; elles ne mesurent pas le gas réellement consommé et la limite du prochain bloc peut évoluer.' : 'Somme des tailles virtuelles divisée par le budget de poids du bloc exprimé en vB ; les frais de structure du bloc ne sont pas inclus.'} Les places réservées hors du wagon sont exclues. Cet échantillon limité ne représente pas tout le futur bloc.`
          : 'Occupation indisponible : capacité ou consommation nécessaire absente.'
  }${collectiveBlock ? ` Bloc complet : ${number(collectiveBlock.transactionCount)} transactions${chain === 'bitcoin' ? ' hors coinbase' : ''}, dont ${number(collectiveBlock.individualCount)} individualisées dans toute la scène et ${number(collectiveBlock.groupedCount)} représentées collectivement sans identifiants inventés.` : ''}${nodeTemplate ? ` Candidat du nœud ${nodeTemplate.source}, hauteur ${number(nodeTemplate.height)}, relevé à ${new Date(nodeTemplate.observedAt).toLocaleTimeString(languageTag(locale))}. Le compteur et le pourcentage concernent tout le candidat ; seuls les détails individuels sont limités. Cette proposition ne prouve aucune inclusion ni qu’un pool minier la mine.` : ''}`;
  const transactionCountDescription = t(
    transactionCountDescriptionFrench,
    `${simulated ? 'Simulated data. ' : ''}${occupancy.kind === 'template' ? `${number(occupancy.transactionCount)} transactions proposed in the node’s complete candidate. ${number(templateRepresentation?.individualCount ?? 0)} members have individual passengers in the scene, including those still on the platform; ${number(templateRepresentation?.groupedCount ?? occupancy.transactionCount)} are represented collectively. ` : `${number(occupancy.transactionCount)} observed transactions represented aboard. `}${retainedObservationCount ? `Retained observations outside the current sample: ${number(retainedObservationCount)}. The clock indicates that their current mempool presence is unknown. ` : ''}${
      occupancy.kind === 'template'
        ? `Proposed occupancy of the complete candidate excluding coinbase: ${number(occupancy.used, 2)} ${unit} out of ${number(occupancy.capacity)} ${unit}, or ${occupancyLabel}. Calculated across all proposed transactions; header and coinbase excluded.`
        : occupancy.kind === 'block'
          ? `${simulated ? 'Simulated' : 'Actual'} occupancy of the complete block ${confirmedBlock?.hash}: ${number(occupancy.used, 2)} ${unit} out of ${number(occupancy.capacity)} ${unit}, or ${occupancyLabel}. This percentage covers the whole block, while the TX counter counts only individual passengers aboard.`
          : occupancy.kind === 'sample'
            ? `Estimated space represented aboard: ${number(occupancy.used, 2)} ${unit} out of ${number(occupancy.capacity)} ${unit}, or ${occupancyLabel}. ${chain === 'ethereum' ? 'Declared gas limits divided by the latest observed block’s gas limit; these do not measure gas actually consumed, and the next block’s limit may change.' : 'Sum of virtual sizes divided by the block weight budget expressed in vB; block overhead is excluded.'} Reserved places outside the vehicle are excluded. This limited sample does not represent the entire future block.`
            : 'Occupancy unavailable: required capacity or resource usage is missing.'
    }${collectiveBlock ? ` Complete block: ${number(collectiveBlock.transactionCount)} transactions${chain === 'bitcoin' ? ' excluding coinbase' : ''}, including ${number(collectiveBlock.individualCount)} individual passengers throughout the scene and ${number(collectiveBlock.groupedCount)} represented collectively without invented identifiers.` : ''}${nodeTemplate ? ` Candidate from node ${nodeTemplate.source}, height ${number(nodeTemplate.height)}, observed at ${new Date(nodeTemplate.observedAt).toLocaleTimeString(languageTag(locale))}. The counter and percentage cover the entire candidate; only individual details are limited. This proposal proves neither inclusion nor that a mining pool is mining it.` : ''}`,
  );

  return (
    <g
      className={`street-vertical-wagon street-vertical-wagon--${kind} ${kind === 'next' ? 'street-first-wagon' : 'street-later-wagon'}${kind === 'handoff' ? ' street-projection--handoff' : ''}`}
      data-projection={kind === 'handoff' ? 'next' : kind}
      data-projection-source={
        confirmedBlock ? 'confirmed-block' : nodeTemplate ? 'node-template' : 'estimate'
      }
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
        {((nodeTemplate && (templateRepresentation?.groupedCount ?? 0) > 0) || collectiveBlock) && (
          <pattern id={templatePatternId} width="10" height="13" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="4" r="2.8" fill="#c9bda1" />
            <path d="M1 12v-2.5Q1 7 5 7t4 2.5V12Z" fill="#92b5a0" />
          </pattern>
        )}
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
      {nodeTemplate && (templateRepresentation?.groupedCount ?? 0) > 0 && (
        <g
          className="street-template-group"
          role="group"
          aria-label={t(
            `${number(templateRepresentation!.groupedCount)} transactions proposées représentées collectivement, sans identifiants ni frais individuels dessinés. Les ${number(templateRepresentation!.individualCount)} membres individualisés sont exclus de ce groupe, y compris ceux encore sur le quai. Aucune confirmation n’est déduite de ce groupe.`,
            `${number(templateRepresentation!.groupedCount)} proposed transactions represented collectively, without drawn individual identifiers or fees. The ${number(templateRepresentation!.individualCount)} individual members are excluded from this group, including those still on the platform. No confirmation is inferred from this group.`,
          )}
          data-template-group-count={templateRepresentation!.groupedCount}
          data-template-individual-count={templateRepresentation!.individualCount}
          pointerEvents="none"
        >
          <rect
            x={WAGON_X + 13}
            y={y + 46}
            width="58"
            height="140"
            rx="7"
            fill={`url(#${templatePatternId})`}
            opacity=".55"
            aria-hidden="true"
          />
          <ReadableText
            mirrored={mirrored}
            x={WAGON_X + WAGON_WIDTH / 2}
            y={y + 43}
            fill="#e0e4c9"
            fontSize="6.5"
            fontWeight="700"
            textAnchor="middle"
            aria-hidden="true"
          >
            +{number(templateRepresentation!.groupedCount)} {t('groupées', 'grouped')}
          </ReadableText>
        </g>
      )}
      {collectiveBlock && (
        <g
          className="street-block-group"
          role="group"
          aria-label={t(
            `${number(collectiveBlock.groupedCount)} transactions du bloc reçu représentées collectivement, sans identifiants ni détails individuels inventés. Le bloc compte ${number(collectiveBlock.transactionCount)} transactions${chain === 'bitcoin' ? ' hors coinbase' : ''} ; ${number(collectiveBlock.individualCount)} sont individualisées dans toute la scène, quai et arrivées compris. Ce groupe n’ajoute aucune option au navigateur de transactions.`,
            `${number(collectiveBlock.groupedCount)} transactions in the received block represented collectively, without invented identifiers or individual details. The block contains ${number(collectiveBlock.transactionCount)} transactions${chain === 'bitcoin' ? ' excluding coinbase' : ''}; ${number(collectiveBlock.individualCount)} are individual passengers throughout the scene, including the platform and arrivals. This group adds no options to the transaction browser.`,
          )}
          data-block-group-count={collectiveBlock.groupedCount}
          data-block-individual-count={collectiveBlock.individualCount}
          data-block-transaction-count={collectiveBlock.transactionCount}
          pointerEvents="none"
        >
          <rect
            x={WAGON_X + 13}
            y={y + 46}
            width="58"
            height="140"
            rx="7"
            fill={`url(#${templatePatternId})`}
            opacity=".55"
            aria-hidden="true"
          />
          <ReadableText
            mirrored={mirrored}
            x={WAGON_X + WAGON_WIDTH / 2}
            y={y + 43}
            fill="#e0e4c9"
            fontSize="6.5"
            fontWeight="700"
            textAnchor="middle"
            aria-hidden="true"
          >
            +{number(collectiveBlock.groupedCount)} {t('collectives', 'collective')}
          </ReadableText>
        </g>
      )}
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

const HistoricalQueueBackdrop = memo(function HistoricalQueueBackdrop({
  count,
  projectX,
  mirrored,
  narrow,
}: {
  count: number;
  projectX: (x: number) => number;
  mirrored: boolean;
  narrow: boolean;
}) {
  const { t, number } = useSceneText();
  const start = projectX(HISTORICAL_QUEUE_AREA.x - 8);
  const end = projectX(HISTORICAL_QUEUE_AREA.x + HISTORICAL_QUEUE_AREA.width + 8);
  const center = (start + end) / 2;
  return (
    <g
      role="group"
      aria-label={t(
        `Zone historique : ${number(count)} voyageurs sur le quai. Présence actuelle inconnue, absence du relevé ou candidature remplacée ; aucune confirmation implicite.`,
        `Historical area: ${number(count)} passengers on the platform. Current presence unknown, absent from the inventory or replaced candidate; no implied confirmation.`,
      )}
      data-history-area="true"
      data-history-count={count}
    >
      <title>
        {t(
          'Observations conservées : ces voyageurs restent consultables. Une présence retrouvée les ramène vers la file active ; seule une inclusion vérifiée les fait partir avec un bloc.',
          'Retained observations: these passengers remain accessible. Observed presence brings them back to the active queue; only verified inclusion sends them away with a block.',
        )}
      </title>
      <rect
        x={start}
        y="528"
        width={end - start}
        height="124"
        rx="8"
        fill="#5b6650"
        fillOpacity=".75"
        stroke="#c5c5a0"
        strokeOpacity=".65"
        strokeDasharray="4 4"
      />
      <g aria-hidden="true">
        <ReadableText
          mirrored={mirrored}
          x={center}
          y="504"
          textAnchor="middle"
          fill="#eee3be"
          fontSize={narrow ? 7.5 : 10}
          letterSpacing=".4"
        >
          {t('OBSERVATIONS', 'OBSERVATIONS')}
        </ReadableText>
        <ReadableText
          mirrored={mirrored}
          x={center}
          y="518"
          textAnchor="middle"
          fill="#e3d8b4"
          fontSize={narrow ? 7 : 9}
        >
          {number(count)} {t(count === 1 ? 'conservée' : 'conservées', 'retained')}
        </ReadableText>
      </g>
    </g>
  );
});

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
  const { t, number } = useSceneText();
  if (count === 0) return null;
  const label = (count >= MAX_WAITING_ARCHIVE_COUNT ? '≥ ' : '') + number(count);
  const center = projectX(WAITING_ARCHIVE_POSITION.x);
  return (
    <g
      role="img"
      aria-label={t(
        `${label} observations anciennes regroupées sur le quai. ${number(tracked)} identifiants conservés pour retrouver leurs inclusions, ${number(unknown)} observations sans suivi individuel. Un regroupement ne signifie pas une attente actuelle sur le réseau.`,
        `${label} historical observations grouped on the platform. ${number(tracked)} identifiers retained to recover their inclusions, ${number(unknown)} observations without individual tracking. Grouping does not mean current waiting on the network.`,
      )}
      data-waiting-archive-count={count}
    >
      <title>
        {t(
          `${label} observations regroupées : ${number(tracked)} identifiants conservés, ${number(unknown)} sans suivi. Le suivi est borné à 512 identifiants et 30 minutes ; une confirmation vérifiée peut retrouver son voyageur.`,
          `${label} grouped observations: ${number(tracked)} retained identifiers, ${number(unknown)} without tracking. Tracking is limited to 512 identifiers and 30 minutes; verified confirmation can recover its passenger.`,
        )}
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
          {t('Observations', 'Observations')}
        </ReadableText>
        <ReadableText
          mirrored={mirrored}
          x={center + 24}
          y="680"
          textAnchor="middle"
          fill="#d3dec0"
          fontSize="9"
        >
          {t('Suivies', 'Tracked')} : {number(tracked)}
        </ReadableText>
        <ReadableText
          mirrored={mirrored}
          x={center + 24}
          y="696"
          textAnchor="middle"
          fill="#d3dec0"
          fontSize="8"
        >
          {t('Sans suivi', 'Untracked')} : {number(unknown)}
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
  const { t } = useSceneText();
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
        d={`M${projectX(ARRIVAL_LANE_X)} 200v432`}
        stroke="#90ad8e"
        strokeWidth="2"
        strokeDasharray="4 11"
        opacity=".35"
      />
      <ReadableText
        mirrored={mirrored}
        x={CORRIDOR_X}
        y="155"
        textAnchor="middle"
        fill="#c8d8b5"
        fontSize={narrow ? 8 : 10}
        letterSpacing=".6"
      >
        {t('PASSAGE', 'WALKWAY')}
      </ReadableText>
      <ReadableText
        mirrored={mirrored}
        x={(fileStart + fileEnd) / 2}
        y="155"
        textAnchor="middle"
        fill="#e0e6c7"
        fontSize={narrow ? 11 : 13}
        letterSpacing="1"
      >
        {t('FILE', 'QUEUE')}
      </ReadableText>
      {!narrow && (
        <ReadableText
          mirrored={mirrored}
          x={(fileStart + fileEnd) / 2}
          y="168"
          textAnchor="middle"
          fill="#a6bea0"
          fontSize="9"
        >
          {t('ORDRE D’ARRIVÉE', 'ARRIVAL ORDER')}
        </ReadableText>
      )}
      <ReadableText
        mirrored={mirrored}
        x={(arrivalStart + viewEnd) / 2}
        y="172"
        textAnchor="middle"
        fill="#d3dec0"
        fontSize={narrow ? 7.5 : 11}
      >
        {narrow ? t('ENTRÉE', 'ENTRY') : t('ARRIVÉES', 'ARRIVALS')}
      </ReadableText>
    </g>
  );
});

export const StreetScene = memo(function StreetScene({
  snapshot,
  browseTarget,
  paused,
  speed,
  reducedMotion,
  onSelect,
  selectedId,
  selectedFallback,
  onClearSelection,
  onCloseInfo,
  showInfo = true,
  feeDisplayUnit = 'native',
  onDeparture,
  onActivity,
  mirrored = false,
}: StreetSceneProps) {
  const { locale, t, number } = useSceneText();
  const id = useId().replace(/:/g, '');
  const nodeTemplate = activeBitcoinBlockTemplate(snapshot);
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
  const queueLayout = useMemo(() => createQueueLayout(projectionScale), [projectionScale]);
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
        trail: pose.trail?.map((point) => ({ x: projectX(point.x), y: point.y })),
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
    queueLayout,
  });
  const selectedSource = useMemo(() => {
    if (!selectedId) return { current: undefined, inclusion: undefined };
    const current = snapshot.transactions.find((tx) => tx.id === selectedId);
    const inclusion = snapshot.inclusions?.find((entry) =>
      entry.transactionIds.some((id) => id.toLowerCase() === selectedId.toLowerCase()),
    );
    return { current, inclusion };
  }, [selectedId, snapshot.transactions, snapshot.inclusions]);
  const selectedResident = selectedId
    ? motion.passengers.find((pose) => pose.tx.id === selectedId)
    : undefined;
  const selectedKnown =
    selectedResident?.tx ??
    (selectedFallback &&
    selectedFallback.id === selectedId &&
    selectedFallback.chain === snapshot.chain
      ? selectedFallback
      : undefined);
  const selectedTransaction = useMemo(
    () =>
      selectedSource.current ??
      (selectedKnown && selectedSource.inclusion
        ? {
            ...selectedKnown,
            status: 'confirmed' as const,
            blockHash: selectedSource.inclusion.block.hash,
          }
        : (selectedKnown ?? null)),
    [selectedKnown, selectedSource],
  );
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
    : t('BLOC REÇU', 'BLOCK RECEIVED');
  const projectionUsed = motion.projectionUsed ?? { next: motion.candidateUsed ?? 0, later: 0 };
  const completeCandidate = !moving && !preparing ? nodeTemplate : null;
  const blockRepresentation = useMemo(
    () =>
      (moving || preparing) && !motion.departureRecovered && motion.departingBlock
        ? confirmedBlockRemainder(
            snapshot.chain,
            motion.departingBlock,
            [...motion.passengers, ...(motion.departingPassengers ?? [])].map((pose) => pose.tx),
          )
        : null,
    [
      moving,
      preparing,
      motion.departingBlock,
      motion.departureRecovered,
      motion.passengers,
      motion.departingPassengers,
      snapshot.chain,
    ],
  );
  const candidateRepresentation = useMemo(
    () =>
      completeCandidate
        ? bitcoinCandidateRepresentation(
            completeCandidate,
            motion.passengers.map((pose) => pose.tx),
          )
        : null,
    [completeCandidate, motion.passengers],
  );
  const nextCapacity = nodeTemplate
    ? Math.min(
        motion.candidateCapacity ?? nodeTemplate.weightLimit / 4,
        nodeTemplate.weightLimit / 4,
      )
    : motion.candidateCapacity;
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
          ? `${tx.chain === 'ethereum' ? t('estimation avec limite de gas', 'estimate using gas limit') : t('frais estimés', 'estimated fees')} : ${formatTransactionFee(tx, 'usd', currentQuote, locale)} ; ${t('taux observé', 'observed rate')} ${formatFeeRate(tx.chain, tx.feeRate, 'native', null, locale)}`
          : formatTransactionFee(tx, 'native', null, locale);
      labels.set(tx, label);
      return label;
    };
  }, [feeDisplayUnit, quote, quoteUsable, locale, t]);
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
  const boardedCount = motion.passengers.filter((pose) => pose.inWagon).length;
  const historicalQuayCount = motion.passengers.filter(
    (pose) => !pose.inWagon && isHistoricalPassenger(pose),
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
      observed: motion.passengers.filter(
        (pose) => pose.tx.status === 'pending' && !isHistoricalPassenger(pose),
      ).length,
      historical:
        motion.passengers.filter(
          (pose) => pose.tx.status === 'pending' && isHistoricalPassenger(pose),
        ).length + (motion.waitingArchiveCount ?? 0),
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
      motion.passengers,
      motion.waitingArchiveCount,
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
            data-queue-columns={queueLayout.columns}
            data-queue-rows={queueLayout.rows}
            data-queue-capacity={queueLayout.capacity}
            viewBox={`${VIEW_START_X} 0 ${viewWidth} ${SCENE_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            data-mirrored={mirrored}
            role="group"
            aria-labelledby={`${id}-title ${id}-desc`}
          >
            <title id={`${id}-title`}>
              {t(
                `La rue de ${snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
                `${snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'} street`,
              )}
            </title>
            <desc id={`${id}-desc`}>
              {nodeTemplate
                ? t(
                    'Le premier wagon représente le candidat complet proposé par le nœud Bitcoin pour le compte et le poids, avec des détails individuels limités et les autres membres regroupés. Le second reste une estimation. Ce candidat ne prouve aucune inclusion ni qu’un pool minier le mine.',
                    'The first vehicle represents the complete candidate proposed by the Bitcoin node for count and weight, with limited individual details and other members grouped. The second remains an estimate. This candidate proves neither inclusion nor that a mining pool is mining it.',
                  )
                : t(
                    'Les deux wagons à l’arrêt projettent les prochains blocs.',
                    'The two stationary vehicles project the next blocks.',
                  )}{' '}
              {t(
                `À réception d’un bloc réel, le premier est ajusté aux inclusions connues avant son départ, le second prend sa place. Les voyageurs arrivent depuis le bord ${mirrored ? 'gauche' : 'droit'} et circulent sur le quai extérieur. Les portes restent fermées pendant les déplacements. Le déplacement ne confirme aucune transaction. La file active et les observations historiques conservées en bas du quai occupent des zones distinctes. La boîte « Reste du réseau — hors échantillon » représente une source collective sans total mondial ; seules des inclusions identifiées peuvent en sortir comme voyageurs individuels. Une observation historique ne prouve aucune confirmation.`,
                `When a real block is received, the first vehicle is adjusted to known inclusions before departure, and the second takes its place. Passengers arrive from the ${mirrored ? 'left' : 'right'} edge and walk on the outer platform. Doors stay closed while vehicles move. Movement does not confirm any transaction. The active queue and historical observations retained at the bottom of the platform occupy separate areas. The Rest of the network — outside the sample gateway represents a collective source without a worldwide total; only identified inclusions can leave it as individual passengers. A historical observation does not prove confirmation.`,
              )}{' '}
              {demo
                ? t('Données simulées.', 'Simulated data.')
                : t(
                    'Les inclusions sont fournies par la source.',
                    'Inclusions are supplied by the source.',
                  )}{' '}
              {t(
                'Cliquez sur un voyageur ou utilisez « Parcourir les transactions » au clavier.',
                'Click a passenger or use Browse transactions with the keyboard.',
              )}
            </desc>
            <g
              transform={
                mirrored ? `translate(${2 * VIEW_START_X + viewWidth} 0) scale(-1 1)` : undefined
              }
            >
              <PlatformBackdrop viewWidth={viewWidth} projectX={projectX} mirrored={mirrored} />
              <NetworkRemainder
                chain={snapshot.chain}
                projectX={projectX}
                mirrored={mirrored}
                doorProgress={motion.networkDoorProgress}
                active={motion.networkActive}
              />
              <ProviderFlowArrivals
                snapshot={snapshot}
                projectX={projectX}
                mirrored={mirrored}
                paused={paused || snapshot.status !== 'ok'}
                reducedMotion={reducedMotion}
              />
              <HistoricalQueueBackdrop
                count={historicalQuayCount}
                projectX={projectX}
                mirrored={mirrored}
                narrow={viewWidth < 360}
              />
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
                  {demo
                    ? t('SIMULATION', 'SIMULATION')
                    : completeCandidate
                      ? t('CANDIDAT COMPLET · DÉTAILS LIMITÉS', 'FULL CANDIDATE · LIMITED DETAILS')
                      : t('ÉCHANTILLON OBSERVÉ', 'OBSERVED SAMPLE')}
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
                    ? t(
                        `Embarquement · ${number(motion.preparationPassengerCount)}`,
                        `Boarding · ${number(motion.preparationPassengerCount)}`,
                      )
                    : `${snapshot.chain === 'bitcoin' ? 'vB' : 'gas'} · ${t('P', 'N')} ${occupancyPercentLabel(blockUsagePercent(completeCandidate ? completeCandidate.weight / 4 : projectionUsed.next, nextCapacity), !completeCandidate, locale)} · ${t('S', 'L')} ${occupancyPercentLabel(blockUsagePercent(projectionUsed.later, motion.candidateCapacity), true, locale)}`}
                  <title>
                    {completeCandidate
                      ? t(
                          'Candidat complet proposé hors coinbase : prochain ',
                          'Complete proposed candidate excluding coinbase: next ',
                        )
                      : t(
                          'Réservations des projections dans l’échantillon : prochain ',
                          'Projection reservations in the sample: next ',
                        )}
                    {number(
                      completeCandidate ? completeCandidate.weight / 4 : projectionUsed.next,
                      2,
                    )}
                    {' / '}
                    {number(nextCapacity)} {snapshot.chain === 'bitcoin' ? 'vB' : 'gas'}
                    {t(' ; suivant ', '; later ')}
                    {number(projectionUsed.later, 2)}
                    {' / '}
                    {number(motion.candidateCapacity)} {snapshot.chain === 'bitcoin' ? 'vB' : 'gas'}
                    .
                    {snapshot.chain === 'ethereum' &&
                      t(
                        ' Limites de gas déclarées, estimation prudente.',
                        ' Declared gas limits, conservative estimate.',
                      )}
                  </title>
                </ReadableText>
              </g>
              <Wagon
                kind="next"
                y={NEXT_WAGON_Y}
                label={
                  moving || preparing
                    ? blockLabel
                    : nodeTemplate
                      ? t('CANDIDAT', 'CANDIDATE')
                      : t('PROCHAIN', 'NEXT')
                }
                caption={
                  moving
                    ? `${demo ? t('BLOC SIMULÉ', 'SIMULATED BLOCK') : motion.departureRecovered ? t('INCLUSIONS RETROUVÉES', 'RECOVERED INCLUSIONS') : t('BLOC CONFIRMÉ', 'CONFIRMED BLOCK')} · ${t('DÉPART', 'DEPARTURE')}`
                    : preparing
                      ? motion.departureRecovered
                        ? t('INCLUSIONS RETROUVÉES · RATTRAPAGE', 'RECOVERED INCLUSIONS · CATCH-UP')
                        : t('BLOC REÇU · AJUSTEMENT', 'BLOCK RECEIVED · ADJUSTMENT')
                      : nodeTemplate
                        ? t(
                            `CANDIDAT DU NŒUD · #${number(nodeTemplate.height)}`,
                            `NODE CANDIDATE · #${number(nodeTemplate.height)}`,
                          )
                        : t('PROCHAIN BLOC · ESTIMATION', 'NEXT BLOCK · ESTIMATE')
                }
                passengers={moving ? (motion.departingPassengers ?? []) : next}
                chain={snapshot.chain}
                capacity={nextCapacity}
                confirmedBlock={moving || preparing ? motion.departingBlock : undefined}
                nodeTemplate={completeCandidate}
                templateRepresentation={candidateRepresentation}
                blockRepresentation={blockRepresentation}
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
                label={
                  moving
                    ? t('PROCHAIN', 'NEXT')
                    : arriving
                      ? t('ARRIVÉE', 'ARRIVING')
                      : t('SUIVANT', 'LATER')
                }
                caption={
                  moving
                    ? t('PROCHAIN BLOC · ESTIMATION', 'NEXT BLOCK · ESTIMATE')
                    : t('BLOC SUIVANT · ESTIMATION', 'LATER BLOCK · ESTIMATE')
                }
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
            browseTarget={browseTarget}
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
          selectedTx={selectedTransaction}
          selectedHistorical={
            selectedTransaction !== null &&
            selectedSource.current === undefined &&
            selectedSource.inclusion === undefined
          }
          selectedInclusionOnly={
            selectedSource.current === undefined && selectedSource.inclusion !== undefined
          }
          selectedObservedAt={selectedResident?.lastObservedAt}
          selectedPoolState={selectedResident?.poolState}
          selectedPoolObservedAt={selectedResident?.poolObservedAt}
          selectedReasonLabel={
            selectedResident ? passengerPlanningReason(selectedResident, locale) : undefined
          }
          activity={activity}
          paused={paused || snapshot.status !== 'ok'}
          reducedMotion={reducedMotion}
          onClearSelection={onClearSelection}
          onClose={onCloseInfo}
        />
      )}
    </div>
  );
});
