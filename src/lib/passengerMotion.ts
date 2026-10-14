import {
  MAX_INCLUSION_BLOCKS,
  PENDING_SAMPLE_LIMIT,
  TRACKED_TRANSACTION_TTL_MS,
  type Block,
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
  HISTORY_QUEUE_START,
  PLATFORM_CORRIDOR_X,
  WAGON_SEAT_COUNT,
  queuePosition,
  wagonSeat,
  type StreetPoint,
  type WagonKind,
} from './streetGeometry';

export const MAX_PASSENGERS = PENDING_SAMPLE_LIMIT;
export const MAX_RESIDENT_PASSENGERS = MAX_PASSENGERS * 2;
const MAX_INDIVIDUAL_HISTORY = MAX_PASSENGERS;
export const MAX_ARCHIVED_OBSERVATIONS = 512;
const MAX_DEPARTURE_PASSENGERS =
  MAX_RESIDENT_PASSENGERS + MAX_ARCHIVED_OBSERVATIONS + MAX_PASSENGERS;
export const MAX_WAITING_ARCHIVE_COUNT = 1_000_000;
export const WAITING_ARCHIVE_POSITION: StreetPoint = { x: 360, y: 686 };
/** This illustrated budget does not describe either chain's consensus capacity. */
export const CANDIDATE_CAPACITY = WAGON_SEAT_COUNT;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 1_200;
export const PREPARATION_DURATION_MS = 1_000;
const FAST_EXIT_DURATION_MS = 500;
const MIN_PREPARATION_PASSAGE_MS = 50;
export const CANDIDATE_ARRIVAL_DURATION_MS = 700;
const GEOMETRY_VERSION = 'outer-platform-arrival-queue-v13';

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
export type PassengerReason = 'accepted' | 'fee' | 'capacity' | 'observed';

interface Passenger {
  tx: Tx;
  lastObservedAt?: number;
  queueIndex: number;
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
  /** Only source-confirmed transactions associated with this departing block may leave aboard. */
  departureIncluded?: boolean;
  awaitingVerifiedDeparture?: boolean;
}

interface PassengerAdmission {
  tx: Tx;
  plannedSeatIndex: number;
  plannedWagon: WagonKind | null;
  selectedForCandidate: boolean;
  reason: PassengerReason;
}

interface DepartureObservation {
  block: Pick<Block, 'hash' | 'height'>;
  transactions: Tx[];
  recovered?: boolean;
}

interface ArchivedObservation {
  tx: Tx;
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
  elapsedMs: number;
  observedBlockHash: string | null;
  observedBlockHeight: number | null;
  initialBlockHeight: number | null;
  preparationStartedAt: number | null;
  handoffStartedAt: number | null;
  /** Persistent animation-clock marker for the last vehicle departure, not a block timestamp. */
  lastDepartureStartedAt: number | null;
  candidateArrivalStartedAt: number | null;
  departingBlock: Pick<Block, 'hash' | 'height'> | null;
  departureRecovered: boolean;
  preparationTransactions: Tx[];
  queuedDeparture: DepartureObservation | null;
  queuedDepartures: DepartureObservation[];
  handledDepartures: DepartureReceipt[];
  feeThreshold: number | null;
  candidateCount: number;
  candidateUsed: number;
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
  x: number;
  y: number;
  queueX: number;
  queueY: number;
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
  walkPhase: number;
}

export interface PassengerFrame {
  passengers: PassengerPose[];
  departingPassengers: PassengerPose[];
  departingBlock: Pick<Block, 'hash' | 'height'> | null;
  departureRecovered: boolean;
  lastDepartureStartedAt: number | null;
  counts: Record<PassengerPhase, number>;
  candidateCount: number;
  candidateUsed: number;
  candidateCapacity: number;
  projectionCount: Record<WagonKind, number>;
  projectionUsed: Record<WagonKind, number>;
  feeThreshold: number | null;
  elapsedMs: number;
  preparationProgress: number | null;
  preparationPassengerCount: number;
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

/** Keep an unchanged collection and its passengers reusable by the SVG renderer. */
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

function motionContext(snapshot: Snapshot): string {
  return `${snapshot.chain}:${snapshot.mode}:${GEOMETRY_VERSION}`;
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
  return Math.max(0.8, Math.min(1.85, 0.8 + Math.log2(1 + size / reference) * 0.31));
}

export function transactionResourceUnits(tx: Pick<Tx, 'chain' | 'size'>): number {
  const reference = tx.chain === 'bitcoin' ? 400 : 100_000;
  const size = Number.isFinite(tx.size) ? Math.max(0, tx.size) : 0;
  return Math.max(1, Math.min(3, Math.ceil(size / reference)));
}

function planSnapshot(snapshot: Snapshot) {
  const sourceTransactions = [...snapshot.transactions]
    .sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id))
    .filter((tx, index, array) => array.findIndex((other) => other.id === tx.id) === index);
  // Historical confirmations are not a third queue of projection candidates.
  const transactions = sourceTransactions
    .filter((tx) => tx.status === 'pending')
    .slice(0, MAX_PASSENGERS);
  const admitted = new Map<string, { wagon: WagonKind; seat: number }>();
  const reasons = new Map<string, PassengerReason>();
  const used: Record<WagonKind, number> = { next: 0, later: 0 };
  const count: Record<WagonKind, number> = { next: 0, later: 0 };
  for (const tx of transactions) {
    if (tx.feeRate < (snapshot.feeRate ?? 0)) {
      reasons.set(tx.id, 'fee');
      continue;
    }
    const units = transactionResourceUnits(tx);
    const wagon: WagonKind | null =
      used.next + units <= CANDIDATE_CAPACITY
        ? 'next'
        : used.later + units <= CANDIDATE_CAPACITY
          ? 'later'
          : null;
    if (wagon) {
      admitted.set(tx.id, { wagon, seat: count[wagon]++ });
      used[wagon] += units;
      reasons.set(tx.id, 'accepted');
    } else reasons.set(tx.id, 'capacity');
  }
  return {
    transactions,
    sourceTransactions,
    admitted,
    reasons,
    used,
    count,
    feeThreshold: snapshot.feeRate,
  };
}

function admissionFor(tx: Tx, plan: ReturnType<typeof planSnapshot>): PassengerAdmission {
  const projection = plan.admitted.get(tx.id);
  return {
    tx,
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
    if (!passenger.presentInSample || !passenger.plannedWagon) continue;
    projectionCount[passenger.plannedWagon] += 1;
    projectionUsed[passenger.plannedWagon] += transactionResourceUnits(passenger.tx);
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
  return { ...passenger, inHandoff: false, phase, phaseStartedAt: now, durationMs, path };
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
  const path = platformPath(from, queuePosition(passenger.queueIndex));
  return { ...startPhase(passenger, 'returning', now, path, pathDuration(path)), wagon: null };
}

function parkAtQueue(passenger: Passenger, now: number): Passenger {
  return {
    ...startPhase(passenger, 'parked', now, [passengerPosition(passenger, now)], 0),
    wagon: null,
    plannedWagon: null,
    selectedForCandidate: false,
    joiningArchive: false,
  };
}

function alignWaitingQueue(passengers: Passenger[], now: number, instant = false): Passenger[] {
  // Only reappearing historical IDs need a new current queue slot. Existing arrivals keep theirs.
  const returningToSample = passengers
    .filter(
      (passenger) =>
        passenger.presentInSample &&
        passenger.tx.status === 'pending' &&
        passenger.queueIndex >= HISTORY_QUEUE_START &&
        !passenger.wagon &&
        !passenger.inHandoff &&
        !passenger.departureIncluded &&
        !passenger.awaitingVerifiedDeparture,
    )
    .sort(
      (left, right) => right.tx.feeRate - left.tx.feeRate || left.tx.id.localeCompare(right.tx.id),
    );
  const restoredSlots = new Map<string, number>();
  if (returningToSample.length) {
    const occupied = new Set(
      passengers
        .filter(
          (passenger) => passenger.presentInSample && passenger.queueIndex < HISTORY_QUEUE_START,
        )
        .map((passenger) => passenger.queueIndex),
    );
    for (const passenger of returningToSample) {
      let slot = 0;
      while (occupied.has(slot) && slot < HISTORY_QUEUE_START) slot += 1;
      if (slot === HISTORY_QUEUE_START) break;
      occupied.add(slot);
      restoredSlots.set(passenger.tx.id, slot);
    }
  }
  return mapPassengers(passengers, (passenger) => {
    if (
      passenger.wagon ||
      passenger.inHandoff ||
      passenger.departureIncluded ||
      passenger.awaitingVerifiedDeparture ||
      passenger.joiningArchive
    )
      return passenger;
    const queueIndex =
      restoredSlots.get(passenger.tx.id) ??
      (!passenger.presentInSample
        ? passenger.queueIndex >= HISTORY_QUEUE_START
          ? passenger.queueIndex
          : HISTORY_QUEUE_START + (stableHash(passenger.tx.id) % MAX_PASSENGERS)
        : passenger.queueIndex);
    const updated = queueIndex === passenger.queueIndex ? passenger : { ...passenger, queueIndex };
    const phase = passenger.presentInSample ? 'queue' : 'parked';
    const target = queuePosition(queueIndex);
    const point = passengerPosition(passenger, now);
    if (instant && ['queue', 'parked', 'reordering'].includes(passenger.phase))
      return startPhase(updated, phase, now, [target], 0);
    // Arrivals, door passages and returns finish their captured path before changing places.
    if (!['queue', 'parked', 'reordering'].includes(passenger.phase)) return updated;
    if (Math.hypot(point.x - target.x, point.y - target.y) < 0.5)
      return passenger.phase === 'reordering'
        ? { ...startPhase(updated, phase, now, [target], 0), retryAt: now + 300 }
        : updated;
    const end = passenger.path[passenger.path.length - 1];
    if (passenger.phase === 'reordering' && end?.x === target.x && end.y === target.y)
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
  });
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
  removals: string[] = [],
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
        (passenger) => passenger.phase === 'parked' && !passenger.wagon && !passenger.inHandoff,
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
): { passengers: Passenger[]; pendingAdmissions: PassengerAdmission[] } {
  if (admissions.length === 0) return { passengers: residents, pendingAdmissions: admissions };
  const passengers = [...residents];
  const occupied = new Set(
    residents
      .filter(
        (passenger) =>
          passenger.presentInSample ||
          passenger.wagon !== null ||
          passenger.inHandoff ||
          passenger.departureIncluded ||
          passenger.awaitingVerifiedDeparture,
      )
      .map((passenger) => passenger.queueIndex),
  );
  const residentIds = new Set(residents.map((passenger) => passenger.tx.id));
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
  for (const admission of incoming.slice(0, MAX_PASSENGERS)) {
    if (residentIds.has(admission.tx.id)) continue;
    if (passengers.length >= residentLimit || blockedIds.has(admission.tx.id)) {
      pendingAdmissions.push(admission);
      continue;
    }
    let queueIndex = 0;
    while (occupied.has(queueIndex)) queueIndex += 1;
    occupied.add(queueIndex);
    residentIds.add(admission.tx.id);
    const queue = queuePosition(queueIndex);
    const archived = archive.waitingArchiveTransactions.get(admission.tx.id);
    const path = archived ? [WAITING_ARCHIVE_POSITION] : [arrivalStart(queueIndex), queue];
    passengers.push({
      ...admission,
      queueIndex,
      seatIndex: admission.plannedSeatIndex,
      phase: archived ? 'parked' : 'arriving',
      phaseStartedAt: archived
        ? now
        : now + arrivalIndex++ * 90 + (stableHash(admission.tx.id) % 120),
      durationMs: archived ? 0 : pathDuration(path),
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
    block: { hash: block.hash, height: block.height },
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
      return {
        ...observation,
        recovered: Boolean(handled) || observation.block.height < (snapshot.blocks[0]?.height ?? 0),
        transactions: observation.transactions
          .filter((tx) => !handledIds.has(tx.id))
          .slice(0, MAX_DEPARTURE_PASSENGERS),
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

function prepareForDeparture(state: PassengerMotionState, now: number): PassengerMotionState {
  const remainingMs = Math.max(
    MIN_PREPARATION_PASSAGE_MS,
    Math.min(
      PREPARATION_DURATION_MS,
      (state.preparationStartedAt ?? now) + PREPARATION_DURATION_MS - now,
    ),
  );
  const exitMs = Math.min(FAST_EXIT_DURATION_MS, remainingMs);
  // Riders of the lower projection share this deadline between their exit and boarding above.
  const connectingExitMs = Math.max(MIN_PREPARATION_PASSAGE_MS, Math.min(exitMs, remainingMs / 2));
  const included = new Map(
    state.preparationTransactions.map((tx, index) => [tx.id, { tx, index }]),
  );
  const residentIds = new Set(state.passengers.map((passenger) => passenger.tx.id));
  const missing = state.preparationTransactions.filter((tx) => !residentIds.has(tx.id));
  const grouped = groupWaitingObservations(state.passengers, state, now, missing.length);
  const admissions = [
    ...missing.map((tx): PassengerAdmission => ({
      tx,
      plannedWagon: null,
      plannedSeatIndex: 0,
      selectedForCandidate: false,
      reason: 'observed',
    })),
    ...state.pendingAdmissions.filter((admission) => !included.has(admission.tx.id)),
  ];
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    now,
    new Set(),
    grouped,
    MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS,
  );
  const passengers = admitted.passengers.map((passenger) => {
    if (passenger.inHandoff) return passenger;
    const inclusion = included.get(passenger.tx.id);
    const point = passengerPosition(passenger, now);
    if (inclusion) {
      const updated = {
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
      // A rider of the second projection must first use that vehicle's lower door.
      // Its membership remains 'later' throughout this exit, so clipping and doors agree.
      if (passenger.wagon === 'later' && isInsideDoorway(point))
        return startPreparationExit(updated, now, point, connectingExitMs);
      const seat = wagonSeat('next', inclusion.index);
      const path =
        passenger.wagon === 'next' && isInsideDoorway(point)
          ? [point, seat]
          : [...platformPath(point, boardingApproach('next')), entryDoorPoint('next'), seat];
      return {
        ...startPhase(updated, 'preparing', now, path, remainingMs),
        wagon: 'next' as const,
        seatIndex: inclusion.index,
        handoffPhase: undefined,
      };
    }
    if (passenger.wagon === 'next' && isInsideDoorway(point))
      return startPreparationExit(passenger, now, point, exitMs);
    // Retained riders may free resident places during this stationary stop. Riders
    // still assigned to either projection stay in the lower vehicle for promotion.
    if (
      passenger.wagon === 'later' &&
      isInsideDoorway(point) &&
      (!passenger.presentInSample || !passenger.plannedWagon || passenger.tx.status === 'confirmed')
    )
      return startPreparationExit(passenger, now, point, exitMs);
    if (passenger.plannedWagon === 'next' && ['boarding', 'walking'].includes(passenger.phase))
      return startReturning(passenger, now, point);
    return passenger;
  });
  return {
    ...state,
    ...admitted,
    passengers,
    ...retainWaitingArchive(
      grouped,
      [],
      admitted.passengers.map((passenger) => passenger.tx.id),
    ),
  };
}

function beginPreparation(
  state: PassengerMotionState,
  observation: DepartureObservation,
): PassengerMotionState {
  // The source list is bounded, and IDs already in the scene keep their positions.
  const admissions = observation.transactions.map((tx): PassengerAdmission => ({
    tx,
    plannedWagon: null,
    plannedSeatIndex: 0,
    selectedForCandidate: false,
    reason: 'observed',
  }));
  const residentIds = new Set(state.passengers.map((passenger) => passenger.tx.id));
  const reserve = observation.transactions.filter((tx) => !residentIds.has(tx.id)).length;
  const grouped = groupWaitingObservations(state.passengers, state, state.elapsedMs, reserve);
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    state.elapsedMs,
    new Set(),
    grouped,
    MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS,
  );
  return prepareForDeparture(
    {
      ...state,
      ...admitted,
      ...retainWaitingArchive(
        grouped,
        [],
        admitted.passengers.map((passenger) => passenger.tx.id),
      ),
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

export function createPassengerMotion(snapshot: Snapshot): PassengerMotionState {
  const plan = planSnapshot(snapshot);
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
  );
  return {
    context: motionContext(snapshot),
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
    handledDepartures: initialDepartureReceipts(snapshot),
    departingPassengers: [],
    waitingArchiveCount: 0,
    waitingArchiveTransactions: new Map(),
    waitingArchiveUnknownCount: 0,
    archiveObservedAt: snapshot.observedAt,
    feeThreshold: plan.feeThreshold,
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
  if (!passenger.presentInSample) return waitOutsideSample(passenger, now);
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
  if (passenger.phase === 'parked')
    return { ...startPhase(passenger, 'queue', now, [point], 0), retryAt: now + QUEUE_RETRY_MS };
  return passenger;
}

export function reconcilePassengerMotion(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  if (state.context !== motionContext(snapshot)) return createPassengerMotion(snapshot);
  if (state.observedBlockHeight === null && snapshot.status === 'ok' && snapshot.blocks.length)
    return createPassengerMotion(snapshot);
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
  const plan = planSnapshot(snapshot);
  const previous = new Map(state.passengers.map((passenger) => [passenger.tx.id, passenger]));
  const nextIds = new Set(plan.sourceTransactions.map((tx) => tx.id));
  const departingIds = new Set(state.departingPassengers.map((pose) => pose.tx.id));
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
      lastObservedAt: snapshot.observedAt,
    });
  }
  for (const passenger of state.passengers) {
    if (nextIds.has(passenger.tx.id)) continue;
    passengers.push({
      ...passenger,
      presentInSample: false,
      plannedWagon: null,
      selectedForCandidate: false,
    });
  }
  const reservedArchive = new Map(state.waitingArchiveTransactions);
  const promised = new Map<string, Tx>();
  for (const tx of state.preparationTransactions) promised.set(tx.id, tx);
  for (const observation of [...state.queuedDepartures, ...observations])
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
  );
  let next: PassengerMotionState = {
    ...state,
    ...admitted,
    ...retainWaitingArchive(
      grouped,
      [],
      admitted.passengers.map((passenger) => passenger.tx.id),
    ),
    observedBlockHash:
      snapshot.status === 'ok'
        ? (snapshot.blocks[0]?.hash ?? state.observedBlockHash)
        : state.observedBlockHash,
    observedBlockHeight:
      snapshot.status === 'ok'
        ? (snapshot.blocks[0]?.height ?? state.observedBlockHeight)
        : state.observedBlockHeight,
    feeThreshold: plan.feeThreshold,
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
    } else {
      const queued = next.queuedDepartures.find(
        (item) => item.block.hash === observation.block.hash,
      );
      if (queued) {
        const included = new Map(queued.transactions.map((tx) => [tx.id, tx]));
        for (const tx of observation.transactions) included.set(tx.id, tx);
        queued.transactions = [...included.values()].slice(0, MAX_DEPARTURE_PASSENGERS);
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
  next.passengers = alignWaitingQueue(next.passengers, state.elapsedMs);
  if (next.preparationStartedAt !== null) return prepareForDeparture(next, state.elapsedMs);
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
  const departingPassengers = passengerFrame({ ...state, elapsedMs: departureAt })
    .passengers.filter(
      (pose) =>
        pose.inWagon &&
        pose.wagon === 'next' &&
        pose.tx.status === 'confirmed' &&
        pose.tx.blockHash === state.departingBlock?.hash,
    )
    .slice(0, MAX_DEPARTURE_PASSENGERS)
    .map((pose) => ({ ...pose, sourceObserved: false }));
  const departingIds = new Set(departingPassengers.map((pose) => pose.tx.id));
  return {
    ...state,
    preparationStartedAt: null,
    preparationTransactions: [],
    handoffStartedAt: departureAt,
    lastDepartureStartedAt: departureAt,
    candidateArrivalStartedAt: null,
    departingPassengers,
    passengers: state.passengers
      .filter((passenger) => !departingIds.has(passenger.tx.id))
      .map((passenger) =>
        isRider(passenger, 'later', departureAt)
          ? carryToNext(passenger, departureAt)
          : { ...passenger, departureIncluded: false },
      ),
  };
}

function stationaryPassenger(passenger: Passenger, now: number): Passenger {
  const wagon = passenger.tx.status === 'pending' ? passenger.plannedWagon : null;
  const settled = {
    ...passenger,
    wagon,
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
    path: [wagon ? wagonSeat(wagon, settled.seatIndex) : queuePosition(passenger.queueIndex)],
  };
}

/** Reduced motion retains observations on the platform instead of erasing a departing cohort. */
function settleReducedMotion(state: PassengerMotionState): PassengerMotionState {
  const now = state.elapsedMs;
  const residents = new Map<string, Passenger>();
  const occupiedQueueSlots = new Set(state.passengers.map((passenger) => passenger.queueIndex));
  const nextQueueIndex = () => {
    let index = 0;
    while (occupiedQueueSlots.has(index)) index += 1;
    occupiedQueueSlots.add(index);
    return index;
  };
  for (const passenger of state.passengers) {
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
      passenger.presentInSample ? stationaryPassenger(retained, now) : parkAtQueue(retained, now),
    );
  }
  const restoreObservation = (tx: Tx) => {
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
      path: [queuePosition(queueIndex)],
      wagon: null,
      inHandoff: false,
      presentInSample: tx.status === 'confirmed',
    });
  };
  // These exact statuses come from a prior source observation. They are retained
  // as historical observations, never silently relabelled as pending candidates.
  for (const pose of state.departingPassengers) restoreObservation(pose.tx);
  for (const tx of state.preparationTransactions) restoreObservation(tx);
  for (const observation of state.queuedDepartures)
    for (const tx of observation.transactions) restoreObservation(tx);
  for (const admission of state.pendingAdmissions) {
    if (residents.has(admission.tx.id)) continue;
    if (admission.tx.status === 'confirmed') {
      restoreObservation(admission.tx);
      continue;
    }
    const queueIndex = nextQueueIndex();
    const passenger: Passenger = {
      ...admission,
      queueIndex,
      seatIndex: admission.plannedSeatIndex,
      phase: 'queue',
      phaseStartedAt: now,
      durationMs: 0,
      retryAt: now + QUEUE_RETRY_MS,
      path: [queuePosition(queueIndex)],
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
        left.phaseStartedAt - right.phaseStartedAt || left.queueIndex - right.queueIndex,
    );
  const historyCapacity = Math.max(
    0,
    Math.min(MAX_INDIVIDUAL_HISTORY, MAX_RESIDENT_PASSENGERS - current.length),
  );
  const groupedCount = Math.max(0, history.length - historyCapacity);
  const passengers = alignWaitingQueue([...current, ...history.slice(groupedCount)], now, true);
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
        lastSeenAt: passenger.lastObservedAt ?? state.archiveObservedAt,
      })),
      passengers.map((passenger) => passenger.tx.id),
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
  const point = passengerPosition(passenger, now);
  if (passenger.inHandoff) {
    if (now - passenger.phaseStartedAt < HANDOFF_DURATION_MS) return passenger;
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
      !passenger.presentInSample ||
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
  if (passenger.phase === 'retiring') return startReturning(passenger, now, point);
  if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
  if (passenger.phase === 'preparing')
    return {
      ...startPhase(passenger, 'confirmed', now, [wagonSeat('next', passenger.seatIndex)], 0),
      wagon: 'next',
    };
  if (passenger.phase === 'reordering')
    return {
      ...startPhase(passenger, passenger.presentInSample ? 'queue' : 'parked', now, [point], 0),
      retryAt: now + 300,
    };
  if (passenger.phase === 'arriving') {
    if (!passenger.presentInSample) return parkAtQueue(passenger, now);
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
    if (!passenger.presentInSample) return parkAtQueue(passenger, now);
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
      return parkAtQueue(passenger, now);
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
      (Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1);
  let workingState = state;
  if (state.preparationStartedAt !== null) {
    workingState = prepareForDeparture(state, state.elapsedMs);
    // Settle exits and fast boarding while the first vehicle is still stationary.
    workingState = prepareForDeparture(
      {
        ...workingState,
        passengers: workingState.passengers.map((passenger) =>
          advancePassenger(passenger, elapsedMs, state.elapsedMs, false, false, true),
        ),
      },
      elapsedMs,
    );
    const includedIds = new Set(workingState.preparationTransactions.map((tx) => tx.id));
    const readyIds = new Set(
      workingState.passengers
        .filter(
          (passenger) =>
            passenger.departureIncluded &&
            passenger.wagon === 'next' &&
            passenger.phase === 'confirmed',
        )
        .map((passenger) => passenger.tx.id),
    );
    const allIncludedReady = [...includedIds].every((id) => readyIds.has(id));
    const allExcludedOutside = workingState.passengers.every(
      (passenger) => passenger.departureIncluded || !isRider(passenger, 'next', elapsedMs),
    );
    if (
      elapsedMs - state.preparationStartedAt >= PREPARATION_DURATION_MS &&
      allIncludedReady &&
      allExcludedOutside
    )
      workingState = departPreparedWagons(workingState, elapsedMs);
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
  const blockedIds = new Set(
    handoffMoving ? workingState.departingPassengers.map((pose) => pose.tx.id) : [],
  );
  const admitted = admitPassengers(
    grouped.passengers,
    workingState.pendingAdmissions,
    elapsedMs,
    blockedIds,
    grouped,
    workingState.preparationStartedAt !== null
      ? MAX_RESIDENT_PASSENGERS + MAX_DEPARTURE_PASSENGERS
      : MAX_RESIDENT_PASSENGERS,
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
    ...retainWaitingArchive(
      grouped,
      [],
      admitted.passengers.map((passenger) => passenger.tx.id),
    ),
    ...projectionOccupancy(admitted.passengers),
  };
  if (next.preparationStartedAt !== null) next = prepareForDeparture(next, elapsedMs);
  else if (!handoffMoving) {
    next.passengers = alignWaitingQueue(next.passengers, elapsedMs);
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
  return next;
}

function passengerPose(passenger: Passenger, elapsedMs: number): PassengerPose {
  const progress =
    passenger.durationMs > 0
      ? Math.min(1, Math.max(0, (elapsedMs - passenger.phaseStartedAt) / passenger.durationMs))
      : 1;
  const cached = passengerPoseCache.get(passenger);
  if (cached?.pose.progress === progress) {
    const walking =
      !cached.pose.inWagon &&
      !passenger.inHandoff &&
      WALKING_PHASES.has(passenger.phase) &&
      progress > 0 &&
      progress < 1;
    if (!walking || cached.elapsedMs === elapsedMs) return cached.pose;
  }
  const point = passengerPosition(passenger, elapsedMs);
  const queue = queuePosition(passenger.queueIndex);
  const inWagon =
    passenger.wagon !== null &&
    (passenger.inHandoff ||
      ['boarded', 'confirmed'].includes(passenger.phase) ||
      (['boarding', 'preparing', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)));
  const from = passenger.path[0] ?? point;
  const to = passenger.path[passenger.path.length - 1] ?? point;
  const appearance = transactionAppearance(passenger.tx);
  const walking =
    !inWagon &&
    !passenger.inHandoff &&
    WALKING_PHASES.has(passenger.phase) &&
    progress > 0 &&
    progress < 1;
  const pose: PassengerPose = {
    tx: passenger.tx,
    ...point,
    queueX: queue.x,
    queueY: queue.y,
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
    opacity: 1,
    progress,
    facing: to.x < from.x ? -1 : 1,
    movementAngle: pathHeadingDegrees(passenger.path, progress),
    // Waiting people have no gait to redraw. Moving people keep the same walking rhythm.
    walkPhase: walking ? (elapsedMs / 160 + (appearance.hash % 7)) % (Math.PI * 2) : 0,
  };
  passengerPoseCache.set(passenger, { elapsedMs, pose });
  return pose;
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
  let passengers = state.passengers.map((passenger, index): PassengerPose => {
    if (passenger.presentInSample) counts[passenger.phase] += 1;
    else if (passenger.phase === 'parked') counts.parked += 1;
    else counts.retiring += 1;
    if (passenger.departureIncluded) preparationPassengerCount += 1;
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
    candidateCapacity: CANDIDATE_CAPACITY,
    projectionCount: state.projectionCount,
    projectionUsed: state.projectionUsed,
    feeThreshold: state.feeThreshold,
    elapsedMs: state.elapsedMs,
    preparationProgress:
      state.preparationStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(0, (state.elapsedMs - state.preparationStartedAt) / PREPARATION_DURATION_MS),
          ),
    preparationPassengerCount,
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
