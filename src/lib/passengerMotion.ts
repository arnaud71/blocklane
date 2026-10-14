import type { Block, Snapshot, Tx } from '../../shared/model';
import {
  boardingApproach,
  entryDoorPoint,
  exitDoorPoint,
  exitPlatformPoint,
  isInsideDoorway,
  PLATFORM_CORRIDOR_X,
  queuePosition,
  wagonSeat,
  type StreetPoint,
  type WagonKind,
} from './streetGeometry';

export const MAX_PASSENGERS = 80;
export const MAX_RESIDENT_PASSENGERS = MAX_PASSENGERS * 2;
const MAX_INDIVIDUAL_HISTORY = MAX_PASSENGERS;
export const MAX_WAITING_ARCHIVE_COUNT = 1_000_000;
export const WAITING_ARCHIVE_POSITION: StreetPoint = { x: 360, y: 686 };
/** This illustrated budget does not describe either chain's consensus capacity. */
export const CANDIDATE_CAPACITY = 12;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 1_200;
export const PREPARATION_DURATION_MS = 500;
export const CANDIDATE_ARRIVAL_DURATION_MS = 700;
const GEOMETRY_VERSION = 'right-platform-two-projections-v7';

export type PassengerPhase =
  | 'arriving'
  | 'queue'
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
}

export interface PassengerMotionState {
  context: string;
  elapsedMs: number;
  observedBlockHash: string | null;
  preparationStartedAt: number | null;
  handoffStartedAt: number | null;
  candidateArrivalStartedAt: number | null;
  departingBlock: Pick<Block, 'hash' | 'height'> | null;
  preparationTransactions: Tx[];
  queuedDeparture: DepartureObservation | null;
  feeThreshold: number | null;
  candidateCount: number;
  candidateUsed: number;
  projectionCount: Record<WagonKind, number>;
  projectionUsed: Record<WagonKind, number>;
  passengers: Passenger[];
  pendingAdmissions: PassengerAdmission[];
  waitingArchiveCount: number;
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
  walkPhase: number;
}

export interface PassengerFrame {
  passengers: PassengerPose[];
  departingPassengers: PassengerPose[];
  departingBlock: Pick<Block, 'hash' | 'height'> | null;
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

function projectionOccupancy(passengers: Passenger[]) {
  const projectionCount: Record<WagonKind, number> = { next: 0, later: 0 };
  const projectionUsed: Record<WagonKind, number> = { next: 0, later: 0 };
  for (const passenger of passengers) {
    if (!passenger.presentInSample || !passenger.plannedWagon) continue;
    projectionCount[passenger.plannedWagon] += 1;
    projectionUsed[passenger.plannedWagon] += transactionResourceUnits(passenger.tx);
  }
  return {
    projectionCount,
    projectionUsed,
    candidateCount: projectionCount.next,
    candidateUsed: projectionUsed.next,
  };
}

function interpolatePath(path: StreetPoint[], progress: number): StreetPoint {
  const start = path[0] ?? { x: PLATFORM_CORRIDOR_X, y: 118 };
  if (path.length < 2) return start;
  const lengths = path.slice(1).map((point, index) => {
    const previous = path[index] ?? start;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  let remaining =
    lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const from = path[index] ?? start;
    const to = path[index + 1] ?? from;
    if (remaining <= length || index === lengths.length - 1) {
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

function pathDuration(path: StreetPoint[]): number {
  const distance = path.slice(1).reduce((total, point, index) => {
    const previous = path[index] ?? point;
    return total + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
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
    ...startPhase(passenger, 'parked', now, [queuePosition(passenger.queueIndex)], 0),
    wagon: null,
    plannedWagon: null,
    selectedForCandidate: false,
    joiningArchive: false,
  };
}

function startExit(passenger: Passenger, now: number, from: StreetPoint, fast = false): Passenger {
  if (!passenger.wagon) return startReturning(passenger, now, from);
  const inside = exitDoorPoint(passenger.wagon);
  return {
    ...startPhase(
      passenger,
      'exiting',
      now,
      [from, { x: inside.x, y: from.y }, inside, exitPlatformPoint(passenger.wagon)],
      fast ? PREPARATION_DURATION_MS : 1_300,
    ),
  };
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

/** Unknown sample membership never changes the source status or deletes a visible traveller. */
function groupWaitingObservations(
  passengers: Passenger[],
  waitingArchiveCount: number,
  now: number,
  reservedDeparturePlaces = 0,
) {
  const merging = passengers.filter(
    (passenger) =>
      !passenger.presentInSample && passenger.phase === 'parked' && passenger.joiningArchive,
  );
  const mergedIds = new Set(merging.map((passenger) => passenger.tx.id));
  const residents = passengers.filter((passenger) => !mergedIds.has(passenger.tx.id));
  const history = residents.filter(
    (passenger) => !passenger.presentInSample && !passenger.departureIncluded,
  );
  const alreadyJoining = history.filter((passenger) => passenger.joiningArchive).length;
  const joiningIds = new Set(
    history
      .filter(
        (passenger) => passenger.phase === 'parked' && !passenger.wagon && !passenger.inHandoff,
      )
      .sort((left, right) => left.phaseStartedAt - right.phaseStartedAt)
      .slice(
        0,
        Math.max(
          0,
          history.length -
            Math.max(0, MAX_INDIVIDUAL_HISTORY - reservedDeparturePlaces) -
            alreadyJoining,
        ),
      )
      .map((passenger) => passenger.tx.id),
  );
  return {
    waitingArchiveCount: Math.min(
      MAX_WAITING_ARCHIVE_COUNT,
      Math.max(0, waitingArchiveCount) + merging.length,
    ),
    passengers: residents.map((passenger) => {
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
): { passengers: Passenger[]; pendingAdmissions: PassengerAdmission[] } {
  const passengers = [...residents];
  const occupied = new Set(residents.map((passenger) => passenger.queueIndex));
  const residentIds = new Set(residents.map((passenger) => passenger.tx.id));
  const pendingAdmissions: PassengerAdmission[] = [];
  let arrivalIndex = 0;
  for (const admission of admissions.slice(0, MAX_PASSENGERS)) {
    if (residentIds.has(admission.tx.id)) continue;
    if (passengers.length >= MAX_RESIDENT_PASSENGERS || blockedIds.has(admission.tx.id)) {
      pendingAdmissions.push(admission);
      continue;
    }
    let queueIndex = 0;
    while (occupied.has(queueIndex)) queueIndex += 1;
    occupied.add(queueIndex);
    residentIds.add(admission.tx.id);
    const queue = queuePosition(queueIndex);
    const path = [{ x: queue.x, y: -44 }, queue];
    passengers.push({
      ...admission,
      queueIndex,
      seatIndex: admission.plannedSeatIndex,
      phase: 'arriving',
      phaseStartedAt: now + arrivalIndex++ * 90 + (stableHash(admission.tx.id) % 120),
      durationMs: pathDuration(path),
      retryAt: now,
      path,
      wagon: null,
      inHandoff: false,
      presentInSample: true,
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

function prepareForDeparture(state: PassengerMotionState, now: number): PassengerMotionState {
  const included = new Map(
    state.preparationTransactions.map((tx, index) => [tx.id, { tx, index }]),
  );
  const residentIds = new Set(state.passengers.map((passenger) => passenger.tx.id));
  const missing = state.preparationTransactions.filter((tx) => !residentIds.has(tx.id));
  const grouped = groupWaitingObservations(
    state.passengers,
    state.waitingArchiveCount,
    now,
    missing.length,
  );
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
  const admitted = admitPassengers(grouped.passengers, admissions, now);
  const passengers = admitted.passengers.map((passenger) => {
    if (passenger.inHandoff) return passenger;
    const inclusion = included.get(passenger.tx.id);
    const point = passengerPosition(passenger, now);
    if (inclusion) {
      const updated = {
        ...passenger,
        tx: inclusion.tx,
        departureIncluded: true,
        joiningArchive: false,
      };
      if (
        passenger.phase === 'preparing' ||
        (passenger.wagon === 'next' && passenger.phase === 'confirmed')
      )
        return updated;
      // A rider of the second projection must first use that vehicle's lower door.
      // Its membership remains 'later' throughout this exit, so clipping and doors agree.
      if (passenger.wagon === 'later' && isInsideDoorway(point))
        return passenger.phase === 'exiting' ? updated : startExit(updated, now, point, true);
      const seat = wagonSeat('next', inclusion.index);
      const path =
        passenger.wagon === 'next' && isInsideDoorway(point)
          ? [point, seat]
          : [...platformPath(point, boardingApproach('next')), entryDoorPoint('next'), seat];
      return {
        ...startPhase(updated, 'preparing', now, path, PREPARATION_DURATION_MS),
        wagon: 'next' as const,
        seatIndex: inclusion.index,
        handoffPhase: undefined,
      };
    }
    if (passenger.wagon === 'next' && isInsideDoorway(point))
      return passenger.phase === 'exiting' ? passenger : startExit(passenger, now, point, true);
    // Retained riders may free resident places during this stationary stop. Riders
    // still assigned to either projection stay in the lower vehicle for promotion.
    if (
      passenger.wagon === 'later' &&
      isInsideDoorway(point) &&
      (!passenger.presentInSample || !passenger.plannedWagon || passenger.tx.status === 'confirmed')
    )
      return passenger.phase === 'exiting' ? passenger : startExit(passenger, now, point, true);
    if (passenger.plannedWagon === 'next' && ['boarding', 'walking'].includes(passenger.phase))
      return startReturning(passenger, now, point);
    return passenger;
  });
  return {
    ...state,
    ...admitted,
    passengers,
    waitingArchiveCount: grouped.waitingArchiveCount,
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
  const grouped = groupWaitingObservations(
    state.passengers,
    state.waitingArchiveCount,
    state.elapsedMs,
    reserve,
  );
  const admitted = admitPassengers(grouped.passengers, admissions, state.elapsedMs);
  return prepareForDeparture(
    {
      ...state,
      ...admitted,
      waitingArchiveCount: grouped.waitingArchiveCount,
      pendingAdmissions: [...admitted.pendingAdmissions, ...state.pendingAdmissions].slice(
        0,
        MAX_PASSENGERS,
      ),
      preparationStartedAt: state.elapsedMs,
      departingBlock: observation.block,
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
  );
  return {
    context: motionContext(snapshot),
    elapsedMs: 0,
    observedBlockHash: snapshot.blocks[0]?.hash ?? null,
    preparationStartedAt: null,
    handoffStartedAt: null,
    candidateArrivalStartedAt: 0,
    departingBlock: null,
    preparationTransactions: [],
    queuedDeparture: null,
    departingPassengers: [],
    waitingArchiveCount: 0,
    feeThreshold: plan.feeThreshold,
    ...projectionOccupancy(admitted.passengers),
    ...admitted,
  };
}

function reconcileDesiredPassenger(passenger: Passenger, now: number, moving: boolean): Passenger {
  if (passenger.inHandoff || moving || passenger.departureIncluded) return passenger;
  const point = passengerPosition(passenger, now);
  if (!passenger.presentInSample) return waitOutsideSample(passenger, now);
  if (['arriving', 'exiting', 'returning'].includes(passenger.phase)) return passenger;
  if (passenger.wagon && isInsideDoorway(point)) {
    if (passenger.wagon !== passenger.plannedWagon || passenger.tx.status === 'confirmed')
      return startExit(passenger, now, point);
    if (passenger.phase === 'boarded')
      return { ...passenger, path: [wagonSeat(passenger.wagon, passenger.seatIndex)] };
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
  if (passenger.tx.status === 'confirmed')
    return { ...startPhase(passenger, 'confirmed', now, [point], 0), wagon: null };
  if (passenger.phase === 'parked')
    return { ...startPhase(passenger, 'queue', now, [point], 0), retryAt: now + QUEUE_RETRY_MS };
  return passenger;
}

export function reconcilePassengerMotion(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  if (state.context !== motionContext(snapshot)) return createPassengerMotion(snapshot);
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
  const grouped = groupWaitingObservations(passengers, state.waitingArchiveCount, state.elapsedMs);
  const admitted = admitPassengers(grouped.passengers, admissions, state.elapsedMs, departingIds);
  let next: PassengerMotionState = {
    ...state,
    ...admitted,
    observedBlockHash:
      snapshot.status === 'ok'
        ? (snapshot.blocks[0]?.hash ?? state.observedBlockHash)
        : state.observedBlockHash,
    feeThreshold: plan.feeThreshold,
    waitingArchiveCount: grouped.waitingArchiveCount,
    ...projectionOccupancy(admitted.passengers),
  };
  const observation = departingObservation(snapshot);
  const newBlock =
    observation &&
    state.observedBlockHash !== null &&
    observation.block.hash !== state.observedBlockHash;
  if (newBlock) {
    if (
      state.preparationStartedAt === null &&
      state.handoffStartedAt === null &&
      state.candidateArrivalStartedAt === null
    )
      next = beginPreparation(next, observation);
    else next.queuedDeparture = observation;
  }
  if (
    observation &&
    next.queuedDeparture &&
    observation.block.hash === next.queuedDeparture.block.hash
  ) {
    const included = new Map(next.queuedDeparture.transactions.map((tx) => [tx.id, tx]));
    for (const tx of observation.transactions) included.set(tx.id, tx);
    next.queuedDeparture = {
      block: observation.block,
      transactions: [...included.values()].slice(0, MAX_PASSENGERS),
    };
  }
  if (next.preparationStartedAt !== null) {
    // Enrich only the same source-associated block without restarting the half-second stop.
    if (observation && next.departingBlock && observation.block.hash === next.departingBlock.hash) {
      const included = new Map(next.preparationTransactions.map((tx) => [tx.id, tx]));
      for (const tx of observation.transactions) included.set(tx.id, tx);
      next.preparationTransactions = [...included.values()].slice(0, MAX_PASSENGERS);
    }
    return prepareForDeparture(next, state.elapsedMs);
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
    .slice(0, MAX_PASSENGERS)
    .map((pose) => ({ ...pose, sourceObserved: false }));
  const departingIds = new Set(departingPassengers.map((pose) => pose.tx.id));
  return {
    ...state,
    preparationStartedAt: null,
    preparationTransactions: [],
    handoffStartedAt: departureAt,
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
  const settled = { ...passenger, wagon, seatIndex: passenger.plannedSeatIndex };
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
    if (residents.has(tx.id)) return;
    const queueIndex = nextQueueIndex();
    residents.set(tx.id, {
      tx,
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
      presentInSample: false,
    });
  };
  // These exact statuses come from a prior source observation. They are retained
  // as historical observations, never silently relabelled as pending candidates.
  for (const pose of state.departingPassengers) restoreObservation(pose.tx);
  for (const tx of state.preparationTransactions) restoreObservation(tx);
  for (const tx of state.queuedDeparture?.transactions ?? []) restoreObservation(tx);
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
  const passengers = [...current, ...history.slice(groupedCount)];
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
    pendingAdmissions: [],
    waitingArchiveCount: Math.min(
      MAX_WAITING_ARCHIVE_COUNT,
      state.waitingArchiveCount + groupedCount,
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
  if (passenger.phase === 'arriving') {
    if (!passenger.presentInSample) return parkAtQueue(passenger, now);
    return {
      ...startPhase(
        passenger,
        passenger.tx.status === 'confirmed' ? 'confirmed' : 'queue',
        now,
        [queuePosition(passenger.queueIndex)],
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
        [queuePosition(passenger.queueIndex)],
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
  const advanced = workingState.passengers.map((passenger) =>
    advancePassenger(
      passenger,
      elapsedMs,
      state.elapsedMs,
      handoffMoving,
      candidateArrivalStartedAt !== null,
      workingState.preparationStartedAt !== null,
    ),
  );
  const grouped = groupWaitingObservations(advanced, workingState.waitingArchiveCount, elapsedMs);
  const blockedIds = new Set(
    handoffMoving ? workingState.departingPassengers.map((pose) => pose.tx.id) : [],
  );
  const admitted = admitPassengers(
    grouped.passengers,
    workingState.pendingAdmissions,
    elapsedMs,
    blockedIds,
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
    waitingArchiveCount: grouped.waitingArchiveCount,
    ...projectionOccupancy(admitted.passengers),
  };
  if (next.preparationStartedAt !== null) next = prepareForDeparture(next, elapsedMs);
  else if (!handoffMoving) {
    next.passengers = next.passengers.map((passenger) =>
      reconcileDesiredPassenger(
        passenger,
        elapsedMs,
        candidateArrivalStartedAt !== null &&
          (passenger.wagon ?? passenger.plannedWagon) === 'later',
      ),
    );
    if (next.queuedDeparture && candidateArrivalStartedAt === null) {
      const observation = next.queuedDeparture;
      next.queuedDeparture = null;
      next = beginPreparation(next, observation);
    }
  }
  return next;
}

export function passengerFrame(state: PassengerMotionState): PassengerFrame {
  const counts: Record<PassengerPhase, number> = {
    arriving: 0,
    queue: 0,
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
  const passengers = state.passengers.map((passenger): PassengerPose => {
    if (passenger.presentInSample) counts[passenger.phase] += 1;
    else if (passenger.phase === 'parked') counts.parked += 1;
    else counts.retiring += 1;
    const point = passengerPosition(passenger, state.elapsedMs);
    const queue = queuePosition(passenger.queueIndex);
    const progress =
      passenger.durationMs > 0
        ? Math.min(
            1,
            Math.max(0, (state.elapsedMs - passenger.phaseStartedAt) / passenger.durationMs),
          )
        : 1;
    const moving =
      state.handoffStartedAt !== null ||
      (state.candidateArrivalStartedAt !== null && passenger.wagon === 'later');
    if (!moving && passenger.wagon) {
      if (['boarding', 'preparing'].includes(passenger.phase)) doors[passenger.wagon].entry = true;
      if (passenger.phase === 'exiting') doors[passenger.wagon].exit = true;
    }
    const inWagon =
      passenger.wagon !== null &&
      (passenger.inHandoff ||
        ['boarded', 'confirmed'].includes(passenger.phase) ||
        (['boarding', 'preparing', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)));
    const from = passenger.path[0] ?? point;
    const to = passenger.path[passenger.path.length - 1] ?? point;
    return {
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
      sourceObserved: passenger.presentInSample,
      headScale: transactionHeadScale(passenger.tx),
      resourceUnits: transactionResourceUnits(passenger.tx),
      opacity: 1,
      progress,
      facing: to.x < from.x ? -1 : 1,
      walkPhase: (state.elapsedMs / 160 + (stableHash(passenger.tx.id) % 7)) % (Math.PI * 2),
    };
  });
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
    preparationPassengerCount: state.passengers.filter((passenger) => passenger.departureIncluded)
      .length,
    waitingArchiveCount: state.waitingArchiveCount,
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
