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
/** A deliberately small illustrated budget, never a real network block capacity. */
export const CANDIDATE_CAPACITY = 12;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 3_000;
const GEOMETRY_VERSION = 'right-platform-v1';

export type PassengerPhase =
  'queue' | 'walking' | 'boarding' | 'boarded' | 'exiting' | 'returning' | 'confirmed';
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
  presentInSample: boolean;
}

export interface PassengerMotionState {
  context: string;
  elapsedMs: number;
  observedBlockHash: string | null;
  handoffStartedAt: number | null;
  feeThreshold: number | null;
  candidateCount: number;
  candidateUsed: number;
  passengers: Passenger[];
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
  headScale: number;
  resourceUnits: number;
  opacity: number;
  progress: number;
  facing: 1 | -1;
  walkPhase: number;
}

export interface PassengerFrame {
  passengers: PassengerPose[];
  counts: Record<PassengerPhase, number>;
  candidateCount: number;
  candidateUsed: number;
  candidateCapacity: number;
  feeThreshold: number | null;
  elapsedMs: number;
  handoffProgress: number | null;
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
    (['boarded', 'boarding'].includes(passenger.phase) ||
      (passenger.phase === 'exiting' && isInsideDoorway(passengerPosition(passenger, now))))
  );
}

export function createPassengerMotion(snapshot: Snapshot): PassengerMotionState {
  const plan = planSnapshot(snapshot);
  let observedIndex = 0;
  return {
    context: motionContext(snapshot),
    elapsedMs: 0,
    observedBlockHash: snapshot.blocks[0]?.hash ?? null,
    handoffStartedAt: null,
    feeThreshold: plan.feeThreshold,
    candidateCount: plan.accepted.size,
    candidateUsed: plan.used,
    passengers: plan.transactions.map((tx, queueIndex) => {
      const seatIndex =
        tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0);
      return {
        tx,
        queueIndex,
        seatIndex,
        plannedSeatIndex: seatIndex,
        selectedForCandidate: plan.accepted.has(tx.id),
        reason: plan.reasons.get(tx.id) ?? 'capacity',
        phase: 'queue',
        phaseStartedAt: 0,
        durationMs: 0,
        retryAt: (queueIndex % 16) * 110 + (stableHash(tx.id) % 190),
        path: [queuePosition(queueIndex)],
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
  const startHandoff = newObservedBlock && state.handoffStartedAt === null;
  const previous = new Map(state.passengers.map((passenger) => [passenger.tx.id, passenger]));
  const nextIds = new Set(plan.transactions.map((tx) => tx.id));
  // Carry disappearing sample IDs until arrival, then remove them without inventing confirmation.
  const retainedRiders =
    snapshot.status === 'unavailable'
      ? []
      : state.passengers.filter(
          (passenger) =>
            !nextIds.has(passenger.tx.id) &&
            (passenger.inHandoff || (startHandoff && isCandidateRider(passenger, state.elapsedMs))),
        );
  const transactions = plan.transactions.slice(0, MAX_PASSENGERS - retainedRiders.length);
  const retainedIndices = new Set([
    ...transactions.flatMap((tx) => {
      const passenger = previous.get(tx.id);
      return passenger ? [passenger.queueIndex] : [];
    }),
    ...retainedRiders.map((passenger) => passenger.queueIndex),
  ]);
  let observedIndex = 0;
  const passengers = transactions.map((tx): Passenger => {
    const existing = previous.get(tx.id);
    const accepted = plan.accepted.has(tx.id);
    let queueIndex = existing?.queueIndex ?? 0;
    if (!existing) {
      while (retainedIndices.has(queueIndex)) queueIndex += 1;
      retainedIndices.add(queueIndex);
    }
    const plannedSeatIndex =
      tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0);
    const updated: Passenger = {
      tx,
      queueIndex,
      seatIndex: existing?.wagon ? existing.seatIndex : plannedSeatIndex,
      plannedSeatIndex,
      selectedForCandidate: accepted,
      reason: plan.reasons.get(tx.id) ?? 'capacity',
      phase: existing?.phase ?? 'queue',
      phaseStartedAt: existing?.phaseStartedAt ?? state.elapsedMs,
      durationMs: existing?.durationMs ?? 0,
      retryAt: existing?.retryAt ?? state.elapsedMs + (stableHash(tx.id) % 800),
      path: existing?.path ?? [queuePosition(queueIndex)],
      wagon: existing?.wagon ?? null,
      inHandoff: existing?.inHandoff ?? false,
      presentInSample: true,
    };
    if (!existing || existing.inHandoff) return updated;
    if (startHandoff && isCandidateRider(existing, state.elapsedMs)) {
      return carryToObserved(updated, state.elapsedMs);
    }
    const currentPosition = passengerPosition(existing, state.elapsedMs);
    if (existing.phase === 'exiting' || existing.phase === 'returning') return updated;
    if (tx.status !== existing.tx.status) {
      if (existing.wagon && ['boarded', 'boarding', 'confirmed'].includes(existing.phase)) {
        if (existing.phase === 'boarding' && !isInsideDoorway(currentPosition)) {
          return startWalking(updated, state.elapsedMs, currentPosition);
        }
        return startExit(updated, state.elapsedMs, currentPosition);
      }
      return startWalking(updated, state.elapsedMs, currentPosition);
    }
    if (existing.selectedForCandidate && !accepted && tx.status !== 'confirmed') {
      if (existing.wagon && ['boarded', 'boarding'].includes(existing.phase)) {
        if (existing.phase === 'boarding' && !isInsideDoorway(currentPosition)) {
          return startReturning(updated, state.elapsedMs, currentPosition);
        }
        return startExit(updated, state.elapsedMs, currentPosition);
      }
      if (existing.phase === 'walking') {
        return startReturning(updated, state.elapsedMs, currentPosition);
      }
    }
    if (!existing.selectedForCandidate && accepted && existing.phase === 'queue') {
      return startWalking(updated, state.elapsedMs, currentPosition);
    }
    if (
      existing.wagon &&
      plannedSeatIndex >= 12 &&
      ['boarded', 'confirmed'].includes(existing.phase)
    ) {
      return startExit(updated, state.elapsedMs, currentPosition);
    }
    if (existing.phase === 'confirmed' && tx.status === 'confirmed') {
      if (!existing.wagon && plannedSeatIndex < 12) {
        return startWalking(updated, state.elapsedMs, currentPosition);
      }
    }
    if (existing.phase === 'boarded' || existing.phase === 'confirmed') {
      const settled = { ...updated, seatIndex: plannedSeatIndex };
      return {
        ...settled,
        path: [settled.wagon ? seatPosition(settled) : queuePosition(queueIndex)],
      };
    }
    return updated;
  });
  for (const passenger of retainedRiders) {
    const retained = { ...passenger, presentInSample: false };
    passengers.push(passenger.inHandoff ? retained : carryToObserved(retained, state.elapsedMs));
  }
  return {
    ...state,
    observedBlockHash: blockHash,
    handoffStartedAt: startHandoff ? state.elapsedMs : state.handoffStartedAt,
    feeThreshold: plan.feeThreshold,
    candidateCount: plan.accepted.size,
    candidateUsed: plan.used,
    passengers,
  };
}

function carryToObserved(passenger: Passenger, now: number): Passenger {
  return {
    ...startPhase(
      passenger,
      'boarded',
      now,
      [wagonSeat('candidate', passenger.seatIndex), wagonSeat('observed', passenger.seatIndex)],
      HANDOFF_DURATION_MS,
    ),
    wagon: 'candidate',
    inHandoff: true,
  };
}

function stationaryPassenger(passenger: Passenger, now: number): Passenger {
  const observed = passenger.tx.status === 'confirmed';
  const fits = passenger.plannedSeatIndex < 12;
  const wagon: WagonKind | null =
    fits && (observed || passenger.selectedForCandidate)
      ? observed
        ? 'observed'
        : 'candidate'
      : null;
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
  moving: boolean,
): Passenger {
  // An open-door phase must wait while either vehicle is travelling. Shifting its
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
  if (passenger.inHandoff) {
    if (now - passenger.phaseStartedAt < HANDOFF_DURATION_MS) return passenger;
    const landed = {
      ...passenger,
      wagon: 'observed' as const,
      inHandoff: false,
      path: [wagonSeat('observed', passenger.seatIndex)],
      phaseStartedAt: now,
      durationMs: 0,
    };
    if (passenger.tx.status === 'confirmed' && passenger.plannedSeatIndex < 12) {
      const seated = { ...landed, seatIndex: passenger.plannedSeatIndex };
      return { ...seated, phase: 'confirmed', path: [seatPosition(seated)] };
    }
    // Pending riders leave through the lower door only after the wagon has stopped.
    return startExit(landed, now, seatPosition(landed));
  }
  if (passenger.phase === 'queue') {
    if (passenger.tx.status === 'confirmed' && passenger.plannedSeatIndex >= 12) {
      return { ...passenger, phase: 'confirmed', wagon: null };
    }
    if (moving || now < passenger.retryAt) return passenger;
    return startWalking(passenger, now, currentPosition);
  }
  if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
  if (passenger.phase === 'walking') {
    if (moving) return passenger;
    if (passenger.tx.status === 'confirmed' || passenger.selectedForCandidate) {
      const wagon = targetWagon(passenger);
      if (passenger.plannedSeatIndex >= 12) {
        return startReturning(passenger, now, currentPosition);
      }
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
    const phase =
      passenger.tx.status === 'confirmed' && passenger.plannedSeatIndex >= 12
        ? 'confirmed'
        : 'queue';
    return {
      ...startPhase(passenger, phase, now, [queuePosition(passenger.queueIndex)], 0),
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
    return {
      ...state,
      handoffStartedAt: null,
      passengers: state.passengers
        .filter((passenger) => passenger.presentInSample)
        .map((passenger) => stationaryPassenger(passenger, state.elapsedMs)),
    };
  }
  if (paused || hidden || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const boundedSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const elapsedMs = state.elapsedMs + Math.min(MAX_STEP_MS, deltaMs) * boundedSpeed;
  const moving =
    state.handoffStartedAt !== null && elapsedMs - state.handoffStartedAt < HANDOFF_DURATION_MS;
  return {
    ...state,
    elapsedMs,
    handoffStartedAt: moving ? state.handoffStartedAt : null,
    passengers: state.passengers
      .filter((passenger) => passenger.presentInSample || moving)
      .map((passenger) => advancePassenger(passenger, elapsedMs, state.elapsedMs, moving)),
  };
}

export function passengerFrame(state: PassengerMotionState): PassengerFrame {
  const counts: Record<PassengerPhase, number> = {
    queue: 0,
    walking: 0,
    boarding: 0,
    boarded: 0,
    exiting: 0,
    returning: 0,
    confirmed: 0,
  };
  const doors: PassengerFrame['doors'] = {
    candidate: { entry: false, exit: false },
    observed: { entry: false, exit: false },
  };
  const passengers = state.passengers.map((passenger): PassengerPose => {
    counts[passenger.phase] += 1;
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
    if (state.handoffStartedAt === null && passenger.wagon) {
      if (passenger.phase === 'boarding') doors[passenger.wagon].entry = true;
      if (passenger.phase === 'exiting') doors[passenger.wagon].exit = true;
    }
    const inWagon =
      passenger.wagon !== null &&
      passenger.seatIndex < 12 &&
      (passenger.inHandoff ||
        passenger.phase === 'boarded' ||
        passenger.phase === 'confirmed' ||
        (['boarding', 'exiting'].includes(passenger.phase) && isInsideDoorway(point)));
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
      headScale: transactionHeadScale(passenger.tx),
      resourceUnits: transactionResourceUnits(passenger.tx),
      opacity: inWagon ? 0.82 : 1,
      progress,
      facing: to.x < from.x ? -1 : 1,
      walkPhase: (state.elapsedMs / 160 + (stableHash(passenger.tx.id) % 7)) % (Math.PI * 2),
    };
  });
  return {
    passengers,
    counts,
    candidateCount: state.candidateCount,
    candidateUsed: state.candidateUsed,
    candidateCapacity: CANDIDATE_CAPACITY,
    feeThreshold: state.feeThreshold,
    elapsedMs: state.elapsedMs,
    handoffProgress:
      state.handoffStartedAt === null
        ? null
        : Math.min(
            1,
            Math.max(0, (state.elapsedMs - state.handoffStartedAt) / HANDOFF_DURATION_MS),
          ),
    doors,
  };
}
