import {
  MAX_INCLUSION_BLOCKS,
  MAX_INDIVIDUAL_HISTORY,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  type BitcoinBlockTemplate,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  arrivalStart,
  boardingApproach,
  entryDoorPoint,
  exitDoorPoint,
  exitPlatformPoint,
  isInsideDoorway,
  DEFAULT_QUEUE_LAYOUT,
  PLATFORM_CORRIDOR_X,
  WAGON_SEAT_COUNT,
  queuePosition,
  historicalQueueLayout,
  historicalQueuePosition,
  networkBoxArrivalPath,
  networkBoxBoardingPath,
  NETWORK_BOX_RECT,
  NETWORK_FLOW_LANES,
  wagonSeat,
  type QueueLayout,
  type PassengerQueueZone,
  type StreetPoint,
  type WagonKind,
} from './streetGeometry';
import { capacityForSnapshot, transactionBlockSize } from './blockCapacity';
import {
  bitcoinArrivalObservation,
  isHistoricalPassenger,
  type BitcoinArrivalObservation,
} from './passengerStatus';
import {
  ethereumNonceDependencies,
  ethereumPredecessorId,
  type EthereumNonceDependency,
  type EthereumNonceObservation,
  type EthereumNoncePlanningContext,
} from './ethereumNonceDependencies';

export const MAX_PASSENGERS = PENDING_SAMPLE_LIMIT;
export const MAX_RESIDENT_PASSENGERS = MAX_PASSENGERS + MAX_INDIVIDUAL_HISTORY;
export const MAX_ARCHIVED_OBSERVATIONS = 512;
const MAX_DEPARTURE_PASSENGERS =
  MAX_RESIDENT_PASSENGERS + MAX_ARCHIVED_OBSERVATIONS + MAX_PASSENGERS;
export const MAX_WAITING_ARCHIVE_COUNT = 1_000_000;
export const WAITING_ARCHIVE_POSITION: StreetPoint = { x: 360, y: 686 };
/** @deprecated Geometric places only; native block capacity comes from the snapshot. */
export const CANDIDATE_CAPACITY = WAGON_SEAT_COUNT;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 1_200;
export const BITCOIN_PREPARATION_DURATION_MS = 3_000;
export const ETHEREUM_PREPARATION_DURATION_MS = 1_500;
/** Existing callers use this as Ethereum's preparation duration. */
export const PREPARATION_DURATION_MS = ETHEREUM_PREPARATION_DURATION_MS;
const NETWORK_TIMING_REFERENCE_MS = 1_000;
const MAX_NETWORK_COHORT_STAGGER_MS = 480;
const NETWORK_COHORT_SPACING_MS = 36;
export const NETWORK_DOOR_OPEN_MS = 80;
export const NETWORK_SIGNAL_LEAD_MS = 120;
export const NETWORK_DOOR_BEFORE_PASSAGE_MS = 200;
export const NETWORK_DOOR_AFTER_PASSAGE_MS = 150;
const NETWORK_DOOR_CLOSE_MS = 80;
const FAST_EXIT_DURATION_MS = 500;
const MIN_PREPARATION_PASSAGE_MS = 50;
const MAX_ARRIVAL_STAGGER_MS = 1_500;
export const CANDIDATE_ARRIVAL_DURATION_MS = 700;
export const MIN_HEAD_SCALE = 0.8;
export const MAX_HEAD_SCALE = 2.5;
const GEOMETRY_VERSION = 'outer-platform-history-queue-v20';

export function preparationDurationMs(chain: ChainId): number {
  return chain === 'bitcoin' ? BITCOIN_PREPARATION_DURATION_MS : ETHEREUM_PREPARATION_DURATION_MS;
}

function statePreparationDurationMs(state: Pick<PassengerMotionState, 'context'>): number {
  return preparationDurationMs(state.context.startsWith('bitcoin:') ? 'bitcoin' : 'ethereum');
}

export type PassengerPhase =
  | 'arriving'
  | 'queue'
  | 'reordering'
  | 'parked'
  | 'walking'
  | 'boarding'
  | 'preparing'
  | 'boarded'
  | 'exiting'
  | 'returning'
  | 'retiring'
  | 'confirmed';
export type PassengerDestination = WagonKind | 'queue';
export type PassengerReason =
  | 'accepted'
  | 'fee'
  | 'capacity'
  | 'observed'
  | 'nonce'
  | 'queued'
  | 'absent'
  | 'replaced'
  | 'projection';
export type PassengerPoolState = 'pending' | 'queued' | 'absent' | 'replaced' | 'unknown';
export type PassengerArrivalKind = 'initial-stock' | 'new-observation' | 'late-inclusion';
interface PoolPassengerObservation {
  poolState: PassengerPoolState;
  poolObservedAt?: number;
  bitcoinArrival?: BitcoinArrivalObservation;
  detailObservedAt?: number;
  /** A dated exclusion stays a planning constraint after its public freshness expires. */
  poolExcludedAt?: number;
  poolExcludedState?: 'queued' | 'absent' | 'replaced';
}

interface Passenger {
  tx: Tx;
  nonceDependency?: EthereumNonceDependency;
  arrivalKind?: PassengerArrivalKind;
  lastObservedAt?: number;
  poolState?: PassengerPoolState;
  poolObservedAt?: number;
  bitcoinArrival?: BitcoinArrivalObservation;
  poolExcludedAt?: number;
  poolExcludedState?: 'queued' | 'absent' | 'replaced';
  queueIndex: number;
  queueZone?: PassengerQueueZone;
  queuePoint?: StreetPoint;
  queueReserved?: boolean;
  seatIndex: number;
  plannedSeatIndex: number;
  plannedWagon: WagonKind | null;
  selectedForCandidate: boolean;
  reason: PassengerReason;
  phase: PassengerPhase;
  phaseStartedAt: number;
  durationMs: number;
  retryAt: number;
  path: StreetPoint[];
  wagon: WagonKind | null;
  inHandoff: boolean;
  handoffPhase?: PassengerPhase;
  joiningArchive?: boolean;
  presentInSample: boolean;
  /** A real illustrated boarding, retained across temporary exits without refreshing provenance. */
  hasBoardedProjection?: boolean;
  /** Only source-confirmed transactions associated with this departing block may leave aboard. */
  departureIncluded?: boolean;
  awaitingVerifiedDeparture?: boolean;
  /** Opening time is part of the same preparation deadline, not an independent timer. */
  networkDoorLeadMs?: number;
}

interface PassengerAdmission {
  tx: Tx;
  arrivalKind?: PassengerArrivalKind;
  nonceDependency?: EthereumNonceDependency;
  plannedSeatIndex: number;
  plannedWagon: WagonKind | null;
  selectedForCandidate: boolean;
  reason: PassengerReason;
}

interface DepartureObservation {
  block: Block;
  transactions: Tx[];
  /** Origins captured before reconciliation can consume an existing admission. */
  networkOriginIds?: string[];
  recovered?: boolean;
}

interface ArchivedObservation {
  tx: Tx;
  nonceDependency?: EthereumNonceDependency;
  lastSeenAt: number;
  reservedBlockHash?: string;
}

interface DepartureReceipt {
  hash: string;
  height: number;
  transactionIds: string[];
}

interface WaitingArchiveState {
  waitingArchiveTransactions: Map<string, ArchivedObservation>;
  waitingArchiveUnknownCount: number;
  archiveObservedAt: number;
}

export interface PassengerMotionState {
  context: string;
  queueLayout: QueueLayout;
  elapsedMs: number;
  observedBlockHash: string | null;
  observedBlockHeight: number | null;
  initialBlockHeight: number | null;
  preparationStartedAt: number | null;
  handoffStartedAt: number | null;
  /** Persistent animation-clock marker for the last vehicle departure, not a block timestamp. */
  lastDepartureStartedAt: number | null;
  candidateArrivalStartedAt: number | null;
  departingBlock: Block | null;
  departureRecovered: boolean;
  preparationTransactions: Tx[];
  queuedDeparture: DepartureObservation | null;
  queuedDepartures: DepartureObservation[];
  handledDepartures: DepartureReceipt[];
  feeThreshold: number | null;
  candidateCount: number;
  candidateUsed: number;
  /** Native block resource budget; null when the observed provider has no capacity. */
  candidateCapacity: number | null;
  /** A proposed Bitcoin candidate constrains only projections, never real departures. */
  blockTemplate: BitcoinBlockTemplate | null;
  ethereumProjection: Snapshot['ethereumProjection'];
  ethereumDependencies?: Snapshot['ethereumDependencies'];
  projectionCount: Record<WagonKind, number>;
  projectionUsed: Record<WagonKind, number>;
  passengers: Passenger[];
  pendingAdmissions: PassengerAdmission[];
  waitingArchiveCount: number;
  waitingArchiveTransactions: Map<string, ArchivedObservation>;
  waitingArchiveUnknownCount: number;
  archiveObservedAt: number;
  departingPassengers: PassengerPose[];
}

export interface PassengerPose {
  tx: Tx;
  nonceDependency?: EthereumNonceDependency;
  arrivalKind?: PassengerArrivalKind;
  lastObservedAt?: number;
  poolState?: PassengerPoolState;
  poolObservedAt?: number;
  bitcoinArrival?: BitcoinArrivalObservation;
  x: number;
  y: number;
  queueX: number;
  queueY: number;
  queueZone?: PassengerQueueZone;
  phase: PassengerPhase;
  destination: PassengerDestination;
  reason: PassengerReason;
  selectedForCandidate: boolean;
  inWagon: boolean;
  wagon: WagonKind | null;
  inHandoff: boolean;
  sourceObserved: boolean;
  headScale: number;
  resourceUnits: number;
  opacity: number;
  progress: number;
  facing: 1 | -1;
  movementAngle?: number;
  /** A bounded suffix of the current network exit, ordered towards the traveller. */
  trail?: readonly StreetPoint[];
  walkPhase: number;
}

export interface PassengerFrame {
  passengers: PassengerPose[];
  departingPassengers: PassengerPose[];
  departingBlock: Block | null;
  departureRecovered: boolean;
  lastDepartureStartedAt: number | null;
  counts: Record<PassengerPhase, number>;
  candidateCount: number;
  candidateUsed: number;
  candidateCapacity: number | null;
  projectionCount: Record<WagonKind, number>;
  projectionUsed: Record<WagonKind, number>;
  feeThreshold: number | null;
  elapsedMs: number;
  preparationProgress: number | null;
  preparationPassengerCount: number;
  /** Shared animation-clock opening, including while a traveller waits in the doorway. */
  networkDoorProgress: number;
  /** True only during an actual departure through this network doorway. */
  networkActive: boolean;
  waitingArchiveCount: number;
  waitingArchiveTrackedCount: number;
  waitingArchiveUnknownCount: number;
  handoffProgress: number | null;
  laterArrivalProgress: number | null;
  /** Alias retained for the shared animation hook's existing callers. */
  candidateArrivalProgress: number | null;
  doors: Record<WagonKind, { entry: boolean; exit: boolean }>;
}

export interface PassengerClockOptions {
  paused?: boolean;
  hidden?: boolean;
  reducedMotion?: boolean;
  speed?: number;
}

interface PathSegment {
  from: StreetPoint;
  to: StreetPoint;
  length: number;
  heading: number;
}

interface PathGeometry {
  segments: PathSegment[];
  lengths: number[];
  distance: number;
}

interface ProjectionOccupancy {
  projectionCount: Record<WagonKind, number>;
  projectionUsed: Record<WagonKind, number>;
  candidateCount: number;
  candidateUsed: number;
}

interface PreparationInclusion {
  tx: Tx;
  index: number;
}

// Paths and transactions are immutable within the engine. Weak keys release their
// measurements with the corresponding scene instead of retaining transaction IDs.
const pathGeometryCache = new WeakMap<StreetPoint[], PathGeometry>();
const transactionAppearanceCache = new WeakMap<
  Tx,
  { hash: number; headScale: number; resourceUnits: number }
>();
const passengerPoseCache = new WeakMap<Passenger, { elapsedMs: number; pose: PassengerPose }>();
const passengerCollectionPoseCache = new WeakMap<Passenger[], PassengerPose[]>();
const projectionOccupancyCache = new WeakMap<Passenger[], ProjectionOccupancy>();
// Cohorts and resident arrays are replaced rather than mutated. Cached ID sets
// are read-only here; admission takes its own writable copy before adding IDs.
const preparationInclusionCache = new WeakMap<Tx[], Map<string, PreparationInclusion>>();
const residentIdCache = new WeakMap<Passenger[], Set<string>>();
const departingIdCache = new WeakMap<PassengerPose[], Set<string>>();
// A fixed queue can reuse its reservations while poses advance on the shared clock.
// Admission may append to a fresh aligned array, so its length is checked as well.
const alignedQueueCache = new WeakMap<
  Passenger[],
  { layout: QueueLayout; passengerCount: number }
>();
const WALKING_PHASES = new Set<PassengerPhase>([
  'arriving',
  'reordering',
  'walking',
  'boarding',
  'preparing',
  'exiting',
  'returning',
  'retiring',
]);
const FALLBACK_PATH_START: StreetPoint = { x: PLATFORM_CORRIDOR_X, y: 118 };

function pathGeometry(path: StreetPoint[]): PathGeometry {
  const cached = pathGeometryCache.get(path);
  if (cached) return cached;
  const segments: PathSegment[] = [];
  const lengths: number[] = [];
  let distance = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    distance += length;
    segments.push({ from, to, length, heading: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  const geometry = { segments, lengths, distance };
  pathGeometryCache.set(path, geometry);
  return geometry;
}

function transactionAppearance(tx: Tx) {
  const cached = transactionAppearanceCache.get(tx);
  if (cached) return cached;
  const appearance = {
    hash: stableHash(tx.id),
    headScale: transactionHeadScale(tx),
    resourceUnits: transactionResourceUnits(tx),
  };
  transactionAppearanceCache.set(tx, appearance);
  return appearance;
}

/** Keep an unchanged collection and its passengers reusable by the scene renderer. */
function mapPassengers(
  passengers: Passenger[],
  update: (passenger: Passenger) => Passenger,
): Passenger[] {
  let changed: Passenger[] | null = null;
  for (let index = 0; index < passengers.length; index += 1) {
    const passenger = passengers[index]!;
    const next = update(passenger);
    if (changed) changed.push(next);
    else if (next !== passenger) {
      changed = passengers.slice(0, index);
      changed.push(next);
    }
  }
  return changed ?? passengers;
}

function preparationInclusions(transactions: Tx[]): Map<string, PreparationInclusion> {
  const cached = preparationInclusionCache.get(transactions);
  if (cached) return cached;
  const inclusions = new Map<string, PreparationInclusion>();
  for (const [index, tx] of transactions.entries()) inclusions.set(tx.id, { tx, index });
  preparationInclusionCache.set(transactions, inclusions);
  return inclusions;
}

function residentTransactionIds(passengers: Passenger[]): Set<string> {
  const cached = residentIdCache.get(passengers);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const passenger of passengers) ids.add(passenger.tx.id);
  residentIdCache.set(passengers, ids);
  return ids;
}

function departingTransactionIds(passengers: PassengerPose[]): Set<string> {
  const cached = departingIdCache.get(passengers);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const passenger of passengers) ids.add(passenger.tx.id);
  departingIdCache.set(passengers, ids);
  return ids;
}

function motionContext(snapshot: Snapshot): string {
  return `${snapshot.chain}:${snapshot.mode}:${GEOMETRY_VERSION}`;
}

const canonicalSnapshotCache = new WeakMap<Snapshot, Snapshot>();
const canonicalHash = (value: string): string =>
  /^(?:0x)?[a-fA-F0-9]{64}$/i.test(value) ? value.toLowerCase() : value;

/** Hash casing cannot create a second traveller or disconnect exact block evidence. */
function canonicalSnapshot(snapshot: Snapshot): Snapshot {
  const cached = canonicalSnapshotCache.get(snapshot);
  if (cached) return cached;
  let changed = false;
  const transactions = snapshot.transactions.map((tx) => {
    const id = canonicalHash(tx.id);
    const blockHash = tx.blockHash === undefined ? undefined : canonicalHash(tx.blockHash);
    if (id === tx.id && blockHash === tx.blockHash) return tx;
    changed = true;
    return { ...tx, id, ...(blockHash === undefined ? {} : { blockHash }) };
  });
  const normalizeBlock = (block: Block): Block => {
    const hash = canonicalHash(block.hash);
    if (hash === block.hash) return block;
    changed = true;
    return { ...block, hash };
  };
  const blocks = snapshot.blocks.map(normalizeBlock);
  const inclusions = snapshot.inclusions?.map((inclusion) => {
    const block = normalizeBlock(inclusion.block);
    const transactionIds = inclusion.transactionIds.map(canonicalHash);
    if (
      block === inclusion.block &&
      transactionIds.every((id, index) => id === inclusion.transactionIds[index])
    )
      return inclusion;
    changed = true;
    return { block, transactionIds };
  });
  let blockTemplate = snapshot.blockTemplate;
  if (blockTemplate) {
    const previousBlockHash = canonicalHash(blockTemplate.previousBlockHash);
    const selectedTransactionIds = blockTemplate.selectedTransactionIds.map(canonicalHash);
    if (
      previousBlockHash !== blockTemplate.previousBlockHash ||
      selectedTransactionIds.some(
        (id, index) => id !== blockTemplate!.selectedTransactionIds[index],
      )
    ) {
      changed = true;
      blockTemplate = { ...blockTemplate, previousBlockHash, selectedTransactionIds };
    }
  }
  let poolObservation = snapshot.poolObservation;
  if (poolObservation) {
    const presentTransactionIds = poolObservation.presentTransactionIds.map(canonicalHash);
    const queuedTransactionIds = poolObservation.queuedTransactionIds.map(canonicalHash);
    const absentTransactionIds = poolObservation.absentTransactionIds.map(canonicalHash);
    if (
      presentTransactionIds.some(
        (id, index) => id !== poolObservation!.presentTransactionIds[index],
      ) ||
      queuedTransactionIds.some(
        (id, index) => id !== poolObservation!.queuedTransactionIds[index],
      ) ||
      absentTransactionIds.some((id, index) => id !== poolObservation!.absentTransactionIds[index])
    ) {
      changed = true;
      poolObservation = {
        ...poolObservation,
        presentTransactionIds,
        queuedTransactionIds,
        absentTransactionIds,
      };
    }
  }
  let ethereumProjection = snapshot.ethereumProjection;
  if (ethereumProjection) {
    const parentBlockHash = canonicalHash(ethereumProjection.parentBlockHash);
    if (parentBlockHash !== ethereumProjection.parentBlockHash) {
      changed = true;
      ethereumProjection = { ...ethereumProjection, parentBlockHash };
    }
  }
  const canonical = changed
    ? {
        ...snapshot,
        transactions,
        blocks,
        inclusions,
        blockTemplate,
        poolObservation,
        ethereumProjection,
      }
    : snapshot;
  canonicalSnapshotCache.set(snapshot, canonical);
  return canonical;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

export function transactionHeadScale(tx: Pick<Tx, 'chain' | 'size'>): number {
  const reference = tx.chain === 'bitcoin' ? 250 : 21_000;
  const size = Number.isFinite(tx.size) ? Math.max(0, tx.size) : 0;
  if (size <= 0) return MIN_HEAD_SCALE;
  return Math.max(MIN_HEAD_SCALE, Math.min(MAX_HEAD_SCALE, 1 + Math.log2(size / reference) * 0.5));
}

/** Three illustrative baggage sizes; never used as a block admission budget. */
export function transactionResourceUnits(tx: Pick<Tx, 'chain' | 'size'>): number {
  const reference = tx.chain === 'bitcoin' ? 400 : 100_000;
  const size = Number.isFinite(tx.size) ? Math.max(0, tx.size) : 0;
  return Math.max(1, Math.min(3, Math.ceil(size / reference)));
}

/** A fee recommendation is not an inclusion floor; only Ethereum's base fee is one. */
function ethereumFeeCap(tx: Tx): bigint | null {
  const cap = tx.ethereum?.maxFeePerGasWei ?? tx.ethereum?.gasPriceWei;
  return cap !== undefined && /^\d+$/.test(cap) ? BigInt(cap) : null;
}

function feeEligible(
  tx: Tx,
  feeThreshold: number | null,
  projection: Snapshot['ethereumProjection'] = null,
): boolean {
  if (tx.chain !== 'ethereum') return true;
  const cap = ethereumFeeCap(tx);
  if (cap !== null) return Boolean(projection) && cap >= BigInt(projection!.baseFeePerGasWei);
  return tx.feeRate >= (feeThreshold ?? 0);
}

function comparePriority(left: Tx, right: Tx, projection: Snapshot['ethereumProjection']): number {
  if (projection && left.chain === 'ethereum' && right.chain === 'ethereum') {
    const baseFee = BigInt(projection.baseFeePerGasWei);
    const priority = (tx: Tx): bigint | null => {
      const cap = ethereumFeeCap(tx);
      if (cap === null) return null;
      const tip = tx.ethereum?.maxPriorityFeePerGasWei;
      const offered = tip === undefined ? cap : baseFee + BigInt(tip);
      return (cap < offered ? cap : offered) - baseFee;
    };
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority)
      return leftPriority > rightPriority ? -1 : 1;
  }
  return right.feeRate - left.feeRate || left.id.localeCompare(right.id);
}

export function activeEthereumProjection(snapshot: Snapshot): Snapshot['ethereumProjection'] {
  const projection = snapshot.ethereumProjection;
  const parent = snapshot.blocks[0];
  return snapshot.chain === 'ethereum' &&
    snapshot.mode === 'live' &&
    snapshot.status === 'ok' &&
    projection &&
    parent &&
    projection.parentBlockHash.toLowerCase() === parent.hash.toLowerCase() &&
    projection.height === parent.height + 1 &&
    projection.observedAt <= snapshot.observedAt &&
    snapshot.observedAt - projection.observedAt <= 30_000
    ? projection
    : null;
}

function transactionObservedAt(snapshot: Snapshot, tx: Tx): number {
  const arrival = bitcoinArrivalObservation(snapshot, tx);
  if (arrival) return arrival.observedAt;
  const candidate = activeBitcoinBlockTemplate(snapshot);
  if (candidate && templateSelection(candidate)?.has(tx.id.toLowerCase()))
    return candidate.observedAt;
  return tx.status === 'pending'
    ? (snapshot.sampling?.observedAt ?? snapshot.observedAt)
    : snapshot.observedAt;
}

function poolStates(
  snapshot: Snapshot,
  passengers: Pick<
    Passenger,
    | 'tx'
    | 'lastObservedAt'
    | 'poolState'
    | 'poolObservedAt'
    | 'poolExcludedAt'
    | 'poolExcludedState'
  >[],
): Map<string, PoolPassengerObservation> {
  const states = new Map<string, PoolPassengerObservation>();
  const observation = snapshot.poolObservation;
  const fresh =
    observation &&
    snapshot.status === 'ok' &&
    observation.observedAt <= snapshot.observedAt &&
    snapshot.observedAt - observation.observedAt <= 60_000;
  const explicit = new Map<string, PassengerPoolState>();
  if (fresh) {
    for (const id of observation.presentTransactionIds) explicit.set(id, 'pending');
    for (const id of observation.queuedTransactionIds) explicit.set(id, 'queued');
    for (const id of observation.absentTransactionIds) explicit.set(id, 'absent');
  }
  const current = new Map(snapshot.transactions.map((tx) => [tx.id, tx]));
  const known = new Map(passengers.map((passenger) => [passenger.tx.id, passenger]));
  for (const tx of snapshot.transactions)
    if (!known.has(tx.id))
      known.set(tx.id, { tx, lastObservedAt: transactionObservedAt(snapshot, tx) });
  for (const passenger of known.values()) {
    const tx = current.get(passenger.tx.id);
    const detailAt = tx ? transactionObservedAt(snapshot, tx) : passenger.lastObservedAt;
    const previousFresh =
      fresh &&
      passenger.poolObservedAt !== undefined &&
      snapshot.observedAt - passenger.poolObservedAt <= 60_000;
    let state: PoolPassengerObservation =
      previousFresh && (passenger.poolObservedAt ?? 0) >= (detailAt ?? 0)
        ? { poolState: passenger.poolState ?? 'unknown', poolObservedAt: passenger.poolObservedAt }
        : { poolState: 'unknown', poolObservedAt: undefined };
    state.bitcoinArrival = undefined;
    state.poolExcludedAt = passenger.poolExcludedAt;
    state.poolExcludedState = passenger.poolExcludedState;
    state.detailObservedAt = Math.max(passenger.lastObservedAt ?? 0, detailAt ?? 0);
    if (tx?.status === 'pending' && (detailAt ?? 0) >= (state.poolExcludedAt ?? 0)) {
      state.poolExcludedAt = undefined;
      state.poolExcludedState = undefined;
    }
    const explicitState = explicit.get(passenger.tx.id);
    if (
      fresh &&
      explicitState &&
      observation.observedAt >= (detailAt ?? 0) &&
      observation.observedAt >= (state.poolObservedAt ?? 0)
    ) {
      state = { ...state, poolState: explicitState, poolObservedAt: observation.observedAt };
    }
    const arrival = tx ? bitcoinArrivalObservation(snapshot, tx) : undefined;
    if (arrival) {
      // Different providers have different mempool views. An RPC absence cannot
      // negate a recently received pending detail from the independent stream.
      state = {
        ...state,
        poolState: 'unknown',
        poolObservedAt: undefined,
        poolExcludedAt: undefined,
        poolExcludedState: undefined,
        bitcoinArrival: arrival,
      };
    }
    if (
      state.poolState === 'pending' &&
      (state.poolObservedAt ?? 0) >= (state.poolExcludedAt ?? 0)
    ) {
      state.poolExcludedAt = undefined;
      state.poolExcludedState = undefined;
    } else if (state.poolState === 'absent' || state.poolState === 'queued') {
      state.poolExcludedAt = state.poolObservedAt;
      state.poolExcludedState = state.poolState;
    } else if (
      state.poolExcludedAt !== undefined &&
      state.poolState === 'pending' &&
      (state.poolObservedAt ?? 0) < state.poolExcludedAt
    ) {
      state.poolState = 'unknown';
      state.poolObservedAt = undefined;
    }
    states.set(passenger.tx.id, state);
  }
  const replacementCandidates = new Map<string, { tx: Tx; observedAt: number } | null>();
  for (const tx of snapshot.transactions) {
    if (tx.status !== 'pending' || !tx.ethereum) continue;
    const key = `${tx.ethereum.from.toLowerCase()}:${tx.ethereum.nonce}`;
    const observedAt = transactionObservedAt(snapshot, tx);
    const previous = replacementCandidates.get(key);
    if (previous === undefined || (previous && observedAt > previous.observedAt))
      replacementCandidates.set(key, { tx, observedAt });
    else if (previous && observedAt === previous.observedAt && previous.tx.id !== tx.id)
      replacementCandidates.set(key, null);
  }
  for (const passenger of passengers) {
    if (passenger.tx.status !== 'pending' || !passenger.tx.ethereum) continue;
    const oldState = states.get(passenger.tx.id);
    const candidate = replacementCandidates.get(
      `${passenger.tx.ethereum.from.toLowerCase()}:${passenger.tx.ethereum.nonce}`,
    );
    if (
      candidate &&
      candidate.tx.id !== passenger.tx.id &&
      candidate.observedAt > (passenger.lastObservedAt ?? 0) &&
      (!['pending', 'queued'].includes(oldState?.poolState ?? '') ||
        candidate.observedAt > (oldState?.poolObservedAt ?? 0)) &&
      !['absent', 'queued'].includes(oldState?.poolState ?? '')
    )
      states.set(passenger.tx.id, {
        poolState: 'replaced',
        poolObservedAt: candidate.observedAt,
        poolExcludedAt: candidate.observedAt,
        poolExcludedState: 'replaced',
      });
  }
  return states;
}

/** A template expires with its parent, availability or age; it never proves inclusion. */
export function activeBitcoinBlockTemplate(snapshot: Snapshot): BitcoinBlockTemplate | null {
  const template = snapshot.blockTemplate;
  const parent = snapshot.blocks[0];
  if (
    snapshot.chain !== 'bitcoin' ||
    snapshot.mode !== 'live' ||
    snapshot.status !== 'ok' ||
    !template ||
    !parent ||
    template.previousBlockHash.toLowerCase() !== parent.hash.toLowerCase() ||
    template.height !== parent.height + 1 ||
    template.observedAt > snapshot.observedAt ||
    snapshot.observedAt - template.observedAt > 30_000
  )
    return null;
  return template;
}

const templateSelectionCache = new WeakMap<BitcoinBlockTemplate, ReadonlySet<string>>();
function templateSelection(template: BitcoinBlockTemplate | null): ReadonlySet<string> | null {
  if (!template) return null;
  const previous = templateSelectionCache.get(template);
  if (previous) return previous;
  const selected = new Set(template.selectedTransactionIds.map((id) => id.toLowerCase()));
  templateSelectionCache.set(template, selected);
  return selected;
}

function planProjections(
  transactions: Tx[],
  capacity: number | null,
  feeThreshold: number | null,
  passengers: Passenger[] = [],
  blockTemplate: BitcoinBlockTemplate | null = null,
  ethereumProjection: Snapshot['ethereumProjection'] = null,
  poolObservations = new Map<string, PoolPassengerObservation>(),
  nonceContext?: EthereumNoncePlanningContext,
) {
  const selected = templateSelection(blockTemplate);
  const preferredWagon = (tx: Tx): WagonKind =>
    selected!.has(tx.id.toLowerCase()) ? 'next' : 'later';
  const budget = (wagon: WagonKind) =>
    wagon === 'next' && blockTemplate
      ? Math.min(capacity ?? 0, blockTemplate.weightLimit / 4)
      : (capacity ?? 0);
  const reasons = new Map<string, PassengerReason>();
  const unReplaced = transactions.filter(
    (tx) => poolObservations.get(tx.id)?.poolExcludedState !== 'replaced',
  );
  const noncePlan = ethereumNonceDependencies(
    transactions,
    nonceContext ?? {
      observedAt: 0,
      healthy: true,
      known: passengers.map((passenger) => ({
        tx: passenger.tx,
        resident: true,
        dependency: passenger.nonceDependency,
      })),
      inclusions: new Map(),
    },
  );
  const predecessors = new Map<string, string>();
  for (const [id, dependency] of noncePlan.dependencies) {
    const predecessor = ethereumPredecessorId(dependency);
    if (predecessor) predecessors.set(id, predecessor);
  }
  const rawEligible = unReplaced
    .filter((tx) => {
      if (noncePlan.excludedIds.has(tx.id)) {
        reasons.set(tx.id, 'nonce');
        return false;
      }
      const presence = poolObservations.get(tx.id);
      const exclusion = presence?.poolExcludedState;
      const proposedAfterObservation =
        selected?.has(tx.id) &&
        blockTemplate!.observedAt >= (presence?.poolExcludedAt ?? presence?.poolObservedAt ?? 0);
      if (
        presence &&
        (exclusion === 'absent' || exclusion === 'queued') &&
        !proposedAfterObservation
      ) {
        reasons.set(tx.id, exclusion);
        return false;
      }
      if (!feeEligible(tx, feeThreshold, ethereumProjection)) {
        reasons.set(
          tx.id,
          tx.chain === 'ethereum' && ethereumFeeCap(tx) !== null && !ethereumProjection
            ? 'projection'
            : 'fee',
        );
        return false;
      }
      const size = transactionBlockSize(tx);
      if (size <= 0 || capacity === null || size > capacity) {
        reasons.set(tx.id, 'capacity');
        return false;
      }
      return true;
    })
    .sort((left, right) => comparePriority(left, right, ethereumProjection));
  for (const tx of transactions)
    if (poolObservations.get(tx.id)?.poolExcludedState === 'replaced')
      reasons.set(tx.id, 'replaced');
  const byId = new Map(rawEligible.map((tx) => [tx.id, tx]));
  const eligible: Tx[] = [];
  const ordered = new Set<string>();
  // Emit known lower nonces first without assuming any missing nonce is available.
  for (const tx of rawEligible) {
    const chain: Tx[] = [];
    let cursor: Tx | undefined = tx;
    while (cursor && !ordered.has(cursor.id)) {
      ordered.add(cursor.id);
      chain.push(cursor);
      cursor = byId.get(predecessors.get(cursor.id) ?? '');
    }
    eligible.push(...chain.reverse());
  }
  const preferred = new Map(
    passengers.map(
      (passenger) =>
        [
          passenger.tx.id,
          {
            wagon: passenger.inHandoff ? 'next' : (passenger.wagon ?? passenger.plannedWagon),
            seat: passenger.wagon ? passenger.seatIndex : passenger.plannedSeatIndex,
          },
        ] as const,
    ),
  );
  const allocate = (preservePlaces: boolean) => {
    const admitted = new Map<string, { wagon: WagonKind; seat: number }>();
    const used: Record<WagonKind, number> = { next: 0, later: 0 };
    const count: Record<WagonKind, number> = { next: 0, later: 0 };
    const canFollow = (tx: Tx, wagon: WagonKind) => {
      if (noncePlan.dependencies.get(tx.id)?.blocked) return false;
      const predecessor = predecessors.get(tx.id);
      if (!predecessor) return true;
      const earlier = admitted.get(predecessor);
      return earlier !== undefined && (wagon === 'later' || earlier.wagon === 'next');
    };
    if (preservePlaces) {
      for (const tx of eligible) {
        const place = preferred.get(tx.id);
        if (!place?.wagon) continue;
        if (selected && place.wagon !== preferredWagon(tx)) continue;
        const wagon: WagonKind = place.wagon;
        if (!canFollow(tx, wagon)) return null;
        used[wagon] += transactionBlockSize(tx);
        if (used[wagon] > budget(wagon)) return null;
        admitted.set(tx.id, { wagon, seat: place.seat });
        count[wagon] += 1;
      }
    }
    for (const tx of eligible) {
      if (admitted.has(tx.id)) continue;
      const size = transactionBlockSize(tx);
      const templateWagon = selected ? preferredWagon(tx) : null;
      const wagon: WagonKind | null = templateWagon
        ? used[templateWagon] + size <= budget(templateWagon)
          ? templateWagon
          : null
        : used.next + size <= budget('next') && canFollow(tx, 'next')
          ? 'next'
          : used.later + size <= budget('later') && canFollow(tx, 'later')
            ? 'later'
            : null;
      if (wagon) {
        if (!canFollow(tx, wagon)) {
          reasons.set(tx.id, 'nonce');
          if (preservePlaces) return null;
          continue;
        }
        const prior = preferred.get(tx.id);
        admitted.set(tx.id, {
          wagon,
          seat: prior?.wagon === wagon ? prior.seat : count[wagon],
        });
        count[wagon] += 1;
        used[wagon] += size;
      } else {
        if (
          noncePlan.dependencies.get(tx.id)?.blocked ||
          (predecessors.has(tx.id) && !admitted.has(predecessors.get(tx.id)!))
        )
          reasons.set(tx.id, 'nonce');
        if (preservePlaces) return null;
      }
    }
    return { admitted, used, count };
  };
  // Keep existing vehicles/places whenever everybody still fits. Only actual
  // native-capacity competition requires repacking by descending fee rate.
  const allocation = allocate(true) ?? allocate(false)!;
  for (const tx of eligible)
    reasons.set(
      tx.id,
      allocation.admitted.has(tx.id) ? 'accepted' : (reasons.get(tx.id) ?? 'capacity'),
    );
  return { ...allocation, reasons, nonceDependencies: noncePlan.dependencies };
}

function hasBoardedProjection(passenger: Passenger, now: number): boolean {
  return (
    passenger.hasBoardedProjection === true ||
    (passenger.wagon !== null &&
      (passenger.inHandoff ||
        passenger.phase === 'boarded' ||
        (passenger.phase === 'boarding' && isInsideDoorway(passengerPosition(passenger, now)))))
  );
}

function retainedProjectionTransactions(
  passengers: Passenger[],
  sourceIds: ReadonlySet<string>,
  observedAt: number,
  now: number,
  completedIds: ReadonlySet<string> = new Set(),
  blockTemplate: BitcoinBlockTemplate | null = null,
  observations = new Map<string, PoolPassengerObservation>(),
): Tx[] {
  const selected = templateSelection(blockTemplate);
  return passengers
    .filter(
      (passenger) =>
        !sourceIds.has(passenger.tx.id) &&
        !completedIds.has(passenger.tx.id) &&
        passenger.tx.status === 'pending' &&
        !passenger.departureIncluded &&
        !passenger.awaitingVerifiedDeparture &&
        (!passenger.joiningArchive || selected?.has(passenger.tx.id.toLowerCase())) &&
        passenger.lastObservedAt !== undefined &&
        (selected?.has(passenger.tx.id.toLowerCase()) ||
          observations.get(passenger.tx.id)?.poolState === 'pending' ||
          (observedAt - passenger.lastObservedAt < TRACKED_TRANSACTION_TTL_MS &&
            hasBoardedProjection(passenger, now))),
    )
    .sort(
      (left, right) =>
        Number(selected?.has(right.tx.id.toLowerCase()) ?? false) -
          Number(selected?.has(left.tx.id.toLowerCase()) ?? false) ||
        right.tx.feeRate - left.tx.feeRate ||
        left.tx.id.localeCompare(right.tx.id),
    )
    .slice(0, MAX_INDIVIDUAL_HISTORY)
    .map((passenger) => passenger.tx);
}

function noncePlanningContext(
  snapshot: Pick<
    Snapshot,
    'mode' | 'status' | 'observedAt' | 'transactions' | 'inclusions' | 'ethereumDependencies'
  > & {
    blocks: Pick<Block, 'hash' | 'height'>[];
  },
  passengers: Passenger[],
  archived: ArchivedObservation[],
  admissions: PassengerAdmission[],
  receipts: DepartureReceipt[],
  observations: Map<string, PoolPassengerObservation>,
): EthereumNoncePlanningContext {
  const known: EthereumNonceObservation[] = [];
  for (const entry of archived)
    known.push({ tx: entry.tx, observedAt: entry.lastSeenAt, dependency: entry.nonceDependency });
  for (const admission of admissions)
    known.push({ tx: admission.tx, dependency: admission.nonceDependency });
  for (const passenger of passengers)
    known.push({
      tx: passenger.tx,
      observedAt: passenger.lastObservedAt,
      resident: true,
      dependency: passenger.nonceDependency,
    });
  const priorById = new Map(known.map((entry) => [entry.tx.id, entry]));
  for (const tx of snapshot.transactions) {
    const prior = priorById.get(tx.id);
    known.push({
      ...prior,
      tx,
      observedAt: observations.get(tx.id)?.detailObservedAt ?? snapshot.observedAt,
    });
  }
  for (const entry of known) {
    const presence = observations.get(entry.tx.id);
    entry.poolState = presence?.poolExcludedState ?? presence?.poolState;
    entry.poolObservedAt = presence?.poolObservedAt;
  }
  const healthy = snapshot.status === 'ok';
  const inclusions = new Map<string, { blockHash: string; blockHeight: number }>();
  if (healthy && snapshot.mode === 'live') {
    const contradicted = (block: { hash: string; height: number }) =>
      (snapshot.blocks[0]?.height ?? block.height) < block.height ||
      snapshot.blocks.some(
        (current) => current.height === block.height && current.hash !== block.hash,
      ) ||
      (snapshot.inclusions ?? []).some(
        ({ block: current }) => current.height === block.height && current.hash !== block.hash,
      );
    for (const receipt of receipts)
      if (!contradicted(receipt))
        for (const id of receipt.transactionIds)
          inclusions.set(id, { blockHash: receipt.hash, blockHeight: receipt.height });
    for (const inclusion of snapshot.inclusions ?? [])
      if (!contradicted(inclusion.block))
        for (const id of inclusion.transactionIds)
          inclusions.set(id, {
            blockHash: inclusion.block.hash,
            blockHeight: inclusion.block.height,
          });
    for (const tx of snapshot.transactions) {
      const block = snapshot.blocks.find((entry) => entry.hash === tx.blockHash);
      if (tx.status === 'confirmed' && block)
        inclusions.set(tx.id, { blockHash: block.hash, blockHeight: block.height });
    }
  }
  return {
    observedAt: snapshot.observedAt,
    healthy,
    parentBlockHash: snapshot.blocks[0]?.hash,
    height: snapshot.blocks[0] ? snapshot.blocks[0].height + 1 : undefined,
    dependencies: snapshot.ethereumDependencies,
    known,
    inclusions,
  };
}

function planSnapshot(
  snapshot: Snapshot,
  passengers: Passenger[] = [],
  now = 0,
  completedIds: ReadonlySet<string> = new Set(),
  dependencyState?: Pick<
    PassengerMotionState,
    'waitingArchiveTransactions' | 'pendingAdmissions' | 'handledDepartures'
  >,
) {
  const capacity = capacityForSnapshot(snapshot);
  const blockTemplate = activeBitcoinBlockTemplate(snapshot);
  const ethereumProjection = activeEthereumProjection(snapshot);
  const archived = [...(dependencyState?.waitingArchiveTransactions.values() ?? [])];
  const dependencyObservations = [
    ...archived.map((entry) => ({ tx: entry.tx, lastObservedAt: entry.lastSeenAt })),
    ...passengers,
  ];
  const observations = poolStates(snapshot, dependencyObservations);
  const sourceTransactions = [
    ...new Map(
      snapshot.transactions.filter((tx) => !completedIds.has(tx.id)).map((tx) => [tx.id, tx]),
    ).values(),
  ].sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id));
  // Historical confirmations are not a third queue of projection candidates.
  const transactions = sourceTransactions
    .filter((tx) => tx.status === 'pending')
    .slice(0, MAX_PASSENGERS);
  const sourceIds = new Set(sourceTransactions.map((tx) => tx.id));
  // A temporary exit must not turn an already-boarded observation into a new
  // never-boarded candidate. Its original timestamp and bounded history still apply.
  const retained = retainedProjectionTransactions(
    passengers,
    sourceIds,
    snapshot.observedAt,
    now,
    completedIds,
    blockTemplate,
    observations,
  );
  const allocation = planProjections(
    [...transactions, ...retained],
    capacity,
    snapshot.feeRate,
    passengers,
    blockTemplate,
    ethereumProjection,
    observations,
    noncePlanningContext(
      snapshot,
      passengers,
      archived,
      dependencyState?.pendingAdmissions ?? [],
      dependencyState?.handledDepartures ?? [],
      observations,
    ),
  );
  for (const [identity, observation] of observations)
    if (
      !allocation.admitted.has(identity) &&
      !allocation.reasons.has(identity) &&
      observation.poolExcludedState
    )
      allocation.reasons.set(identity, observation.poolExcludedState);
  return {
    transactions,
    sourceTransactions,
    ...allocation,
    feeThreshold: snapshot.feeRate,
    capacity,
    blockTemplate,
    ethereumProjection,
    observations,
  };
}

function admissionFor(
  tx: Tx,
  plan: Pick<ReturnType<typeof planSnapshot>, 'admitted' | 'reasons' | 'nonceDependencies'>,
): PassengerAdmission {
  const projection = plan.admitted.get(tx.id);
  return {
    tx,
    nonceDependency: plan.nonceDependencies.get(tx.id),
    plannedWagon: projection?.wagon ?? null,
    plannedSeatIndex: projection?.seat ?? 0,
    selectedForCandidate: projection !== undefined,
    reason: tx.status === 'confirmed' ? 'observed' : (plan.reasons.get(tx.id) ?? 'capacity'),
  };
}

function projectionOccupancy(passengers: Passenger[]): ProjectionOccupancy {
  const cached = projectionOccupancyCache.get(passengers);
  if (cached) return cached;
  const projectionCount: Record<WagonKind, number> = { next: 0, later: 0 };
  const projectionUsed: Record<WagonKind, number> = { next: 0, later: 0 };
  for (const passenger of passengers) {
    if (!passenger.plannedWagon) continue;
    projectionCount[passenger.plannedWagon] += 1;
    projectionUsed[passenger.plannedWagon] += transactionBlockSize(passenger.tx);
  }
  const occupancy = {
    projectionCount,
    projectionUsed,
    candidateCount: projectionCount.next,
    candidateUsed: projectionUsed.next,
  };
  projectionOccupancyCache.set(passengers, occupancy);
  return occupancy;
}

function interpolatePath(path: StreetPoint[], progress: number): StreetPoint {
  const start = path[0] ?? FALLBACK_PATH_START;
  if (path.length < 2) return start;
  if (progress <= 0) return start;
  if (progress >= 1) return path[path.length - 1] ?? start;
  const { segments, distance } = pathGeometry(path);
  let remaining = distance * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < segments.length; index += 1) {
    const { from, to, length } = segments[index]!;
    if (remaining <= length || index === segments.length - 1) {
      const fraction = length > 0 ? remaining / length : 1;
      return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
    }
    remaining -= length;
  }
  return path[path.length - 1] ?? start;
}

function passengerPosition(passenger: Passenger, elapsedMs: number): StreetPoint {
  return interpolatePath(
    passenger.path,
    passenger.durationMs > 0
      ? Math.min(1, Math.max(0, (elapsedMs - passenger.phaseStartedAt) / passenger.durationMs))
      : 1,
  );
}

/** Reconstruct behind the current position; never accumulate animation samples. */
function passengerTrail(
  path: StreetPoint[],
  progress: number,
  position: StreetPoint,
): readonly StreetPoint[] | undefined {
  const { segments, distance } = pathGeometry(path);
  const travelled = distance * progress;
  if (!Number.isFinite(travelled) || travelled <= 0.000001) return undefined;
  const startDistance = Math.max(0, travelled - 110);
  const points: StreetPoint[] = [];
  const append = (point: StreetPoint) => {
    const previous = points.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= 0.000001) return;
    points.push(point);
    // Keep the most recent corners if a future route has more turns than today's paths.
    if (points.length > 8) points.shift();
  };
  let segmentStart = 0;
  for (const { from, to, length } of segments) {
    const segmentEnd = segmentStart + length;
    if (length > 0 && segmentEnd > startDistance && segmentStart < travelled) {
      const start = Math.max(0, (startDistance - segmentStart) / length);
      const end = Math.min(1, (travelled - segmentStart) / length);
      append({ x: from.x + (to.x - from.x) * start, y: from.y + (to.y - from.y) * start });
      append({ x: from.x + (to.x - from.x) * end, y: from.y + (to.y - from.y) * end });
    }
    segmentStart = segmentEnd;
    if (segmentStart >= travelled) break;
  }
  if (points.length < 2) return undefined;
  points[points.length - 1] = position;
  return points;
}

function pathHeadingDegrees(path: StreetPoint[], progress: number): number {
  const { segments, distance } = pathGeometry(path);
  let remaining = distance * Math.max(0, Math.min(1, progress));
  let lastHeading = 0;
  for (const segment of segments) {
    if (segment.length <= 0) continue;
    lastHeading = segment.heading;
    if (remaining <= segment.length) return segment.heading;
    remaining -= segment.length;
  }
  return lastHeading;
}

function pathDuration(path: StreetPoint[]): number {
  const { distance } = pathGeometry(path);
  return Math.max(1_700, Math.min(5_200, distance * 9));
}

function platformPath(from: StreetPoint, to: StreetPoint): StreetPoint[] {
  return [from, { x: PLATFORM_CORRIDOR_X, y: from.y }, { x: PLATFORM_CORRIDOR_X, y: to.y }, to];
}

function startPhase(
  passenger: Passenger,
  phase: PassengerPhase,
  now: number,
  path: StreetPoint[],
  durationMs: number,
): Passenger {
  const updated = { ...passenger, inHandoff: false, phase, phaseStartedAt: now, durationMs, path };
  if (updated.queueReserved && !needsQueuePlace(updated)) updated.queueReserved = false;
  return updated;
}

function startWalking(passenger: Passenger, now: number, from: StreetPoint): Passenger {
  const target = passenger.plannedWagon;
  if (!target) return startReturning(passenger, now, from);
  const path = platformPath(from, boardingApproach(target));
  return {
    ...startPhase(passenger, 'walking', now, path, pathDuration(path)),
    wagon: null,
    seatIndex: passenger.plannedSeatIndex,
  };
}

function startReturning(passenger: Passenger, now: number, from: StreetPoint): Passenger {
  const path = platformPath(from, passengerQueuePoint(passenger));
  return { ...startPhase(passenger, 'returning', now, path, pathDuration(path)), wagon: null };
}

function parkAtQueue(passenger: Passenger, now: number): Passenger {
  return {
    ...startPhase(passenger, waitingPhase(passenger), now, [passengerPosition(passenger, now)], 0),
    wagon: null,
    plannedWagon: null,
    selectedForCandidate: false,
    joiningArchive: false,
  };
}

function passengerQueuePoint(passenger: Passenger): StreetPoint {
  return (
    passenger.queuePoint ??
    (passenger.queueZone === 'history'
      ? historicalQueuePosition(passenger.queueIndex)
      : queuePosition(passenger.queueIndex))
  );
}

function waitingQueueZone(passenger: Passenger): PassengerQueueZone {
  return isHistoricalPassenger({
    tx: passenger.tx,
    sourceObserved: passenger.presentInSample || passenger.awaitingVerifiedDeparture === true,
    poolState: passenger.poolState,
    poolObservedAt: passenger.poolObservedAt,
    bitcoinArrival: passenger.bitcoinArrival,
  })
    ? 'history'
    : 'active';
}

/** Seats and approaches release their queue place; exits reserve a destination before returning. */
function needsQueuePlace(passenger: Passenger): boolean {
  if (passenger.inHandoff || passenger.joiningArchive || passenger.departureIncluded) return false;
  return (
    ['arriving', 'queue', 'parked', 'reordering', 'returning', 'retiring', 'exiting'].includes(
      passenger.phase,
    ) ||
    (passenger.phase === 'confirmed' && passenger.wagon === null)
  );
}

function nextQueueSlot(occupied: number[], capacity: number): number {
  let slot = occupied.findIndex((count) => count === 0);
  if (slot < 0) {
    slot = 0;
    for (let index = 1; index < capacity; index += 1)
      if (occupied[index]! < occupied[slot]!) slot = index;
  }
  const index = slot + occupied[slot]! * capacity;
  occupied[slot]! += 1;
  return index;
}

function waitingPhase(passenger: Passenger): PassengerPhase {
  return passenger.tx.status === 'confirmed'
    ? 'confirmed'
    : waitingQueueZone(passenger) === 'active'
      ? 'queue'
      : 'parked';
}

function alignWaitingQueue(
  passengers: Passenger[],
  now: number,
  layout: QueueLayout,
  instant = false,
): Passenger[] {
  const cached = !instant && alignedQueueCache.get(passengers);
  if (cached && cached.layout === layout && cached.passengerCount === passengers.length)
    return passengers;
  const historyLayout = historicalQueueLayout(layout);
  const occupied = {
    active: Array<number>(layout.capacity).fill(0),
    history: Array<number>(historyLayout.capacity).fill(0),
  };
  const capacity = (zone: PassengerQueueZone) =>
    zone === 'history' ? historyLayout.capacity : layout.capacity;
  const places = new Map<string, number>();
  // Existing reservations have priority over arrivals. Logical overflow indices
  // cannot hide an empty physical place: only the first owner keeps each slot.
  for (const passenger of passengers) {
    if (!needsQueuePlace(passenger) || !passenger.queueReserved) continue;
    const zone = waitingQueueZone(passenger);
    if ((passenger.queueZone ?? 'active') !== zone) continue;
    const slot = passenger.queueIndex % capacity(zone);
    if (!Number.isInteger(slot) || slot < 0 || occupied[zone][slot] !== 0) continue;
    occupied[zone][slot] = 1;
    places.set(passenger.tx.id, slot);
  }
  const unassigned = passengers
    .filter((passenger) => needsQueuePlace(passenger) && !places.has(passenger.tx.id))
    .sort(
      (left, right) => right.tx.feeRate - left.tx.feeRate || left.tx.id.localeCompare(right.tx.id),
    );
  for (const passenger of unassigned) {
    const zone = waitingQueueZone(passenger);
    places.set(passenger.tx.id, nextQueueSlot(occupied[zone], capacity(zone)));
  }
  let reordering = false;
  const aligned = mapPassengers(passengers, (passenger) => {
    // A reordering path may settle within 0.5 units before its duration ends.
    // Keep evaluating that time-dependent transition on every clock tick.
    if (passenger.phase === 'reordering') reordering = true;
    const queueIndex = places.get(passenger.tx.id);
    if (queueIndex === undefined)
      return passenger.queueReserved ? { ...passenger, queueReserved: false } : passenger;
    const queueZone = waitingQueueZone(passenger);
    const target =
      queueZone === 'history'
        ? historicalQueuePosition(queueIndex, layout)
        : queuePosition(queueIndex, layout);
    const changedPoint =
      passenger.queuePoint?.x !== target.x || passenger.queuePoint?.y !== target.y;
    const updated =
      passenger.queueReserved &&
      passenger.queueIndex === queueIndex &&
      passenger.queueZone === queueZone &&
      !changedPoint
        ? passenger
        : { ...passenger, queueIndex, queueZone, queuePoint: target, queueReserved: true };
    const point = passengerPosition(passenger, now);
    const endpoint = passenger.path[passenger.path.length - 1];
    if (['queue', 'parked', 'reordering', 'confirmed'].includes(passenger.phase)) {
      const phase = waitingPhase(passenger);
      if (instant) {
        if (passenger.phase === phase && point.x === target.x && point.y === target.y)
          return updated;
        return startPhase(updated, phase, now, [target], 0);
      }
      if (Math.hypot(point.x - target.x, point.y - target.y) < 0.5)
        return passenger.phase !== phase
          ? { ...startPhase(updated, phase, now, [target], 0), retryAt: now + 300 }
          : updated;
      if (passenger.phase === 'reordering' && endpoint?.x === target.x && endpoint.y === target.y)
        return updated;
      const path = platformPath(point, target);
      const { distance } = pathGeometry(path);
      return startPhase(
        updated,
        'reordering',
        now,
        path,
        Math.max(350, Math.min(1_000, distance * 3)),
      );
    }
    // Door passages finish their captured route. Arrivals/returns keep their
    // current position but can retarget a place lost during a resize or an exit.
    if (
      ['arriving', 'returning', 'retiring'].includes(passenger.phase) &&
      (endpoint?.x !== target.x || endpoint.y !== target.y)
    ) {
      const path = passenger.phase === 'arriving' ? [point, target] : platformPath(point, target);
      const remaining = Math.max(300, passenger.phaseStartedAt + passenger.durationMs - now);
      return startPhase(updated, passenger.phase, now, path, remaining);
    }
    return updated;
  });
  if (!instant && aligned === passengers && !reordering)
    alignedQueueCache.set(passengers, { layout, passengerCount: passengers.length });
  return aligned;
}

/** Reflow only pedestrian destinations; block evidence, vehicle clocks and seats are preserved. */
export function reflowPassengerQueue(
  state: PassengerMotionState,
  queueLayout: QueueLayout,
): PassengerMotionState {
  const passengers = alignWaitingQueue(state.passengers, state.elapsedMs, queueLayout);
  if (
    passengers === state.passengers &&
    state.queueLayout?.columns === queueLayout.columns &&
    state.queueLayout?.rows === queueLayout.rows &&
    state.queueLayout?.capacity === queueLayout.capacity
  )
    return state;
  return { ...state, queueLayout, passengers };
}

function startExit(
  passenger: Passenger,
  now: number,
  from: StreetPoint,
  durationMs = 1_300,
): Passenger {
  if (!passenger.wagon) return startReturning(passenger, now, from);
  const inside = exitDoorPoint(passenger.wagon);
  return {
    ...startPhase(
      passenger,
      'exiting',
      now,
      [from, { x: inside.x, y: from.y }, inside, exitPlatformPoint(passenger.wagon)],
      durationMs,
    ),
    hasBoardedProjection:
      passenger.hasBoardedProjection ||
      (passenger.tx.status === 'pending' && isInsideDoorway(from)),
  };
}

function startPreparationExit(
  passenger: Passenger,
  now: number,
  from: StreetPoint,
  durationMs: number,
): Passenger {
  if (passenger.phase !== 'exiting') return startExit(passenger, now, from, durationMs);
  const remainingMs = passenger.phaseStartedAt + passenger.durationMs - now;
  if (remainingMs <= durationMs) return passenger;
  // Accelerate only the untravelled portion of an existing exit, without going back to the door.
  const { lengths, distance } = pathGeometry(passenger.path);
  const progress = Math.max(
    0,
    Math.min(1, (now - passenger.phaseStartedAt) / passenger.durationMs),
  );
  let travelled = distance * progress;
  for (const [index, length] of lengths.entries()) {
    if (travelled <= length)
      return startPhase(
        passenger,
        'exiting',
        now,
        [from, ...passenger.path.slice(index + 1)],
        durationMs,
      );
    travelled -= length;
  }
  return passenger;
}

function isRider(passenger: Passenger, wagon: WagonKind, now: number): boolean {
  return (
    passenger.wagon === wagon &&
    (['boarded', 'confirmed'].includes(passenger.phase) ||
      (['boarding', 'preparing', 'exiting'].includes(passenger.phase) &&
        isInsideDoorway(passengerPosition(passenger, now))))
  );
}

function waitOutsideSample(passenger: Passenger, now: number): Passenger {
  if (passenger.inHandoff || ['parked', 'arriving', 'returning'].includes(passenger.phase))
    return passenger;
  const point = passengerPosition(passenger, now);
  if (passenger.wagon && isInsideDoorway(point))
    return passenger.phase === 'exiting' ? passenger : startExit(passenger, now, point);
  if (passenger.phase === 'queue' || passenger.phase === 'confirmed')
    return parkAtQueue(passenger, now);
  return startReturning(passenger, now, point);
}

function retainWaitingArchive(
  state: WaitingArchiveState,
  additions: ArchivedObservation[] = [],
  removals: Iterable<string> = [],
) {
  let waitingArchiveTransactions = state.waitingArchiveTransactions;
  const writableArchive = () => {
    if (waitingArchiveTransactions === state.waitingArchiveTransactions)
      waitingArchiveTransactions = new Map(waitingArchiveTransactions);
    return waitingArchiveTransactions;
  };
  let waitingArchiveUnknownCount = state.waitingArchiveUnknownCount;
  // Claim a proved/reobserved ID before expiring it, so it is not also counted as unknown.
  for (const id of removals) if (waitingArchiveTransactions.has(id)) writableArchive().delete(id);
  for (const [id, observation] of waitingArchiveTransactions) {
    if (
      !observation.reservedBlockHash &&
      state.archiveObservedAt - observation.lastSeenAt >= TRACKED_TRANSACTION_TTL_MS
    ) {
      writableArchive().delete(id);
      waitingArchiveUnknownCount += 1;
    }
  }
  for (const observation of additions) {
    // A returning ID reuses its retained observation rather than counting twice.
    writableArchive().delete(observation.tx.id);
    writableArchive().set(observation.tx.id, observation);
  }
  while (waitingArchiveTransactions.size > MAX_ARCHIVED_OBSERVATIONS) {
    const evicted = [...waitingArchiveTransactions].find(
      ([, observation]) => !observation.reservedBlockHash,
    );
    if (!evicted) break; // Only existing bounded archive members can reserve an inclusion.
    writableArchive().delete(evicted[0]);
    waitingArchiveUnknownCount += 1;
  }
  waitingArchiveUnknownCount = Math.min(MAX_WAITING_ARCHIVE_COUNT, waitingArchiveUnknownCount);
  return {
    waitingArchiveTransactions,
    waitingArchiveUnknownCount,
    archiveObservedAt: state.archiveObservedAt,
    waitingArchiveCount: Math.min(
      MAX_WAITING_ARCHIVE_COUNT,
      waitingArchiveTransactions.size + waitingArchiveUnknownCount,
    ),
  };
}

/** Unknown sample membership never changes the source status or deletes a visible traveller. */
function groupWaitingObservations(
  passengers: Passenger[],
  archive: WaitingArchiveState,
  now: number,
  reservedDeparturePlaces = 0,
) {
  const merging = passengers.filter(
    (passenger) =>
      !passenger.presentInSample &&
      !passenger.departureIncluded &&
      !passenger.awaitingVerifiedDeparture &&
      passenger.phase === 'parked' &&
      passenger.joiningArchive,
  );
  const mergedIds = new Set(merging.map((passenger) => passenger.tx.id));
  const residents = merging.length
    ? passengers.filter((passenger) => !mergedIds.has(passenger.tx.id))
    : passengers;
  const history = residents.filter(
    (passenger) =>
      !passenger.presentInSample &&
      !passenger.departureIncluded &&
      !passenger.awaitingVerifiedDeparture,
  );
  const alreadyJoining = history.filter((passenger) => passenger.joiningArchive).length;
  const joiningCount = Math.max(
    0,
    history.length - Math.max(0, MAX_INDIVIDUAL_HISTORY - reservedDeparturePlaces) - alreadyJoining,
  );
  if (!merging.length && joiningCount === 0)
    return { ...retainWaitingArchive(archive), passengers };
  const joiningIds = new Set(
    history
      .filter(
        (passenger) =>
          passenger.phase === 'parked' &&
          !passenger.wagon &&
          !passenger.plannedWagon &&
          !passenger.inHandoff,
      )
      .sort((left, right) => left.phaseStartedAt - right.phaseStartedAt)
      .slice(0, joiningCount)
      .map((passenger) => passenger.tx.id),
  );
  return {
    ...retainWaitingArchive(
      archive,
      merging.map((passenger) => ({
        tx: passenger.tx,
        nonceDependency: passenger.nonceDependency,
        lastSeenAt: passenger.lastObservedAt ?? archive.archiveObservedAt,
      })),
    ),
    passengers: mapPassengers(residents, (passenger) => {
      if (!joiningIds.has(passenger.tx.id)) return passenger;
      const path = platformPath(passengerPosition(passenger, now), WAITING_ARCHIVE_POSITION);
      return {
        ...startPhase(passenger, 'returning', now, path, pathDuration(path)),
        joiningArchive: true,
      };
    }),
  };
}

function admitPassengers(
  residents: Passenger[],
  admissions: PassengerAdmission[],
  now: number,
  blockedIds: Set<string> = new Set(),
  archive: WaitingArchiveState = {
    waitingArchiveTransactions: new Map(),
    waitingArchiveUnknownCount: 0,
    archiveObservedAt: 0,
  },
  residentLimit = MAX_RESIDENT_PASSENGERS,
  queueLayout: QueueLayout = DEFAULT_QUEUE_LAYOUT,
  initialStock = false,
): { passengers: Passenger[]; pendingAdmissions: PassengerAdmission[] } {
  if (admissions.length === 0) return { passengers: residents, pendingAdmissions: admissions };
  let passengers = residents;
  let occupied: number[] | undefined;
  const residentIds = new Set(residentTransactionIds(residents));
  const pendingAdmissions: PassengerAdmission[] = [];
  let arrivalIndex = 0;
  const unseen = admissions.filter((admission) => !residentIds.has(admission.tx.id));
  // Verified block boarding stays first; newly observed pending IDs fill free queue slots by fees.
  const incoming = [
    ...unseen.filter((admission) => admission.tx.status === 'confirmed'),
    ...unseen
      .filter((admission) => admission.tx.status === 'pending')
      .sort(
        (left, right) =>
          right.tx.feeRate - left.tx.feeRate || left.tx.id.localeCompare(right.tx.id),
      ),
  ];
  const arrivalSpacing = Math.min(90, MAX_ARRIVAL_STAGGER_MS / Math.max(1, incoming.length - 1));
  for (const admission of incoming.slice(0, MAX_PASSENGERS)) {
    if (residentIds.has(admission.tx.id)) continue;
    if (passengers.length >= residentLimit || blockedIds.has(admission.tx.id)) {
      pendingAdmissions.push(admission);
      continue;
    }
    // A full preparation can retry pending admissions every tick. Keep its residents
    // and their cached poses intact until an admission really has a free place.
    if (passengers === residents) passengers = [...residents];
    if (!occupied) {
      passengers = alignWaitingQueue(passengers, now, queueLayout);
      occupied = Array<number>(queueLayout.capacity).fill(0);
      for (const resident of passengers)
        if (needsQueuePlace(resident) && (resident.queueZone ?? 'active') === 'active')
          occupied[resident.queueIndex % queueLayout.capacity]! += 1;
    }
    const queueIndex = nextQueueSlot(occupied, queueLayout.capacity);
    residentIds.add(admission.tx.id);
    const queue = queuePosition(queueIndex, queueLayout);
    const archived = archive.waitingArchiveTransactions.get(admission.tx.id);
    const lateInclusion =
      !initialStock &&
      !archived &&
      admission.arrivalKind === 'late-inclusion' &&
      admission.tx.status === 'confirmed' &&
      admission.tx.blockHash !== undefined;
    const path = initialStock
      ? [queue]
      : archived
        ? [WAITING_ARCHIVE_POSITION]
        : lateInclusion
          ? networkBoxArrivalPath()
          : [arrivalStart(queueIndex, queueLayout), queue];
    passengers.push({
      ...admission,
      arrivalKind: initialStock
        ? 'initial-stock'
        : lateInclusion
          ? 'late-inclusion'
          : 'new-observation',
      queueIndex,
      queueZone: 'active',
      queuePoint: queue,
      queueReserved: true,
      seatIndex: admission.plannedSeatIndex,
      phase: initialStock ? 'queue' : archived ? 'parked' : 'arriving',
      phaseStartedAt: initialStock || archived ? now : now + arrivalIndex++ * arrivalSpacing,
      durationMs: initialStock || archived ? 0 : pathDuration(path),
      retryAt: now,
      path,
      wagon: null,
      inHandoff: false,
      presentInSample: true,
      lastObservedAt: archive.archiveObservedAt,
    });
  }
  return { passengers, pendingAdmissions };
}

function departingObservation(snapshot: Snapshot): DepartureObservation | null {
  const block = snapshot.blocks[0];
  if (!block || snapshot.status !== 'ok') return null;
  return {
    block,
    transactions: snapshot.transactions
      .filter((tx) => tx.status === 'confirmed' && tx.blockHash === block.hash)
      .slice(0, MAX_PASSENGERS),
  };
}

function sourceDepartures(state: PassengerMotionState, snapshot: Snapshot): DepartureObservation[] {
  if (snapshot.status !== 'ok') return [];
  const known = new Map<string, Tx>();
  for (const observation of state.waitingArchiveTransactions.values())
    known.set(observation.tx.id, observation.tx);
  for (const passenger of state.passengers) known.set(passenger.tx.id, passenger.tx);
  for (const admission of state.pendingAdmissions) known.set(admission.tx.id, admission.tx);
  const representedIds = new Set(known.keys());
  for (const tx of snapshot.transactions) known.set(tx.id, tx);
  const observations = new Map<string, DepartureObservation>();
  for (const inclusion of snapshot.inclusions ?? []) {
    observations.set(inclusion.block.hash, {
      block: inclusion.block,
      transactions: inclusion.transactionIds.flatMap((id): Tx[] => {
        const tx = known.get(id);
        return tx ? [{ ...tx, status: 'confirmed', blockHash: inclusion.block.hash }] : [];
      }),
    });
  }
  const latest = departingObservation(snapshot);
  if (latest && (snapshot.inclusions === undefined || observations.has(latest.block.hash))) {
    const existing = observations.get(latest.block.hash);
    const transactions = new Map(existing?.transactions.map((tx) => [tx.id, tx]) ?? []);
    for (const tx of latest.transactions) transactions.set(tx.id, tx);
    observations.set(latest.block.hash, {
      block: latest.block,
      transactions: [...transactions.values()],
    });
  }
  return [...observations.values()]
    .sort((left, right) => left.block.height - right.block.height)
    .map((observation) => {
      const handled = state.handledDepartures.find(
        (receipt) => receipt.hash === observation.block.hash,
      );
      const handledIds = new Set(handled?.transactionIds);
      const transactions = observation.transactions
        .filter((tx) => !handledIds.has(tx.id))
        .slice(0, MAX_DEPARTURE_PASSENGERS);
      return {
        ...observation,
        recovered: Boolean(handled) || observation.block.height < (snapshot.blocks[0]?.height ?? 0),
        transactions,
        networkOriginIds: transactions
          .filter((tx) => !representedIds.has(tx.id))
          .map((tx) => tx.id),
      };
    })
    .filter(
      (observation) =>
        observation.transactions.length > 0 ||
        (!state.handledDepartures.some((receipt) => receipt.hash === observation.block.hash) &&
          state.initialBlockHeight !== null &&
          observation.block.height > state.initialBlockHeight),
    );
}

function initialDepartureReceipts(snapshot: Snapshot): DepartureReceipt[] {
  const receipts = new Map<string, DepartureReceipt>();
  for (const inclusion of snapshot.inclusions ?? [])
    receipts.set(inclusion.block.hash, {
      hash: inclusion.block.hash,
      height: inclusion.block.height,
      transactionIds: [...inclusion.transactionIds],
    });
  const latest = snapshot.blocks[0];
  if (latest) {
    const ids = new Set(receipts.get(latest.hash)?.transactionIds);
    for (const tx of snapshot.transactions) if (tx.blockHash === latest.hash) ids.add(tx.id);
    receipts.set(latest.hash, {
      hash: latest.hash,
      height: latest.height,
      transactionIds: [...ids],
    });
  }
  return [...receipts.values()].slice(-MAX_INCLUSION_BLOCKS * 2);
}

function receiptTransactionIds(receipts: DepartureReceipt[]): Set<string> {
  return new Set(receipts.flatMap((receipt) => receipt.transactionIds));
}

function activeDepartureTransactionIds(state: PassengerMotionState): Set<string> {
  return new Set([
    ...state.preparationTransactions.map((tx) => tx.id),
    ...state.queuedDepartures.flatMap((observation) => observation.transactions.map((tx) => tx.id)),
    ...state.departingPassengers.map(({ tx }) => tx.id),
  ]);
}

/** A receipt is recorded when scheduled; its active cohort must still reach its vehicle. */
function completedInclusionIds(state: PassengerMotionState): Set<string> {
  const completed = receiptTransactionIds(state.handledDepartures);
  for (const id of activeDepartureTransactionIds(state)) completed.delete(id);
  return completed;
}

function blockContradicted(block: Pick<Block, 'height' | 'hash'>, snapshot: Snapshot): boolean {
  if (snapshot.status !== 'ok') return false;
  const latestHeight = snapshot.blocks[0]?.height;
  return (
    (latestHeight !== undefined && block.height > latestHeight) ||
    snapshot.blocks.some(
      (current) => current.height === block.height && current.hash !== block.hash,
    ) ||
    (snapshot.inclusions ?? []).some(
      ({ block: current }) => current.height === block.height && current.hash !== block.hash,
    )
  );
}

function discardContradictedReceipts(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  if (snapshot.status !== 'ok') return state;
  const handledDepartures = state.handledDepartures.filter(
    (receipt) => !blockContradicted(receipt, snapshot),
  );
  return handledDepartures.length === state.handledDepartures.length
    ? state
    : { ...state, handledDepartures };
}

/** Exact consumed evidence wins over a replayed pool sample, never over an unknown absence. */
function discardCompletedObservations(
  state: PassengerMotionState,
  completed = completedInclusionIds(state),
): PassengerMotionState {
  if (completed.size === 0) return state;
  const passengers = state.passengers.filter((passenger) => !completed.has(passenger.tx.id));
  const pendingAdmissions = state.pendingAdmissions.filter(
    (admission) => !completed.has(admission.tx.id),
  );
  const archivedIds = [...state.waitingArchiveTransactions.keys()].filter((id) =>
    completed.has(id),
  );
  if (
    passengers.length === state.passengers.length &&
    pendingAdmissions.length === state.pendingAdmissions.length &&
    archivedIds.length === 0
  )
    return state;
  return {
    ...state,
    passengers,
    pendingAdmissions,
    ...retainWaitingArchive(state, [], archivedIds),
    ...projectionOccupancy(passengers),
  };
}

/** Only exact late discoveries get a network origin; known travellers keep theirs. */
function departureAdmissions(
  transactions: Tx[],
  state: PassengerMotionState,
  networkOrigins?: ReadonlySet<string>,
): PassengerAdmission[] {
  if (transactions.length === 0) return [];
  const residents = residentTransactionIds(state.passengers);
  const awaiting = new Map(
    state.pendingAdmissions.map((admission) => [admission.tx.id, admission]),
  );
  return transactions.map((tx) => ({
    tx,
    plannedWagon: null,
    plannedSeatIndex: 0,
    selectedForCandidate: false,
    reason: 'observed',
    arrivalKind:
      awaiting.get(tx.id)?.arrivalKind ??
      ((networkOrigins
        ? networkOrigins.has(tx.id)
        : !residents.has(tx.id) &&
          !awaiting.has(tx.id) &&
          !state.waitingArchiveTransactions.has(tx.id)) &&
      tx.status === 'confirmed' &&
      tx.blockHash !== undefined
        ? 'late-inclusion'
        : undefined),
  }));
}

function prepareForDeparture(
  state: PassengerMotionState,
  now: number,
  networkOrigins?: ReadonlySet<string>,
): PassengerMotionState {
  const preparationMs = statePreparationDurationMs(state);
  const passageDeadline = Math.max(
    now + MIN_PREPARATION_PASSAGE_MS,
    Math.min(now + preparationMs, (state.preparationStartedAt ?? now) + preparationMs),
  );
  const remainingMs = passageDeadline - now;
  const exitMs = Math.min(FAST_EXIT_DURATION_MS, remainingMs);
  // Riders of the lower projection share this deadline between their exit and boarding above.
  const connectingExitMs = Math.max(MIN_PREPARATION_PASSAGE_MS, Math.min(exitMs, remainingMs / 2));
  const included = preparationInclusions(state.preparationTransactions);
  const existingIds = residentTransactionIds(state.passengers);
  const missing = state.preparationTransactions.filter((tx) => !existingIds.has(tx.id));
  const grouped = groupWaitingObservations(state.passengers, state, now, missing.length);
  const admissions = [
    ...departureAdmissions(missing, state, networkOrigins),
    ...state.pendingAdmissions.filter((admission) => !included.has(admission.tx.id)),
  ];
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    now,
    new Set(),
    grouped,
    MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS,
    state.queueLayout,
  );
  // Count only new, proved network passages. Existing residents keep their path and clock.
  const networkNewcomers: Passenger[] = [];
  let networkPassages = 0;
  for (const passenger of admitted.passengers) {
    if (
      passenger.inHandoff ||
      passenger.arrivalKind !== 'late-inclusion' ||
      !included.has(passenger.tx.id)
    )
      continue;
    if (passenger.phase === 'preparing' && (passenger.networkDoorLeadMs ?? 0) > 0)
      networkPassages += 1;
    else if (passenger.phase === 'arriving') networkNewcomers.push(passenger);
  }
  const networkTimingScale = Math.min(1, remainingMs / NETWORK_TIMING_REFERENCE_MS);
  const networkPreludeMs =
    (NETWORK_SIGNAL_LEAD_MS + NETWORK_DOOR_BEFORE_PASSAGE_MS) * networkTimingScale;
  const networkSpacing =
    networkNewcomers.length > 1
      ? Math.min(
          NETWORK_COHORT_SPACING_MS,
          MAX_NETWORK_COHORT_STAGGER_MS / (networkNewcomers.length - 1),
          ((remainingMs - networkPreludeMs) * 0.4) / (networkNewcomers.length - 1),
        )
      : 0;
  const networkOrder = new Map(
    networkNewcomers.map((passenger, index) => [passenger.tx.id, index]),
  );
  const passengers = mapPassengers(admitted.passengers, (passenger) => {
    if (passenger.inHandoff) return passenger;
    const inclusion = included.get(passenger.tx.id);
    if (inclusion) {
      const updated =
        passenger.tx === inclusion.tx &&
        passenger.departureIncluded === true &&
        passenger.awaitingVerifiedDeparture === false &&
        passenger.joiningArchive === false &&
        passenger.presentInSample
          ? passenger
          : {
              ...passenger,
              tx: inclusion.tx,
              departureIncluded: true,
              awaitingVerifiedDeparture: false,
              joiningArchive: false,
              presentInSample: true,
            };
      if (
        passenger.phase === 'preparing' ||
        (passenger.wagon === 'next' && passenger.phase === 'confirmed')
      )
        return updated;
      const point = passengerPosition(passenger, now);
      // A rider of the second projection must first use that vehicle's lower door.
      // Its membership remains 'later' throughout this exit, so clipping and doors agree.
      if (passenger.wagon === 'later' && isInsideDoorway(point))
        return startPreparationExit(updated, now, point, connectingExitMs);
      const seat = wagonSeat('next', inclusion.index);
      const fromNetwork =
        passenger.arrivalKind === 'late-inclusion' && passenger.phase === 'arriving';
      const networkDoorLeadMs = fromNetwork
        ? NETWORK_DOOR_BEFORE_PASSAGE_MS * networkTimingScale
        : 0;
      const networkIndex = networkOrder.get(passenger.tx.id) ?? 0;
      const passageLeadMs = fromNetwork ? networkPreludeMs + networkIndex * networkSpacing : 0;
      const passageStartedAt = now + passageLeadMs;
      const path = fromNetwork
        ? networkBoxBoardingPath(
            inclusion.index,
            (networkPassages + networkIndex) % NETWORK_FLOW_LANES.length,
          )
        : passenger.wagon === 'next' && isInsideDoorway(point)
          ? [point, seat]
          : [...platformPath(point, boardingApproach('next')), entryDoorPoint('next'), seat];
      return {
        ...startPhase(
          updated,
          'preparing',
          passageStartedAt,
          path,
          passageDeadline - passageStartedAt,
        ),
        networkDoorLeadMs: fromNetwork ? networkDoorLeadMs : undefined,
        wagon: 'next' as const,
        seatIndex: inclusion.index,
        handoffPhase: undefined,
      };
    }
    let point: StreetPoint | undefined;
    if (passenger.wagon === 'next') {
      point = passengerPosition(passenger, now);
      if (isInsideDoorway(point)) return startPreparationExit(passenger, now, point, exitMs);
    }
    // A node candidate determines which lower riders may be promoted. Evacuate
    // incompatible riders while stopped instead of carrying them up just to exit.
    if (
      passenger.wagon === 'later' &&
      (!passenger.plannedWagon ||
        passenger.tx.status === 'confirmed' ||
        (state.blockTemplate !== null && passenger.plannedWagon !== 'next'))
    ) {
      point = passengerPosition(passenger, now);
      if (isInsideDoorway(point)) return startPreparationExit(passenger, now, point, exitMs);
    }
    if (passenger.plannedWagon === 'next' && ['boarding', 'walking'].includes(passenger.phase))
      return startReturning(passenger, now, point ?? passengerPosition(passenger, now));
    return passenger;
  });
  return {
    ...state,
    ...admitted,
    passengers: alignWaitingQueue(passengers, now, state.queueLayout),
    ...retainWaitingArchive(grouped, [], residentTransactionIds(admitted.passengers)),
  };
}

function beginPreparation(
  state: PassengerMotionState,
  observation: DepartureObservation,
): PassengerMotionState {
  // The source list is bounded, and IDs already in the scene keep their positions.
  const admissions = departureAdmissions(
    observation.transactions,
    state,
    observation.networkOriginIds ? new Set(observation.networkOriginIds) : undefined,
  );
  const residentIds = residentTransactionIds(state.passengers);
  const reserve = observation.transactions.filter((tx) => !residentIds.has(tx.id)).length;
  const grouped = groupWaitingObservations(state.passengers, state, state.elapsedMs, reserve);
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    state.elapsedMs,
    new Set(),
    grouped,
    MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS,
    state.queueLayout,
  );
  return prepareForDeparture(
    {
      ...state,
      ...admitted,
      ...retainWaitingArchive(grouped, [], residentTransactionIds(admitted.passengers)),
      pendingAdmissions: [...admitted.pendingAdmissions, ...state.pendingAdmissions].slice(
        0,
        MAX_PASSENGERS,
      ),
      preparationStartedAt: state.elapsedMs,
      departingBlock: observation.block,
      departureRecovered: observation.recovered ?? false,
      preparationTransactions: observation.transactions,
      candidateArrivalStartedAt: null,
    },
    state.elapsedMs,
  );
}

export function createPassengerMotion(
  snapshot: Snapshot,
  queueLayout: QueueLayout = DEFAULT_QUEUE_LAYOUT,
): PassengerMotionState {
  snapshot = canonicalSnapshot(snapshot);
  const handledDepartures = initialDepartureReceipts(snapshot);
  const plan = planSnapshot(snapshot, [], 0, receiptTransactionIds(handledDepartures));
  const admitted = admitPassengers(
    [],
    plan.transactions.map((tx) => admissionFor(tx, plan)),
    0,
    new Set(),
    {
      waitingArchiveTransactions: new Map(),
      waitingArchiveUnknownCount: 0,
      archiveObservedAt: snapshot.observedAt,
    },
    MAX_RESIDENT_PASSENGERS,
    queueLayout,
    true,
  );
  admitted.passengers = admitted.passengers.map((passenger) => ({
    ...passenger,
    lastObservedAt: transactionObservedAt(snapshot, passenger.tx),
    ...plan.observations.get(passenger.tx.id),
  }));
  admitted.passengers = alignWaitingQueue(admitted.passengers, 0, queueLayout, true);
  return {
    context: motionContext(snapshot),
    queueLayout,
    elapsedMs: 0,
    observedBlockHash: snapshot.blocks[0]?.hash ?? null,
    observedBlockHeight: snapshot.blocks[0]?.height ?? null,
    initialBlockHeight: snapshot.blocks[0]?.height ?? null,
    preparationStartedAt: null,
    handoffStartedAt: null,
    lastDepartureStartedAt: null,
    candidateArrivalStartedAt: 0,
    departingBlock: null,
    departureRecovered: false,
    preparationTransactions: [],
    queuedDeparture: null,
    queuedDepartures: [],
    handledDepartures,
    departingPassengers: [],
    waitingArchiveCount: 0,
    waitingArchiveTransactions: new Map(),
    waitingArchiveUnknownCount: 0,
    archiveObservedAt: snapshot.observedAt,
    feeThreshold: plan.feeThreshold,
    candidateCapacity: plan.capacity,
    blockTemplate: plan.blockTemplate,
    ethereumProjection: plan.ethereumProjection,
    ethereumDependencies: snapshot.ethereumDependencies,
    ...projectionOccupancy(admitted.passengers),
    ...admitted,
  };
}

function reconcileDesiredPassenger(passenger: Passenger, now: number, moving: boolean): Passenger {
  if (
    passenger.inHandoff ||
    moving ||
    passenger.departureIncluded ||
    passenger.phase === 'reordering'
  )
    return passenger;
  const point = passengerPosition(passenger, now);
  if (!passenger.presentInSample && !passenger.plannedWagon)
    return waitOutsideSample(passenger, now);
  if (['arriving', 'exiting', 'returning'].includes(passenger.phase)) return passenger;
  if (passenger.wagon && isInsideDoorway(point)) {
    if (passenger.wagon !== passenger.plannedWagon || passenger.tx.status === 'confirmed')
      return startExit(passenger, now, point);
    if (passenger.phase === 'boarded') {
      const seat = wagonSeat(passenger.wagon, passenger.seatIndex);
      if (passenger.path.length === 1 && point.x === seat.x && point.y === seat.y) return passenger;
      return { ...passenger, path: [seat] };
    }
    return passenger;
  }
  if (passenger.phase === 'walking' || passenger.phase === 'boarding') {
    if (!passenger.plannedWagon) return startReturning(passenger, now, point);
    if (passenger.phase === 'boarding' && passenger.wagon !== passenger.plannedWagon)
      return startWalking(passenger, now, point);
    // A changed priority may reroute the approach, always along the same right platform.
    const target = boardingApproach(passenger.plannedWagon);
    const end = passenger.path[passenger.path.length - 1];
    if (passenger.phase === 'walking' && (end?.x !== target.x || end?.y !== target.y))
      return startWalking(passenger, now, point);
    return passenger;
  }
  if (passenger.plannedWagon && ['queue', 'parked', 'confirmed'].includes(passenger.phase))
    return startWalking(passenger, now, point);
  if (passenger.tx.status === 'confirmed') {
    if (passenger.phase === 'confirmed' && passenger.wagon === null && passenger.durationMs === 0)
      return passenger;
    return { ...startPhase(passenger, 'confirmed', now, [point], 0), wagon: null };
  }
  if (passenger.phase === 'parked' && waitingQueueZone(passenger) === 'active')
    return { ...startPhase(passenger, 'queue', now, [point], 0), retryAt: now + QUEUE_RETRY_MS };
  return passenger;
}

export function reconcilePassengerMotion(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  snapshot = canonicalSnapshot(snapshot);
  if (state.context !== motionContext(snapshot))
    return createPassengerMotion(snapshot, state.queueLayout);
  if (state.observedBlockHeight === null && snapshot.status === 'ok' && snapshot.blocks.length)
    return createPassengerMotion(snapshot, state.queueLayout);
  state = discardCompletedObservations(discardContradictedReceipts(state, snapshot));
  const completedIds = completedInclusionIds(state);
  let availableDepartureSlots = MAX_INCLUSION_BLOCKS - state.queuedDepartures.length;
  const observations = sourceDepartures(state, snapshot).filter((observation) => {
    if (
      (state.preparationStartedAt !== null &&
        state.departingBlock?.hash === observation.block.hash) ||
      state.queuedDepartures.some((queued) => queued.block.hash === observation.block.hash)
    )
      return true;
    if (availableDepartureSlots <= 0) return false;
    availableDepartureSlots -= 1;
    return true;
  });
  let projectionExcludedIds: ReadonlySet<string> = completedIds;
  if (activeBitcoinBlockTemplate(snapshot)) {
    // A proof for the block being handled is no longer a candidate for the
    // node's new-parent proposal, even if its old pending row was retained.
    projectionExcludedIds = new Set([
      ...completedIds,
      ...state.preparationTransactions.map((tx) => tx.id),
      ...[...state.queuedDepartures, ...observations].flatMap((observation) =>
        observation.transactions.map((tx) => tx.id),
      ),
    ]);
  }
  const plan = planSnapshot(
    snapshot,
    state.passengers,
    state.elapsedMs,
    projectionExcludedIds,
    state,
  );
  const previous = new Map(state.passengers.map((passenger) => [passenger.tx.id, passenger]));
  const nextIds = new Set(plan.sourceTransactions.map((tx) => tx.id));
  const departingIds = departingTransactionIds(state.departingPassengers);
  const admissions: PassengerAdmission[] = [];
  const passengers: Passenger[] = [];
  const projectedIds = new Set(plan.transactions.map((tx) => tx.id));
  for (const tx of plan.sourceTransactions) {
    const admission = admissionFor(tx, plan);
    const existing = previous.get(tx.id);
    if (!existing) {
      if (projectedIds.has(tx.id)) admissions.push(admission);
      continue;
    }
    passengers.push({
      ...existing,
      ...admission,
      seatIndex: existing.wagon ? existing.seatIndex : admission.plannedSeatIndex,
      presentInSample: true,
      joiningArchive: false,
      lastObservedAt: Math.max(existing.lastObservedAt ?? 0, transactionObservedAt(snapshot, tx)),
      ...plan.observations.get(tx.id),
    });
  }
  for (const passenger of state.passengers) {
    if (nextIds.has(passenger.tx.id)) continue;
    passengers.push({
      ...passenger,
      ...admissionFor(passenger.tx, plan),
      presentInSample: false,
      seatIndex: passenger.seatIndex,
      joiningArchive: plan.admitted.has(passenger.tx.id) ? false : passenger.joiningArchive,
      ...plan.observations.get(passenger.tx.id),
    });
  }
  const reservedArchive = new Map(state.waitingArchiveTransactions);
  const promised = new Map<string, Tx>();
  if (!state.departingBlock || !blockContradicted(state.departingBlock, snapshot))
    for (const tx of state.preparationTransactions) promised.set(tx.id, tx);
  for (const observation of [...state.queuedDepartures, ...observations])
    if (!blockContradicted(observation.block, snapshot))
      for (const tx of observation.transactions) promised.set(tx.id, tx);
  for (const [id, archived] of reservedArchive) {
    const inclusion = promised.get(id);
    reservedArchive.set(id, {
      ...archived,
      ...(inclusion ? { tx: inclusion } : {}),
      reservedBlockHash: inclusion?.blockHash,
    });
  }
  for (let index = 0; index < passengers.length; index += 1) {
    const passenger = passengers[index]!;
    const inclusion = promised.get(passenger.tx.id);
    if (inclusion && !passenger.departureIncluded)
      passengers[index] = { ...passenger, tx: inclusion, awaitingVerifiedDeparture: true };
  }
  const grouped = groupWaitingObservations(
    passengers,
    {
      ...state,
      waitingArchiveTransactions: reservedArchive,
      archiveObservedAt: Math.max(state.archiveObservedAt, snapshot.observedAt),
    },
    state.elapsedMs,
  );
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    state.elapsedMs,
    departingIds,
    grouped,
    MAX_RESIDENT_PASSENGERS,
    state.queueLayout,
  );
  admitted.passengers = mapPassengers(admitted.passengers, (passenger) => {
    if (previous.has(passenger.tx.id)) return passenger;
    return {
      ...passenger,
      lastObservedAt: transactionObservedAt(snapshot, passenger.tx),
      ...plan.observations.get(passenger.tx.id),
    };
  });
  let next: PassengerMotionState = {
    ...state,
    ...admitted,
    ...retainWaitingArchive(grouped, [], residentTransactionIds(admitted.passengers)),
    observedBlockHash:
      snapshot.status === 'ok'
        ? (snapshot.blocks[0]?.hash ?? state.observedBlockHash)
        : state.observedBlockHash,
    observedBlockHeight:
      snapshot.status === 'ok'
        ? (snapshot.blocks[0]?.height ?? state.observedBlockHeight)
        : state.observedBlockHeight,
    feeThreshold: plan.feeThreshold,
    candidateCapacity: plan.capacity,
    blockTemplate: plan.blockTemplate,
    ethereumProjection: plan.ethereumProjection,
    ethereumDependencies: snapshot.ethereumDependencies,
    queuedDepartures: state.queuedDepartures.map((observation) => ({
      ...observation,
      transactions: [...observation.transactions],
    })),
    handledDepartures: [...state.handledDepartures],
    ...projectionOccupancy(admitted.passengers),
  };
  const canonical = new Map<number, string>();
  if (snapshot.status === 'ok') {
    for (const block of snapshot.blocks) canonical.set(block.height, block.hash);
    for (const inclusion of snapshot.inclusions ?? [])
      canonical.set(inclusion.block.height, inclusion.block.hash);
  }
  next.queuedDepartures = next.queuedDepartures.filter(
    (observation) =>
      (snapshot.status !== 'ok' ||
        !snapshot.blocks[0] ||
        observation.block.height <= snapshot.blocks[0].height) &&
      (!canonical.has(observation.block.height) ||
        canonical.get(observation.block.height) === observation.block.hash),
  );
  // A revised block can cancel a stationary preparation, never an underway vehicle.
  if (
    next.preparationStartedAt !== null &&
    next.departingBlock &&
    ((snapshot.status === 'ok' &&
      snapshot.blocks[0] &&
      next.departingBlock.height > snapshot.blocks[0].height) ||
      (canonical.has(next.departingBlock.height) &&
        canonical.get(next.departingBlock.height) !== next.departingBlock.hash))
  ) {
    next.preparationStartedAt = null;
    next.preparationTransactions = [];
    next.departingBlock = null;
    next.passengers = next.passengers.map((passenger) => ({
      ...passenger,
      phase:
        passenger.phase === 'preparing'
          ? 'boarding'
          : passenger.departureIncluded && passenger.phase === 'confirmed'
            ? 'boarded'
            : passenger.phase,
      departureIncluded: false,
      awaitingVerifiedDeparture: false,
      presentInSample: nextIds.has(passenger.tx.id),
    }));
  }
  for (const observation of observations) {
    if (
      next.preparationStartedAt !== null &&
      next.departingBlock?.hash === observation.block.hash
    ) {
      const included = new Map(next.preparationTransactions.map((tx) => [tx.id, tx]));
      for (const tx of observation.transactions) included.set(tx.id, tx);
      next.preparationTransactions = [...included.values()].slice(0, MAX_DEPARTURE_PASSENGERS);
      next.departingBlock = observation.block;
    } else {
      const queued = next.queuedDepartures.find(
        (item) => item.block.hash === observation.block.hash,
      );
      if (queued) {
        queued.block = observation.block;
        const included = new Map(queued.transactions.map((tx) => [tx.id, tx]));
        for (const tx of observation.transactions) included.set(tx.id, tx);
        queued.transactions = [...included.values()].slice(0, MAX_DEPARTURE_PASSENGERS);
        const networkOrigins = new Set([
          ...(queued.networkOriginIds ?? []),
          ...(observation.networkOriginIds ?? []),
        ]);
        queued.networkOriginIds = queued.transactions
          .filter((tx) => networkOrigins.has(tx.id))
          .map((tx) => tx.id);
      } else if (next.queuedDepartures.length < MAX_INCLUSION_BLOCKS) {
        next.queuedDepartures.push(observation);
      } else continue; // Do not mark evidence consumed when the bounded queue is full.
    }
    const receipt = next.handledDepartures.find((item) => item.hash === observation.block.hash);
    const ids = new Set(receipt?.transactionIds);
    for (const tx of observation.transactions) ids.add(tx.id);
    next.handledDepartures = next.handledDepartures
      .filter((item) => item.hash !== observation.block.hash)
      .concat({
        hash: observation.block.hash,
        height: observation.block.height,
        transactionIds: [...ids],
      })
      .slice(-MAX_INCLUSION_BLOCKS * 2);
  }
  next.queuedDepartures.sort((left, right) => left.block.height - right.block.height);
  const promisedIds = new Set([
    ...next.preparationTransactions.map((tx) => tx.id),
    ...next.queuedDepartures.flatMap((observation) => observation.transactions.map((tx) => tx.id)),
  ]);
  next.passengers = next.passengers.map((passenger) =>
    passenger.awaitingVerifiedDeparture && !promisedIds.has(passenger.tx.id)
      ? { ...passenger, awaitingVerifiedDeparture: false }
      : passenger,
  );
  next.queuedDeparture = next.queuedDepartures[0] ?? null;
  if (next.preparationStartedAt !== null)
    return prepareForDeparture(
      next,
      state.elapsedMs,
      new Set(observations.flatMap((observation) => observation.networkOriginIds ?? [])),
    );
  if (
    next.handoffStartedAt === null &&
    next.candidateArrivalStartedAt === null &&
    next.queuedDepartures.length
  ) {
    const [observation, ...rest] = next.queuedDepartures;
    next.queuedDepartures = rest;
    next.queuedDeparture = rest[0] ?? null;
    if (observation) next = beginPreparation(next, observation);
    return next;
  }
  next.passengers = next.passengers.map((passenger) =>
    reconcileDesiredPassenger(
      passenger,
      state.elapsedMs,
      next.handoffStartedAt !== null ||
        (next.candidateArrivalStartedAt !== null &&
          (passenger.wagon ?? passenger.plannedWagon) === 'later'),
    ),
  );
  next.passengers = alignWaitingQueue(next.passengers, state.elapsedMs, state.queueLayout);
  return next;
}

function carryToNext(passenger: Passenger, now: number): Passenger {
  const from = passengerPosition(passenger, now);
  const travelY =
    wagonSeat('next', passenger.seatIndex).y - wagonSeat('later', passenger.seatIndex).y;
  return {
    ...startPhase(
      passenger,
      'boarded',
      now,
      [from, { x: from.x, y: from.y + travelY }],
      HANDOFF_DURATION_MS,
    ),
    wagon: 'later',
    inHandoff: true,
    handoffPhase: passenger.phase,
  };
}

function departPreparedWagons(
  state: PassengerMotionState,
  departureAt: number,
): PassengerMotionState {
  const departingPassengers: PassengerPose[] = [];
  for (const passenger of state.passengers) {
    if (
      passenger.wagon !== 'next' ||
      passenger.tx.status !== 'confirmed' ||
      passenger.tx.blockHash !== state.departingBlock?.hash
    )
      continue;
    const pose = passengerPose(passenger, departureAt);
    if (!pose.inWagon) continue;
    departingPassengers.push({ ...pose, sourceObserved: false });
    if (departingPassengers.length === MAX_DEPARTURE_PASSENGERS) break;
  }
  const departingIds = departingTransactionIds(departingPassengers);
  const passengers = mapPassengers(
    state.passengers.filter((passenger) => !departingIds.has(passenger.tx.id)),
    (passenger) =>
      isRider(passenger, 'later', departureAt)
        ? carryToNext(passenger, departureAt)
        : passenger.departureIncluded
          ? { ...passenger, departureIncluded: false }
          : passenger,
  );
  const candidates = new Map<string, Tx>();
  for (const passenger of passengers)
    if (passenger.tx.status === 'pending' && passenger.presentInSample)
      candidates.set(passenger.tx.id, passenger.tx);
  for (const admission of state.pendingAdmissions)
    if (admission.tx.status === 'pending') candidates.set(admission.tx.id, admission.tx);
  for (const tx of retainedProjectionTransactions(
    passengers,
    new Set(candidates.keys()),
    state.archiveObservedAt,
    departureAt,
    completedInclusionIds(state),
    state.blockTemplate,
    new Map(
      state.passengers.map((passenger) => [
        passenger.tx.id,
        {
          poolState: passenger.poolState ?? 'unknown',
          poolObservedAt: passenger.poolObservedAt,
          poolExcludedAt: passenger.poolExcludedAt,
          poolExcludedState: passenger.poolExcludedState,
        },
      ]),
    ),
  ))
    candidates.set(tx.id, tx);
  // Promotion changes a vehicle's position. Re-budget its retained riders at
  // that new position before allowing anyone to board or exit after arrival.
  const plan = planProjections(
    [...candidates.values()],
    state.candidateCapacity,
    state.feeThreshold,
    passengers,
    state.blockTemplate,
    state.ethereumProjection,
    new Map(
      state.passengers.map((passenger) => [
        passenger.tx.id,
        {
          poolState: passenger.poolState ?? 'unknown',
          poolObservedAt: passenger.poolObservedAt,
          poolExcludedAt: passenger.poolExcludedAt,
          poolExcludedState: passenger.poolExcludedState,
        },
      ]),
    ),
    noncePlanningContext(
      {
        mode: state.context.startsWith('ethereum:live:') ? 'live' : 'demo',
        status: state.ethereumProjection ? 'ok' : 'stale',
        observedAt: state.archiveObservedAt,
        transactions: [],
        blocks:
          state.observedBlockHash !== null && state.observedBlockHeight !== null
            ? [{ hash: state.observedBlockHash, height: state.observedBlockHeight }]
            : [],
        ethereumDependencies: state.ethereumDependencies,
      },
      state.passengers,
      [...state.waitingArchiveTransactions.values()],
      state.pendingAdmissions,
      state.handledDepartures,
      new Map(
        state.passengers.map((passenger) => [
          passenger.tx.id,
          {
            poolState: passenger.poolState ?? 'unknown',
            poolObservedAt: passenger.poolObservedAt,
            poolExcludedAt: passenger.poolExcludedAt,
            poolExcludedState: passenger.poolExcludedState,
          },
        ]),
      ),
    ),
  );
  return {
    ...state,
    preparationStartedAt: null,
    preparationTransactions: [],
    handoffStartedAt: departureAt,
    lastDepartureStartedAt: departureAt,
    candidateArrivalStartedAt: null,
    departingPassengers,
    passengers: mapPassengers(passengers, (passenger) => ({
      ...passenger,
      ...admissionFor(passenger.tx, plan),
      seatIndex: passenger.seatIndex,
    })),
    pendingAdmissions: state.pendingAdmissions.map((admission) => admissionFor(admission.tx, plan)),
  };
}

function stationaryPassenger(passenger: Passenger, now: number): Passenger {
  const wagon = passenger.tx.status === 'pending' ? passenger.plannedWagon : null;
  const settled = {
    ...passenger,
    wagon,
    hasBoardedProjection: passenger.hasBoardedProjection || wagon !== null,
    seatIndex:
      wagon !== null && passenger.wagon === wagon
        ? passenger.seatIndex
        : passenger.plannedSeatIndex,
  };
  return {
    ...settled,
    inHandoff: false,
    phase: wagon ? 'boarded' : passenger.tx.status === 'confirmed' ? 'confirmed' : 'queue',
    phaseStartedAt: now,
    durationMs: 0,
    retryAt: now + QUEUE_RETRY_MS,
    path: [wagon ? wagonSeat(wagon, settled.seatIndex) : passengerQueuePoint(passenger)],
  };
}

/** Reduced motion consumes proved inclusions immediately and retains only unproved observations. */
function settleReducedMotion(state: PassengerMotionState): PassengerMotionState {
  const now = state.elapsedMs;
  const includedIds = receiptTransactionIds(state.handledDepartures);
  for (const id of activeDepartureTransactionIds(state)) includedIds.add(id);
  const residents = new Map<string, Passenger>();
  const occupiedQueueSlots = new Set(state.passengers.map((passenger) => passenger.queueIndex));
  const nextQueueIndex = () => {
    let index = 0;
    while (occupiedQueueSlots.has(index)) index += 1;
    occupiedQueueSlots.add(index);
    return index;
  };
  for (const passenger of state.passengers) {
    if (includedIds.has(passenger.tx.id)) continue;
    const retained = {
      ...passenger,
      departureIncluded: false,
      awaitingVerifiedDeparture: false,
      handoffPhase: undefined,
      joiningArchive: false,
      inHandoff: false,
    };
    residents.set(
      passenger.tx.id,
      passenger.presentInSample || passenger.plannedWagon
        ? stationaryPassenger(retained, now)
        : parkAtQueue(retained, now),
    );
  }
  const restoreObservation = (tx: Tx) => {
    if (includedIds.has(tx.id)) return;
    const existing = residents.get(tx.id);
    if (existing) {
      // A queued inclusion upgrades an already visible observation too.
      residents.set(
        tx.id,
        stationaryPassenger(
          {
            ...existing,
            tx,
            presentInSample: tx.status === 'confirmed' || existing.presentInSample,
            lastObservedAt: state.archiveObservedAt,
          },
          now,
        ),
      );
      return;
    }
    const queueIndex = nextQueueIndex();
    residents.set(tx.id, {
      tx,
      lastObservedAt: state.archiveObservedAt,
      queueIndex,
      seatIndex: 0,
      plannedSeatIndex: 0,
      plannedWagon: null,
      selectedForCandidate: false,
      reason: tx.status === 'confirmed' ? 'observed' : 'capacity',
      phase: 'parked',
      phaseStartedAt: now,
      durationMs: 0,
      retryAt: now + QUEUE_RETRY_MS,
      path: [queuePosition(queueIndex, state.queueLayout)],
      wagon: null,
      inHandoff: false,
      presentInSample: tx.status === 'confirmed',
    });
  };
  // An unproved observation keeps its exact prior status. A verified departing
  // cohort is consumed above instead of reappearing as people waiting on the quay.
  for (const pose of state.departingPassengers) restoreObservation(pose.tx);
  for (const tx of state.preparationTransactions) restoreObservation(tx);
  for (const observation of state.queuedDepartures)
    for (const tx of observation.transactions) restoreObservation(tx);
  for (const admission of state.pendingAdmissions) {
    if (includedIds.has(admission.tx.id)) continue;
    if (residents.has(admission.tx.id)) continue;
    if (admission.tx.status === 'confirmed') {
      restoreObservation(admission.tx);
      continue;
    }
    const queueIndex = nextQueueIndex();
    const passenger: Passenger = {
      ...admission,
      lastObservedAt: state.archiveObservedAt,
      queueIndex,
      seatIndex: admission.plannedSeatIndex,
      phase: 'queue',
      phaseStartedAt: now,
      durationMs: 0,
      retryAt: now + QUEUE_RETRY_MS,
      path: [queuePosition(queueIndex, state.queueLayout)],
      wagon: null,
      inHandoff: false,
      presentInSample: true,
    };
    residents.set(passenger.tx.id, stationaryPassenger(passenger, now));
  }
  // A refresh can leave the regular residents plus a departing cohort. Their
  // collective illustration keeps every surplus observation represented while
  // the SVG and individual ID storage retain the same strict memory bound.
  const currentObservations = [...residents.values()]
    .filter((passenger) => passenger.presentInSample)
    .sort(
      (left, right) =>
        Number(right.selectedForCandidate) - Number(left.selectedForCandidate) ||
        Number(right.tx.status === 'pending') - Number(left.tx.status === 'pending'),
    );
  const current = currentObservations.slice(0, MAX_RESIDENT_PASSENGERS);
  const overflowObservations = currentObservations
    .slice(MAX_RESIDENT_PASSENGERS)
    .map((passenger) => parkAtQueue({ ...passenger, presentInSample: false }, now));
  const history = [...residents.values()]
    .filter((passenger) => !passenger.presentInSample)
    .concat(overflowObservations)
    .sort(
      (left, right) =>
        Number(left.plannedWagon !== null) - Number(right.plannedWagon !== null) ||
        (left.lastObservedAt ?? 0) - (right.lastObservedAt ?? 0) ||
        left.phaseStartedAt - right.phaseStartedAt ||
        left.queueIndex - right.queueIndex,
    );
  const historyCapacity = Math.max(
    0,
    Math.min(MAX_INDIVIDUAL_HISTORY, MAX_RESIDENT_PASSENGERS - current.length),
  );
  const groupedCount = Math.max(0, history.length - historyCapacity);
  const passengers = alignWaitingQueue(
    [...current, ...history.slice(groupedCount)],
    now,
    state.queueLayout,
    true,
  );
  return {
    ...state,
    ...projectionOccupancy(passengers),
    preparationStartedAt: null,
    preparationTransactions: [],
    handoffStartedAt: null,
    candidateArrivalStartedAt: null,
    departingPassengers: [],
    departingBlock: null,
    queuedDeparture: null,
    queuedDepartures: [],
    pendingAdmissions: [],
    ...retainWaitingArchive(
      {
        ...state,
        waitingArchiveTransactions: new Map(
          [...state.waitingArchiveTransactions].map(([id, observation]) => [
            id,
            { ...observation, reservedBlockHash: undefined },
          ]),
        ),
      },
      history.slice(0, groupedCount).map((passenger) => ({
        tx: passenger.tx,
        nonceDependency: passenger.nonceDependency,
        lastSeenAt: passenger.lastObservedAt ?? state.archiveObservedAt,
      })),
      [...includedIds, ...passengers.map((passenger) => passenger.tx.id)],
    ),
    passengers,
  };
}

function advancePassenger(
  passenger: Passenger,
  now: number,
  previousTime: number,
  handoffMoving: boolean,
  laterMoving: boolean,
  preparing: boolean,
): Passenger {
  const target = passenger.wagon ?? passenger.plannedWagon;
  const moving = handoffMoving || (laterMoving && target === 'later');
  if (
    moving &&
    !passenger.inHandoff &&
    passenger.wagon &&
    ['boarding', 'exiting'].includes(passenger.phase)
  )
    return { ...passenger, phaseStartedAt: passenger.phaseStartedAt + now - previousTime };
  if (
    !passenger.hasBoardedProjection &&
    passenger.tx.status === 'pending' &&
    hasBoardedProjection(passenger, now)
  )
    passenger = { ...passenger, hasBoardedProjection: true };
  if (passenger.inHandoff) {
    if (now - passenger.phaseStartedAt < HANDOFF_DURATION_MS) return passenger;
    const point = passengerPosition(passenger, now);
    const landed: Passenger = {
      ...passenger,
      wagon: 'next',
      inHandoff: false,
      phase: 'boarded',
      path: [point],
      phaseStartedAt: now,
      durationMs: 0,
      handoffPhase: undefined,
    };
    if (
      passenger.handoffPhase === 'exiting' ||
      passenger.plannedWagon !== 'next' ||
      passenger.tx.status !== 'pending'
    )
      return startExit(landed, now, point);
    if (passenger.handoffPhase === 'boarding') {
      return startPhase(landed, 'boarding', now, [point, wagonSeat('next', landed.seatIndex)], 400);
    }
    return landed;
  }
  if (['parked', 'boarded', 'confirmed'].includes(passenger.phase)) return passenger;
  if (passenger.phase === 'retiring')
    return startReturning(passenger, now, passengerPosition(passenger, now));
  if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
  const point = passengerPosition(passenger, now);
  if (passenger.phase === 'preparing')
    return {
      ...startPhase(passenger, 'confirmed', now, [wagonSeat('next', passenger.seatIndex)], 0),
      wagon: 'next',
    };
  if (passenger.phase === 'reordering')
    return {
      ...startPhase(passenger, waitingPhase(passenger), now, [point], 0),
      retryAt: now + 300,
    };
  if (passenger.phase === 'arriving') {
    if (
      !passenger.presentInSample &&
      !passenger.plannedWagon &&
      waitingQueueZone(passenger) === 'history'
    )
      return parkAtQueue(passenger, now);
    return {
      ...startPhase(
        passenger,
        passenger.tx.status === 'confirmed' ? 'confirmed' : 'queue',
        now,
        [point],
        0,
      ),
      wagon: null,
      retryAt: now + (stableHash(passenger.tx.id) % 190),
    };
  }
  if (passenger.phase === 'queue') {
    if (
      !passenger.presentInSample &&
      !passenger.plannedWagon &&
      waitingQueueZone(passenger) === 'history'
    )
      return parkAtQueue(passenger, now);
    if (moving || preparing || now < passenger.retryAt || !passenger.plannedWagon) return passenger;
    return startWalking(passenger, now, point);
  }
  if (passenger.phase === 'walking') {
    if (moving || (preparing && passenger.plannedWagon === 'next')) return passenger;
    if (!passenger.plannedWagon || passenger.tx.status !== 'pending')
      return startReturning(passenger, now, point);
    const boarding = {
      ...passenger,
      wagon: passenger.plannedWagon,
      seatIndex: passenger.plannedSeatIndex,
    };
    return startPhase(
      boarding,
      'boarding',
      now,
      [
        point,
        entryDoorPoint(passenger.plannedWagon),
        wagonSeat(passenger.plannedWagon, boarding.seatIndex),
      ],
      1_000,
    );
  }
  if (passenger.phase === 'boarding') {
    if (moving) return passenger;
    return startPhase(
      passenger,
      'boarded',
      now,
      [wagonSeat(passenger.wagon ?? 'next', passenger.seatIndex)],
      0,
    );
  }
  if (passenger.phase === 'exiting') {
    if (moving) return passenger;
    return startReturning(passenger, now, point);
  }
  if (passenger.phase === 'returning') {
    if (!passenger.presentInSample) {
      if (passenger.joiningArchive)
        return {
          ...startPhase(passenger, 'parked', now, [WAITING_ARCHIVE_POSITION], 0),
          wagon: null,
        };
      if (!passenger.plannedWagon) return parkAtQueue(passenger, now);
    }
    return {
      ...startPhase(
        passenger,
        passenger.tx.status === 'confirmed' ? 'confirmed' : 'queue',
        now,
        [point],
        0,
      ),
      wagon: null,
      retryAt: now + (passenger.plannedWagon ? 300 : QUEUE_RETRY_MS),
    };
  }
  return passenger;
}

/** The same bounded clock drives preparation, vehicles, doors and pedestrian passages. */
export function advancePassengerMotion(
  state: PassengerMotionState,
  deltaMs: number,
  { paused = false, hidden = false, reducedMotion = false, speed = 1 }: PassengerClockOptions = {},
): PassengerMotionState {
  if (reducedMotion) return settleReducedMotion(state);
  if (paused || hidden || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const elapsedMs =
    state.elapsedMs +
    Math.min(MAX_STEP_MS, deltaMs) *
      (Number.isFinite(speed) ? Math.max(0.5, Math.min(10, speed)) : 1);
  let workingState = state;
  if (state.preparationStartedAt !== null) {
    workingState = prepareForDeparture(state, state.elapsedMs);
    // Settle exits and fast boarding while the first vehicle is still stationary.
    workingState = prepareForDeparture(
      {
        ...workingState,
        passengers: mapPassengers(workingState.passengers, (passenger) =>
          advancePassenger(passenger, elapsedMs, state.elapsedMs, false, false, true),
        ),
      },
      elapsedMs,
    );
    if (elapsedMs - state.preparationStartedAt >= statePreparationDurationMs(state)) {
      const included = preparationInclusions(workingState.preparationTransactions);
      const readyIds = new Set<string>();
      for (const passenger of workingState.passengers) {
        if (
          passenger.departureIncluded &&
          passenger.wagon === 'next' &&
          passenger.phase === 'confirmed'
        )
          readyIds.add(passenger.tx.id);
      }
      let allIncludedReady = true;
      for (const id of included.keys()) {
        if (readyIds.has(id)) continue;
        allIncludedReady = false;
        break;
      }
      const allExcludedOutside = workingState.passengers.every(
        (passenger) => passenger.departureIncluded || !isRider(passenger, 'next', elapsedMs),
      );
      const allPromotedRidersEligible =
        workingState.blockTemplate === null ||
        workingState.passengers.every(
          (passenger) =>
            passenger.plannedWagon === 'next' || !isRider(passenger, 'later', elapsedMs),
        );
      if (allIncludedReady && allExcludedOutside && allPromotedRidersEligible)
        workingState = departPreparedWagons(workingState, elapsedMs);
    }
  }
  const handoffAt = workingState.handoffStartedAt;
  const handoffMoving = handoffAt !== null && elapsedMs - handoffAt < HANDOFF_DURATION_MS;
  const arrivalAt =
    handoffAt !== null && !handoffMoving
      ? handoffAt + HANDOFF_DURATION_MS
      : workingState.candidateArrivalStartedAt;
  const candidateArrivalStartedAt =
    arrivalAt !== null && elapsedMs - arrivalAt < CANDIDATE_ARRIVAL_DURATION_MS ? arrivalAt : null;
  const advanced = mapPassengers(workingState.passengers, (passenger) =>
    advancePassenger(
      passenger,
      elapsedMs,
      state.elapsedMs,
      handoffMoving,
      candidateArrivalStartedAt !== null,
      workingState.preparationStartedAt !== null,
    ),
  );
  const grouped = groupWaitingObservations(advanced, workingState, elapsedMs);
  const blockedIds = handoffMoving
    ? departingTransactionIds(workingState.departingPassengers)
    : new Set<string>();
  const admitted = admitPassengers(
    grouped.passengers,
    workingState.pendingAdmissions,
    elapsedMs,
    blockedIds,
    grouped,
    workingState.preparationStartedAt !== null
      ? MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS
      : MAX_RESIDENT_PASSENGERS,
    workingState.queueLayout,
  );
  let next: PassengerMotionState = {
    ...workingState,
    ...admitted,
    elapsedMs,
    handoffStartedAt: handoffMoving ? handoffAt : null,
    candidateArrivalStartedAt,
    departingPassengers: handoffMoving ? workingState.departingPassengers : [],
    departingBlock:
      handoffMoving || workingState.preparationStartedAt !== null
        ? workingState.departingBlock
        : null,
    ...retainWaitingArchive(grouped, [], residentTransactionIds(admitted.passengers)),
    ...projectionOccupancy(admitted.passengers),
  };
  if (next.preparationStartedAt !== null) next = prepareForDeparture(next, elapsedMs);
  else if (!handoffMoving) {
    next.passengers = mapPassengers(next.passengers, (passenger) =>
      reconcileDesiredPassenger(
        passenger,
        elapsedMs,
        candidateArrivalStartedAt !== null &&
          (passenger.wagon ?? passenger.plannedWagon) === 'later',
      ),
    );
    if (next.queuedDepartures.length && candidateArrivalStartedAt === null) {
      const [observation, ...remaining] = next.queuedDepartures;
      next.queuedDepartures = remaining;
      next.queuedDeparture = remaining[0] ?? null;
      if (!observation) return next;
      next = beginPreparation(next, observation);
    }
  }
  if (next.preparationStartedAt === null)
    next.passengers = alignWaitingQueue(next.passengers, elapsedMs, next.queueLayout);
  if (!handoffMoving && workingState.departingPassengers.length)
    next = discardCompletedObservations(next);
  return next;
}

function passengerPose(passenger: Passenger, elapsedMs: number): PassengerPose {
  const progress =
    passenger.durationMs > 0
      ? Math.min(1, Math.max(0, (elapsedMs - passenger.phaseStartedAt) / passenger.durationMs))
      : 1;
  // Only an identified, newly discovered inclusion waits unseen behind the network
  // door. Existing travellers keep their visibility and their original positions.
  const opacity =
    passenger.arrivalKind === 'late-inclusion' &&
    passenger.phase === 'preparing' &&
    passenger.departureIncluded &&
    (passenger.networkDoorLeadMs ?? 0) > 0 &&
    elapsedMs < passenger.phaseStartedAt
      ? 0
      : 1;
  const cached = passengerPoseCache.get(passenger);
  if (cached?.pose.progress === progress && cached.pose.opacity === opacity) {
    const walking = WALKING_PHASES.has(passenger.phase) && progress > 0 && progress < 1;
    if (!walking || cached.elapsedMs === elapsedMs) return cached.pose;
  }
  const point = passengerPosition(passenger, elapsedMs);
  const queue = passengerQueuePoint(passenger);
  const inWagon =
    passenger.wagon !== null &&
    (passenger.inHandoff ||
      ['boarded', 'confirmed'].includes(passenger.phase) ||
      (['boarding', 'preparing', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)));
  const from = passenger.path[0] ?? point;
  const to = passenger.path[passenger.path.length - 1] ?? point;
  const appearance = transactionAppearance(passenger.tx);
  const walking = WALKING_PHASES.has(passenger.phase) && progress > 0 && progress < 1;
  const pose: PassengerPose = {
    tx: passenger.tx,
    nonceDependency: passenger.nonceDependency,
    arrivalKind: passenger.arrivalKind,
    lastObservedAt: passenger.lastObservedAt,
    poolState: passenger.poolState,
    poolObservedAt: passenger.poolObservedAt,
    bitcoinArrival: passenger.bitcoinArrival,
    ...point,
    queueX: queue.x,
    queueY: queue.y,
    queueZone: passenger.queueZone,
    phase: passenger.phase,
    destination: passenger.departureIncluded ? 'next' : (passenger.plannedWagon ?? 'queue'),
    reason: passenger.reason,
    selectedForCandidate: passenger.selectedForCandidate,
    inWagon,
    wagon: passenger.wagon,
    inHandoff: passenger.inHandoff,
    sourceObserved: passenger.presentInSample || passenger.awaitingVerifiedDeparture === true,
    headScale: appearance.headScale,
    resourceUnits: appearance.resourceUnits,
    opacity,
    progress,
    facing: to.x < from.x ? -1 : 1,
    movementAngle: pathHeadingDegrees(passenger.path, progress),
    trail:
      walking &&
      !inWagon &&
      !passenger.inHandoff &&
      passenger.phase === 'preparing' &&
      passenger.departureIncluded &&
      (passenger.networkDoorLeadMs ?? 0) > 0
        ? passengerTrail(passenger.path, progress, point)
        : undefined,
    // Waiting people have no gait to redraw. Moving people keep the same walking rhythm.
    walkPhase: walking ? (elapsedMs / 160 + (appearance.hash % 7)) % (Math.PI * 2) : 0,
  };
  passengerPoseCache.set(passenger, { elapsedMs, pose });
  return pose;
}

/** Open before emergence, hold through the vestibule, then close on the same clock. */
function passengerNetworkDoorProgress(passenger: Passenger, elapsedMs: number): number {
  const leadMs = passenger.networkDoorLeadMs;
  if (
    passenger.arrivalKind !== 'late-inclusion' ||
    passenger.phase !== 'preparing' ||
    leadMs === undefined ||
    leadMs <= 0
  )
    return 0;
  const openingAt = passenger.phaseStartedAt - leadMs;
  const timingScale = Math.min(1, leadMs / NETWORK_DOOR_BEFORE_PASSAGE_MS);
  const openingDuration = Math.min(NETWORK_DOOR_OPEN_MS, leadMs / 2);
  const opening = Math.max(0, Math.min(1, (elapsedMs - openingAt) / openingDuration));
  if (elapsedMs < passenger.phaseStartedAt) return opening;
  const { distance, lengths } = pathGeometry(passenger.path);
  // The head/body must clear the lower doorway and its lateral edge before closing.
  const clearDistance =
    (lengths[0] ?? 0) + Math.min(lengths[1] ?? 0, NETWORK_BOX_RECT.width / 2 + 24);
  const clearedAt =
    passenger.phaseStartedAt +
    (distance > 0 ? (passenger.durationMs * clearDistance) / distance : 0);
  const closingAt = clearedAt + NETWORK_DOOR_AFTER_PASSAGE_MS * timingScale;
  return elapsedMs <= closingAt
    ? opening
    : Math.max(0, 1 - (elapsedMs - closingAt) / (NETWORK_DOOR_CLOSE_MS * timingScale));
}

export function passengerFrame(state: PassengerMotionState): PassengerFrame {
  const counts: Record<PassengerPhase, number> = {
    arriving: 0,
    queue: 0,
    reordering: 0,
    parked: 0,
    walking: 0,
    boarding: 0,
    preparing: 0,
    boarded: 0,
    exiting: 0,
    returning: 0,
    retiring: 0,
    confirmed: 0,
  };
  const doors: PassengerFrame['doors'] = {
    next: { entry: state.preparationStartedAt !== null, exit: false },
    later: { entry: false, exit: false },
  };
  const previousPoses = passengerCollectionPoseCache.get(state.passengers);
  let unchangedPoses = previousPoses !== undefined;
  let preparationPassengerCount = 0;
  let networkDoorProgress = 0;
  let networkActive = false;
  let passengers = state.passengers.map((passenger, index): PassengerPose => {
    if (passenger.presentInSample) counts[passenger.phase] += 1;
    else if (passenger.phase === 'parked') counts.parked += 1;
    else counts.retiring += 1;
    if (passenger.departureIncluded) preparationPassengerCount += 1;
    networkDoorProgress = Math.max(
      networkDoorProgress,
      passengerNetworkDoorProgress(passenger, state.elapsedMs),
    );
    if (
      state.preparationStartedAt !== null &&
      passenger.phase === 'preparing' &&
      passenger.departureIncluded &&
      (passenger.networkDoorLeadMs ?? 0) > 0
    )
      networkActive = true;
    const moving =
      state.handoffStartedAt !== null ||
      (state.candidateArrivalStartedAt !== null && passenger.wagon === 'later');
    if (!moving && passenger.wagon) {
      if (['boarding', 'preparing'].includes(passenger.phase)) doors[passenger.wagon].entry = true;
      if (passenger.phase === 'exiting') doors[passenger.wagon].exit = true;
    }
    const pose = passengerPose(passenger, state.elapsedMs);
    if (pose !== previousPoses?.[index]) unchangedPoses = false;
    return pose;
  });
  if (unchangedPoses) passengers = previousPoses!;
  else passengerCollectionPoseCache.set(state.passengers, passengers);
  const laterArrivalProgress =
    state.candidateArrivalStartedAt === null
      ? null
      : Math.min(
          1,
          Math.max(
            0,
            (state.elapsedMs - state.candidateArrivalStartedAt) / CANDIDATE_ARRIVAL_DURATION_MS,
          ),
        );
  return {
    passengers,
    departingPassengers: state.departingPassengers,
    departingBlock: state.departingBlock,
    departureRecovered: state.departureRecovered,
    lastDepartureStartedAt: state.lastDepartureStartedAt ?? null,
    counts,
    candidateCount: state.candidateCount,
    candidateUsed: state.candidateUsed,
    candidateCapacity: state.candidateCapacity,
    projectionCount: state.projectionCount,
    projectionUsed: state.projectionUsed,
    feeThreshold: state.feeThreshold,
    elapsedMs: state.elapsedMs,
    preparationProgress:
      state.preparationStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(
              0,
              (state.elapsedMs - state.preparationStartedAt) / statePreparationDurationMs(state),
            ),
          ),
    preparationPassengerCount,
    networkDoorProgress,
    networkActive,
    waitingArchiveCount: state.waitingArchiveCount,
    waitingArchiveTrackedCount: state.waitingArchiveTransactions.size,
    waitingArchiveUnknownCount: state.waitingArchiveUnknownCount,
    handoffProgress:
      state.handoffStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(0, (state.elapsedMs - state.handoffStartedAt) / HANDOFF_DURATION_MS),
          ),
    laterArrivalProgress,
    candidateArrivalProgress: laterArrivalProgress,
    doors,
  };
}
