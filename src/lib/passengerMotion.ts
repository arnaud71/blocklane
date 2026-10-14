import type { Snapshot, Tx } from '../../shared/model';
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
/** A rotating sample may coexist with its previous travellers until they leave the scene. */
export const MAX_RESIDENT_PASSENGERS = MAX_PASSENGERS * 2;
const MAX_INDIVIDUAL_HISTORY = MAX_PASSENGERS;
export const MAX_WAITING_ARCHIVE_COUNT = 1_000_000;
export const WAITING_ARCHIVE_POSITION: StreetPoint = { x: 360, y: 686 };
/** A deliberately small illustrated budget, never a real network block capacity. */
export const CANDIDATE_CAPACITY = 12;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 1_200;
/** A short visible stop lets the sampled group board before either wagon leaves. */
export const PREPARATION_DURATION_MS = 500;
/** The next empty candidate comes from below after the previous one stops. */
export const CANDIDATE_ARRIVAL_DURATION_MS = 700;
const GEOMETRY_VERSION = 'right-platform-waiting-v6';

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
export type PassengerDestination = 'candidate' | 'observed' | 'queue';
export type PassengerReason = 'accepted' | 'fee' | 'capacity' | 'observed';

interface Passenger {
  tx: Tx;
  queueIndex: number;
  seatIndex: number;
  plannedSeatIndex: number;
  selectedForCandidate: boolean;
  reason: PassengerReason;
  phase: PassengerPhase;
  phaseStartedAt: number;
  durationMs: number;
  retryAt: number;
  path: StreetPoint[];
  /** Visual vehicle membership is independent of source confirmation. */
  wagon: WagonKind | null;
  inHandoff: boolean;
  /** A doorway passage resumes only once its vehicle has stopped. */
  handoffPhase?: PassengerPhase;
  /** Previous-block occupants wait in their stationary vehicle until the preparation ends. */
  waitingForDeparture?: boolean;
  /** An old observation joins the collective waiting illustration before its individual ID is released. */
  joiningArchive?: boolean;
  presentInSample: boolean;
}

interface PassengerAdmission {
  tx: Tx;
  plannedSeatIndex: number;
  selectedForCandidate: boolean;
  reason: PassengerReason;
}

export interface PassengerMotionState {
  context: string;
  elapsedMs: number;
  observedBlockHash: string | null;
  preparationStartedAt: number | null;
  handoffStartedAt: number | null;
  candidateArrivalStartedAt: number | null;
  feeThreshold: number | null;
  candidateCount: number;
  candidateUsed: number;
  passengers: Passenger[];
  /** Latest-source arrivals wait here when the visible resident limit is reached. */
  pendingAdmissions: PassengerAdmission[];
  /** Historical sample observations, not a count of unique pending network transactions. */
  waitingArchiveCount: number;
  /** Previous-block occupants travel with the departing vehicle, outside current-source state. */
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
  /** False means the transaction is only a retained last observation, not current source data. */
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
  counts: Record<PassengerPhase, number>;
  candidateCount: number;
  candidateUsed: number;
  candidateCapacity: number;
  feeThreshold: number | null;
  elapsedMs: number;
  preparationProgress: number | null;
  preparationPassengerCount: number;
  waitingArchiveCount: number;
  handoffProgress: number | null;
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
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function destination(passenger: Passenger): PassengerDestination {
  if (passenger.phase === 'parked' || passenger.joiningArchive) return 'queue';
  return passenger.tx.status === 'confirmed'
    ? 'observed'
    : passenger.selectedForCandidate
      ? 'candidate'
      : 'queue';
}

function targetWagon(passenger: Passenger): WagonKind {
  return passenger.tx.status === 'confirmed' ? 'observed' : 'candidate';
}

function seatPosition(passenger: Passenger): StreetPoint {
  return wagonSeat(passenger.wagon ?? targetWagon(passenger), passenger.seatIndex);
}

/** Absolute, bounded size encoding: the same transaction keeps the same head size. */
export function transactionHeadScale(tx: Pick<Tx, 'chain' | 'size'>): number {
  const reference = tx.chain === 'bitcoin' ? 250 : 21_000;
  const size = Number.isFinite(tx.size) ? Math.max(0, tx.size) : 0;
  return Math.max(0.8, Math.min(1.85, 0.8 + Math.log2(1 + size / reference) * 0.31));
}

/** Units only describe our twelve-unit pedagogical candidate, not consensus packing. */
export function transactionResourceUnits(tx: Pick<Tx, 'chain' | 'size'>): number {
  const reference = tx.chain === 'bitcoin' ? 400 : 100_000;
  const size = Number.isFinite(tx.size) ? Math.max(0, tx.size) : 0;
  return Math.max(1, Math.min(3, Math.ceil(size / reference)));
}

function planSnapshot(snapshot: Snapshot) {
  const transactions = [...snapshot.transactions]
    .sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id))
    .filter((tx, index, array) => array.findIndex((candidate) => candidate.id === tx.id) === index)
    .slice(0, MAX_PASSENGERS);
  const accepted = new Map<string, number>();
  const reasons = new Map<string, PassengerReason>();
  const feeThreshold = snapshot.feeRate;
  let used = 0;
  for (const tx of transactions) {
    if (tx.status === 'confirmed') {
      reasons.set(tx.id, 'observed');
    } else if (tx.feeRate < (feeThreshold ?? 0)) {
      reasons.set(tx.id, 'fee');
    } else {
      const units = transactionResourceUnits(tx);
      if (used + units <= CANDIDATE_CAPACITY) {
        accepted.set(tx.id, accepted.size);
        reasons.set(tx.id, 'accepted');
        used += units;
      } else {
        reasons.set(tx.id, 'capacity');
      }
    }
  }
  return { transactions, accepted, reasons, used, feeThreshold };
}

function interpolatePath(path: StreetPoint[], progress: number): StreetPoint {
  const start = path[0] ?? { x: PLATFORM_CORRIDOR_X, y: 118 };
  if (path.length < 2) return start;
  const lengths = path.slice(1).map((point, index) => {
    const previous = path[index] ?? start;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const from = path[index] ?? start;
    const to = path[index + 1] ?? from;
    if (remaining <= length || index === lengths.length - 1) {
      const fraction = length > 0 ? remaining / length : 1;
      return {
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
      };
    }
    remaining -= length;
  }
  return path[path.length - 1] ?? start;
}

function passengerPosition(passenger: Passenger, elapsedMs: number): StreetPoint {
  const progress =
    passenger.durationMs > 0
      ? Math.min(1, Math.max(0, (elapsedMs - passenger.phaseStartedAt) / passenger.durationMs))
      : 1;
  return interpolatePath(passenger.path, progress);
}

function pathDuration(path: StreetPoint[]): number {
  const distance = path.slice(1).reduce((total, point, index) => {
    const previous = path[index] ?? point;
    return total + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
  return Math.max(1_700, Math.min(5_200, distance * 9));
}

function arrivalPath(queueIndex: number): StreetPoint[] {
  const queue = queuePosition(queueIndex);
  return [{ x: queue.x, y: -44 }, queue];
}

function arrivalDelay(index: number, id: string): number {
  return index * 90 + (stableHash(id) % 120);
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

/** Every exterior segment uses the platform corridor, never the roadway. */
function platformPath(from: StreetPoint, to: StreetPoint): StreetPoint[] {
  return [from, { x: PLATFORM_CORRIDOR_X, y: from.y }, { x: PLATFORM_CORRIDOR_X, y: to.y }, to];
}

function startWalking(passenger: Passenger, now: number, from: StreetPoint): Passenger {
  const path = platformPath(from, boardingApproach(targetWagon(passenger)));
  return {
    ...startPhase(passenger, 'walking', now, path, pathDuration(path)),
    wagon: null,
    seatIndex: passenger.plannedSeatIndex,
  };
}

function startReturning(passenger: Passenger, now: number, from: StreetPoint): Passenger {
  const path = platformPath(from, queuePosition(passenger.queueIndex));
  return {
    ...startPhase(passenger, 'returning', now, path, pathDuration(path)),
    wagon: null,
  };
}

function parkAtQueue(passenger: Passenger, now: number): Passenger {
  return {
    ...startPhase(passenger, 'parked', now, [queuePosition(passenger.queueIndex)], 0),
    wagon: null,
    selectedForCandidate: false,
    joiningArchive: false,
  };
}

function startExit(passenger: Passenger, now: number, from: StreetPoint): Passenger {
  const wagon = passenger.wagon ?? targetWagon(passenger);
  const inside = exitDoorPoint(wagon);
  return {
    ...startPhase(
      passenger,
      'exiting',
      now,
      [from, { x: inside.x, y: from.y }, inside, exitPlatformPoint(wagon)],
      1_300,
    ),
    wagon,
  };
}

function isCandidateRider(passenger: Passenger, now: number): boolean {
  return (
    passenger.wagon === 'candidate' &&
    (passenger.phase === 'boarded' ||
      (['boarding', 'exiting'].includes(passenger.phase) &&
        isInsideDoorway(passengerPosition(passenger, now))))
  );
}

function joinsPreparation(passenger: Passenger, now: number): boolean {
  return (
    !passenger.waitingForDeparture &&
    !passenger.inHandoff &&
    (passenger.phase === 'preparing' ||
      isCandidateRider(passenger, now) ||
      (passenger.presentInSample &&
        (passenger.tx.status === 'confirmed' || passenger.selectedForCandidate)))
  );
}

function preparePassenger(
  passenger: Passenger,
  now: number,
  preparationStartedAt: number,
): Passenger {
  if (passenger.phase === 'preparing') return passenger;
  const from = passengerPosition(passenger, now);
  const seatIndex =
    passenger.wagon === 'candidate' ? passenger.seatIndex : passenger.plannedSeatIndex;
  const seat = wagonSeat('candidate', seatIndex);
  const alreadyInside = passenger.wagon === 'candidate' && isInsideDoorway(from);
  const path = alreadyInside
    ? [from, seat]
    : [...platformPath(from, boardingApproach('candidate')), entryDoorPoint('candidate'), seat];
  return {
    ...startPhase(
      passenger,
      'preparing',
      now,
      path,
      Math.max(1, preparationStartedAt + PREPARATION_DURATION_MS - now),
    ),
    wagon: 'candidate',
    seatIndex,
    handoffPhase: undefined,
  };
}

function waitForDeparture(passenger: Passenger, now: number): Passenger {
  return {
    ...passenger,
    waitingForDeparture: true,
    presentInSample: false,
    selectedForCandidate: false,
    phaseStartedAt: now,
    durationMs: 0,
    path: [passengerPosition(passenger, now)],
  };
}

function waitOutsideSample(passenger: Passenger, now: number): Passenger {
  if (
    passenger.inHandoff ||
    passenger.waitingForDeparture ||
    ['parked', 'arriving', 'returning'].includes(passenger.phase)
  ) {
    return passenger;
  }
  const point = passengerPosition(passenger, now);
  if (
    passenger.wagon &&
    (['boarded', 'confirmed'].includes(passenger.phase) ||
      (['boarding', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)))
  ) {
    return passenger.phase === 'exiting' ? passenger : startExit(passenger, now, point);
  }
  if (passenger.phase === 'queue') return parkAtQueue(passenger, now);
  return startReturning(passenger, now, point);
}

/** Merge only after an old, stationary queue traveller has walked into the visible waiting group. */
function groupWaitingObservations(
  passengers: Passenger[],
  waitingArchiveCount: number,
  now: number,
) {
  const merging = passengers.filter(
    (passenger) =>
      !passenger.presentInSample && passenger.phase === 'parked' && passenger.joiningArchive,
  );
  const mergedIds = new Set(merging.map((passenger) => passenger.tx.id));
  const residents = passengers.filter((passenger) => !mergedIds.has(passenger.tx.id));
  const parked = residents
    .filter(
      (passenger) =>
        !passenger.presentInSample &&
        passenger.phase === 'parked' &&
        !passenger.wagon &&
        !passenger.inHandoff &&
        !passenger.waitingForDeparture,
    )
    .sort((left, right) => left.phaseStartedAt - right.phaseStartedAt);
  const individualHistory = residents.filter(
    (passenger) => !passenger.presentInSample && !passenger.waitingForDeparture,
  );
  const alreadyJoining = individualHistory.filter((passenger) => passenger.joiningArchive).length;
  const joiningIds = new Set(
    parked
      .slice(0, Math.max(0, individualHistory.length - MAX_INDIVIDUAL_HISTORY - alreadyJoining))
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
    const path = arrivalPath(queueIndex);
    passengers.push({
      ...admission,
      queueIndex,
      seatIndex: admission.plannedSeatIndex,
      phase: 'arriving',
      phaseStartedAt: now + arrivalDelay(arrivalIndex++, admission.tx.id),
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

function candidateOccupancy(passengers: Passenger[]) {
  const selected = passengers.filter(
    (passenger) => passenger.presentInSample && passenger.selectedForCandidate,
  );
  return {
    candidateCount: selected.length,
    candidateUsed: selected.reduce(
      (used, passenger) => used + transactionResourceUnits(passenger.tx),
      0,
    ),
  };
}

export function createPassengerMotion(snapshot: Snapshot): PassengerMotionState {
  const plan = planSnapshot(snapshot);
  let observedIndex = 0;
  return {
    context: motionContext(snapshot),
    elapsedMs: 0,
    observedBlockHash: snapshot.blocks[0]?.hash ?? null,
    preparationStartedAt: null,
    handoffStartedAt: null,
    candidateArrivalStartedAt: 0,
    departingPassengers: [],
    pendingAdmissions: [],
    waitingArchiveCount: 0,
    feeThreshold: plan.feeThreshold,
    candidateCount: plan.accepted.size,
    candidateUsed: plan.used,
    passengers: plan.transactions.map((tx, queueIndex) => {
      const seatIndex =
        tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0);
      const path = arrivalPath(queueIndex);
      return {
        tx,
        queueIndex,
        seatIndex,
        plannedSeatIndex: seatIndex,
        selectedForCandidate: plan.accepted.has(tx.id),
        reason: plan.reasons.get(tx.id) ?? 'capacity',
        phase: 'arriving',
        phaseStartedAt: arrivalDelay(queueIndex, tx.id),
        durationMs: pathDuration(path),
        retryAt: 0,
        path,
        wagon: null,
        inHandoff: false,
        presentInSample: true,
      };
    }),
  };
}

/** A change of visual vehicle never changes the confirmation supplied by the source. */
export function reconcilePassengerMotion(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  if (state.context !== motionContext(snapshot)) return createPassengerMotion(snapshot);
  const plan = planSnapshot(snapshot);
  const blockHash = snapshot.blocks[0]?.hash ?? null;
  const newObservedBlock =
    snapshot.mode === 'live' &&
    snapshot.status === 'ok' &&
    blockHash !== null &&
    state.observedBlockHash !== null &&
    blockHash !== state.observedBlockHash;
  const startPreparation =
    newObservedBlock &&
    state.handoffStartedAt === null &&
    (state.preparationStartedAt ?? null) === null;
  const preparationStartedAt = startPreparation
    ? state.elapsedMs
    : (state.preparationStartedAt ?? null);
  const departingPassengers =
    state.handoffStartedAt !== null ? (state.departingPassengers ?? []) : [];
  const departingIds = new Set(departingPassengers.map((pose) => pose.tx.id));
  // Those actors remain visible only in their departing vehicle until it has left the viewport.
  const residents = state.passengers
    .filter((passenger) => !departingIds.has(passenger.tx.id))
    .map((passenger) =>
      startPreparation &&
      passenger.wagon === 'observed' &&
      (['boarded', 'confirmed'].includes(passenger.phase) ||
        (['boarding', 'exiting'].includes(passenger.phase) &&
          isInsideDoorway(passengerPosition(passenger, state.elapsedMs))))
        ? waitForDeparture(passenger, state.elapsedMs)
        : passenger,
    );
  const heldResidents = residents.filter((passenger) => passenger.waitingForDeparture);
  const heldIds = new Set(heldResidents.map((passenger) => passenger.tx.id));
  const previous = new Map(
    residents
      .filter((passenger) => !passenger.waitingForDeparture)
      .map((passenger) => [passenger.tx.id, passenger]),
  );
  const nextIds = new Set(plan.transactions.map((tx) => tx.id));
  let observedIndex = 0;
  const admissions: PassengerAdmission[] = [];
  const passengers = plan.transactions.flatMap((tx): Passenger[] => {
    const existing = previous.get(tx.id);
    const accepted = plan.accepted.has(tx.id);
    const plannedSeatIndex =
      tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0);
    if (!existing) {
      admissions.push({
        tx,
        plannedSeatIndex,
        selectedForCandidate: accepted,
        reason: plan.reasons.get(tx.id) ?? 'capacity',
      });
      return [];
    }
    const updated: Passenger = {
      ...existing,
      tx,
      seatIndex: existing.wagon ? existing.seatIndex : plannedSeatIndex,
      plannedSeatIndex,
      selectedForCandidate: accepted,
      reason: plan.reasons.get(tx.id) ?? 'capacity',
      presentInSample: true,
      joiningArchive: false,
    };
    if (existing.inHandoff) return [updated];
    if (preparationStartedAt !== null && joinsPreparation(updated, state.elapsedMs)) {
      return [preparePassenger(updated, state.elapsedMs, preparationStartedAt)];
    }
    if (existing.phase === 'arriving') return [updated];
    const currentPosition = passengerPosition(existing, state.elapsedMs);
    if (existing.phase === 'parked' || existing.joiningArchive) {
      if (tx.status === 'confirmed' || accepted) {
        return [startWalking(updated, state.elapsedMs, currentPosition)];
      }
      if (existing.joiningArchive) {
        return [startReturning(updated, state.elapsedMs, currentPosition)];
      }
      return [
        {
          ...startPhase(updated, 'queue', state.elapsedMs, [currentPosition], 0),
          retryAt: state.elapsedMs + QUEUE_RETRY_MS,
        },
      ];
    }
    if (existing.phase === 'retiring') {
      return [startReturning(updated, state.elapsedMs, currentPosition)];
    }
    if (existing.phase === 'exiting' || existing.phase === 'returning') return [updated];
    if (tx.status !== existing.tx.status) {
      if (existing.wagon && ['boarded', 'boarding', 'confirmed'].includes(existing.phase)) {
        if (existing.phase === 'boarding' && !isInsideDoorway(currentPosition)) {
          return [startWalking(updated, state.elapsedMs, currentPosition)];
        }
        return [startExit(updated, state.elapsedMs, currentPosition)];
      }
      return [startWalking(updated, state.elapsedMs, currentPosition)];
    }
    if (existing.selectedForCandidate && !accepted && tx.status !== 'confirmed') {
      if (existing.wagon && ['boarded', 'boarding'].includes(existing.phase)) {
        if (existing.phase === 'boarding' && !isInsideDoorway(currentPosition)) {
          return [startReturning(updated, state.elapsedMs, currentPosition)];
        }
        return [startExit(updated, state.elapsedMs, currentPosition)];
      }
      if (existing.phase === 'walking') {
        return [startReturning(updated, state.elapsedMs, currentPosition)];
      }
    }
    if (!existing.selectedForCandidate && accepted && existing.phase === 'queue') {
      return [startWalking(updated, state.elapsedMs, currentPosition)];
    }
    if (existing.phase === 'confirmed' && tx.status === 'confirmed') {
      if (!existing.wagon) {
        return [startWalking(updated, state.elapsedMs, currentPosition)];
      }
    }
    if (existing.phase === 'boarded' || existing.phase === 'confirmed') {
      const settled = updated;
      return [
        {
          ...settled,
          path: [settled.wagon ? seatPosition(settled) : queuePosition(settled.queueIndex)],
        },
      ];
    }
    return [updated];
  });
  passengers.push(...heldResidents);
  for (const passenger of residents) {
    if (passenger.waitingForDeparture) continue;
    if (nextIds.has(passenger.tx.id)) continue;
    const retained = { ...passenger, presentInSample: false, selectedForCandidate: false };
    passengers.push(
      preparationStartedAt !== null && joinsPreparation(retained, state.elapsedMs)
        ? preparePassenger(retained, state.elapsedMs, preparationStartedAt)
        : waitOutsideSample(retained, state.elapsedMs),
    );
  }
  const grouped = groupWaitingObservations(
    passengers,
    state.waitingArchiveCount ?? 0,
    state.elapsedMs,
  );
  const admitted = admitPassengers(
    grouped.passengers,
    admissions,
    state.elapsedMs,
    new Set([...departingIds, ...heldIds]),
  );
  if (preparationStartedAt !== null) {
    admitted.passengers = admitted.passengers.map((passenger) =>
      joinsPreparation(passenger, state.elapsedMs)
        ? preparePassenger(passenger, state.elapsedMs, preparationStartedAt)
        : passenger,
    );
  }
  return {
    ...state,
    observedBlockHash: blockHash,
    preparationStartedAt,
    candidateArrivalStartedAt:
      preparationStartedAt !== null ? null : (state.candidateArrivalStartedAt ?? null),
    departingPassengers,
    feeThreshold: plan.feeThreshold,
    waitingArchiveCount: grouped.waitingArchiveCount,
    ...candidateOccupancy(admitted.passengers),
    ...admitted,
  };
}

function carryToObserved(passenger: Passenger, now: number): Passenger {
  const from = passengerPosition(passenger, now);
  const travelY =
    wagonSeat('observed', passenger.seatIndex).y - wagonSeat('candidate', passenger.seatIndex).y;
  return {
    ...startPhase(
      passenger,
      'boarded',
      now,
      [from, { x: from.x, y: from.y + travelY }],
      HANDOFF_DURATION_MS,
    ),
    wagon: 'candidate',
    inHandoff: true,
    handoffPhase: passenger.phase,
  };
}

function departPreparedWagons(
  state: PassengerMotionState,
  departureAt: number,
): PassengerMotionState {
  const departingPassengers = passengerFrame({ ...state, elapsedMs: departureAt })
    .passengers.filter((pose) => pose.inWagon && !pose.inHandoff && pose.wagon === 'observed')
    .slice(0, MAX_RESIDENT_PASSENGERS)
    .map((pose) => ({ ...pose, sourceObserved: false }));
  const departingIds = new Set(departingPassengers.map((pose) => pose.tx.id));
  return {
    ...state,
    preparationStartedAt: null,
    handoffStartedAt: departureAt,
    candidateArrivalStartedAt: null,
    departingPassengers,
    passengers: state.passengers
      .filter((passenger) => !departingIds.has(passenger.tx.id))
      .map((passenger) =>
        passenger.phase === 'preparing' || isCandidateRider(passenger, departureAt)
          ? carryToObserved(passenger, departureAt)
          : passenger,
      ),
  };
}

function stationaryPassenger(passenger: Passenger, now: number): Passenger {
  const observed = passenger.tx.status === 'confirmed';
  const wagon: WagonKind | null =
    observed || passenger.selectedForCandidate ? (observed ? 'observed' : 'candidate') : null;
  const phase = observed ? 'confirmed' : wagon ? 'boarded' : 'queue';
  const settled = { ...passenger, seatIndex: passenger.plannedSeatIndex, wagon };
  return {
    ...settled,
    inHandoff: false,
    phase,
    phaseStartedAt: now,
    durationMs: 0,
    retryAt: now + QUEUE_RETRY_MS,
    path: [wagon ? seatPosition(settled) : queuePosition(passenger.queueIndex)],
  };
}

function advancePassenger(
  passenger: Passenger,
  now: number,
  previousTime: number,
  handoffMoving: boolean,
  candidateMoving: boolean,
): Passenger {
  if (passenger.waitingForDeparture) return passenger;
  const moving =
    handoffMoving ||
    (candidateMoving && (passenger.wagon ?? targetWagon(passenger)) === 'candidate');
  // An open-door phase must wait while its vehicle is travelling. Shifting its
  // local clock preserves the exact position instead of allowing a later time jump.
  if (
    moving &&
    !passenger.inHandoff &&
    passenger.wagon &&
    ['boarding', 'exiting'].includes(passenger.phase)
  ) {
    return { ...passenger, phaseStartedAt: passenger.phaseStartedAt + now - previousTime };
  }
  const currentPosition = passengerPosition(passenger, now);
  if (passenger.phase === 'parked') return passenger;
  if (passenger.phase === 'retiring') return startReturning(passenger, now, currentPosition);
  if (passenger.inHandoff) {
    if (now - passenger.phaseStartedAt < HANDOFF_DURATION_MS) return passenger;
    const landedPoint = passengerPosition(passenger, now);
    const landed = {
      ...passenger,
      wagon: 'observed' as const,
      inHandoff: false,
      path: [landedPoint],
      phaseStartedAt: now,
      durationMs: 0,
      handoffPhase: undefined,
    };
    if (passenger.presentInSample && passenger.tx.status === 'confirmed') {
      if (passenger.handoffPhase === 'exiting') return startExit(landed, now, landedPoint);
      if (passenger.handoffPhase === 'boarding') {
        return startPhase(landed, 'boarding', now, [landedPoint, seatPosition(landed)], 400);
      }
      return { ...landed, phase: 'confirmed', path: [landedPoint] };
    }
    // Pending riders leave through the lower door only after the wagon has stopped.
    return startExit(landed, now, landedPoint);
  }
  if (passenger.phase === 'arriving') {
    if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
    if (!passenger.presentInSample) return parkAtQueue(passenger, now);
    return {
      ...startPhase(passenger, 'queue', now, [queuePosition(passenger.queueIndex)], 0),
      wagon: null,
      retryAt: now + (stableHash(passenger.tx.id) % 190),
    };
  }
  if (passenger.phase === 'queue') {
    if (!passenger.presentInSample) return parkAtQueue(passenger, now);
    if (moving || now < passenger.retryAt) return passenger;
    return startWalking(passenger, now, currentPosition);
  }
  if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
  if (passenger.phase === 'walking') {
    if (moving) return passenger;
    if (passenger.tx.status === 'confirmed' || passenger.selectedForCandidate) {
      const wagon = targetWagon(passenger);
      const boarding = { ...passenger, wagon, seatIndex: passenger.plannedSeatIndex };
      return startPhase(
        boarding,
        'boarding',
        now,
        [currentPosition, entryDoorPoint(wagon), seatPosition(boarding)],
        1_000,
      );
    }
    return startReturning(passenger, now, currentPosition);
  }
  if (passenger.phase === 'boarding') {
    if (moving) return passenger;
    return startPhase(
      passenger,
      passenger.tx.status === 'confirmed' ? 'confirmed' : 'boarded',
      now,
      [seatPosition(passenger)],
      0,
    );
  }
  if (passenger.phase === 'exiting') {
    if (moving) return passenger;
    return startReturning(passenger, now, currentPosition);
  }
  if (passenger.phase === 'returning') {
    if (!passenger.presentInSample) {
      if (passenger.joiningArchive) {
        return {
          ...startPhase(passenger, 'parked', now, [WAITING_ARCHIVE_POSITION], 0),
          wagon: null,
        };
      }
      return parkAtQueue(passenger, now);
    }
    return {
      ...startPhase(passenger, 'queue', now, [queuePosition(passenger.queueIndex)], 0),
      wagon: null,
      retryAt:
        now +
        (passenger.selectedForCandidate || passenger.tx.status === 'confirmed'
          ? 300
          : QUEUE_RETRY_MS),
    };
  }
  return passenger;
}

/** Accumulated visual time cannot jump after a paused/backgrounded tab resumes. */
export function advancePassengerMotion(
  state: PassengerMotionState,
  deltaMs: number,
  { paused = false, hidden = false, reducedMotion = false, speed = 1 }: PassengerClockOptions = {},
): PassengerMotionState {
  if (reducedMotion) {
    // Keep a preparation or transfer frozen with its occupants when motion is reduced.
    if (state.handoffStartedAt !== null || (state.preparationStartedAt ?? null) !== null)
      return state;
    return {
      ...state,
      handoffStartedAt: null,
      candidateArrivalStartedAt: null,
      passengers: state.passengers.map((passenger) =>
        passenger.presentInSample ? stationaryPassenger(passenger, state.elapsedMs) : passenger,
      ),
    };
  }
  if (paused || hidden || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const boundedSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const elapsedMs = state.elapsedMs + Math.min(MAX_STEP_MS, deltaMs) * boundedSpeed;
  const preparationStartedAt = state.preparationStartedAt ?? null;
  const workingState =
    preparationStartedAt !== null && elapsedMs - preparationStartedAt >= PREPARATION_DURATION_MS
      ? departPreparedWagons(state, preparationStartedAt + PREPARATION_DURATION_MS)
      : state;
  const handoffStartedAt = workingState.handoffStartedAt;
  const handoffMoving =
    handoffStartedAt !== null && elapsedMs - handoffStartedAt < HANDOFF_DURATION_MS;
  const arrivalStartedAt =
    handoffStartedAt !== null && !handoffMoving
      ? handoffStartedAt + HANDOFF_DURATION_MS
      : (workingState.candidateArrivalStartedAt ?? null);
  const candidateArrivalStartedAt =
    arrivalStartedAt !== null && elapsedMs - arrivalStartedAt < CANDIDATE_ARRIVAL_DURATION_MS
      ? arrivalStartedAt
      : null;
  const advanced = workingState.passengers.map((passenger) =>
    advancePassenger(
      passenger,
      elapsedMs,
      state.elapsedMs,
      handoffMoving,
      candidateArrivalStartedAt !== null,
    ),
  );
  const grouped = groupWaitingObservations(
    advanced,
    workingState.waitingArchiveCount ?? 0,
    elapsedMs,
  );
  const residents = grouped.passengers;
  const blockedIds = new Set([
    ...(handoffMoving ? (workingState.departingPassengers ?? []).map((pose) => pose.tx.id) : []),
    ...residents
      .filter((passenger) => passenger.waitingForDeparture)
      .map((passenger) => passenger.tx.id),
  ]);
  const admitted = admitPassengers(
    residents,
    workingState.pendingAdmissions ?? [],
    elapsedMs,
    blockedIds,
  );
  const ongoingPreparation = workingState.preparationStartedAt ?? null;
  if (ongoingPreparation !== null) {
    admitted.passengers = admitted.passengers.map((passenger) =>
      joinsPreparation(passenger, elapsedMs)
        ? preparePassenger(passenger, elapsedMs, ongoingPreparation)
        : passenger,
    );
  }
  return {
    ...workingState,
    elapsedMs,
    handoffStartedAt: handoffMoving ? workingState.handoffStartedAt : null,
    candidateArrivalStartedAt,
    departingPassengers: handoffMoving ? (workingState.departingPassengers ?? []) : [],
    waitingArchiveCount: grouped.waitingArchiveCount,
    ...candidateOccupancy(admitted.passengers),
    ...admitted,
  };
}

export function passengerFrame(state: PassengerMotionState): PassengerFrame {
  const preparationStartedAt = state.preparationStartedAt ?? null;
  const candidateArrivalStartedAt = state.candidateArrivalStartedAt ?? null;
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
    candidate: { entry: preparationStartedAt !== null, exit: false },
    observed: { entry: false, exit: false },
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
    const from = passenger.path[0] ?? point;
    const to = passenger.path[passenger.path.length - 1] ?? point;
    if (
      state.handoffStartedAt === null &&
      !passenger.waitingForDeparture &&
      passenger.wagon &&
      (passenger.wagon !== 'candidate' || candidateArrivalStartedAt === null)
    ) {
      if (passenger.phase === 'boarding') doors[passenger.wagon].entry = true;
      if (passenger.phase === 'exiting') doors[passenger.wagon].exit = true;
    }
    const inWagon =
      passenger.wagon !== null &&
      (passenger.inHandoff ||
        passenger.phase === 'boarded' ||
        passenger.phase === 'confirmed' ||
        (['boarding', 'preparing', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)));
    return {
      tx: passenger.tx,
      ...point,
      queueX: queue.x,
      queueY: queue.y,
      phase: passenger.phase,
      destination: destination(passenger),
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
  return {
    passengers,
    departingPassengers: state.departingPassengers ?? [],
    counts,
    candidateCount: state.candidateCount,
    candidateUsed: state.candidateUsed,
    candidateCapacity: CANDIDATE_CAPACITY,
    feeThreshold: state.feeThreshold,
    elapsedMs: state.elapsedMs,
    preparationProgress:
      preparationStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(0, (state.elapsedMs - preparationStartedAt) / PREPARATION_DURATION_MS),
          ),
    preparationPassengerCount: state.passengers.filter(
      (passenger) => passenger.phase === 'preparing',
    ).length,
    waitingArchiveCount: state.waitingArchiveCount ?? 0,
    handoffProgress:
      state.handoffStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(0, (state.elapsedMs - state.handoffStartedAt) / HANDOFF_DURATION_MS),
          ),
    candidateArrivalProgress:
      candidateArrivalStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(
              0,
              (state.elapsedMs - candidateArrivalStartedAt) / CANDIDATE_ARRIVAL_DURATION_MS,
            ),
          ),
    doors,
  };
}
