import type { Snapshot, Tx } from '../../shared/model';

export const MAX_PASSENGERS = 80;
/** A deliberately small illustrated budget, never a real network block capacity. */
export const CANDIDATE_CAPACITY = 12;
const MAX_STEP_MS = 100;
const QUEUE_RETRY_MS = 8_000;
export const HANDOFF_DURATION_MS = 3_000;

export type PassengerPhase =
  'queue' | 'walking' | 'boarding' | 'boarded' | 'exiting' | 'returning' | 'confirmed';
export type PassengerDestination = 'candidate' | 'observed' | 'queue';
export type PassengerReason = 'accepted' | 'fee' | 'capacity' | 'observed';

interface Point {
  x: number;
  y: number;
}

interface Passenger {
  tx: Tx;
  queueIndex: number;
  seatIndex: number;
  selectedForCandidate: boolean;
  reason: PassengerReason;
  phase: PassengerPhase;
  phaseStartedAt: number;
  durationMs: number;
  retryAt: number;
  path: Point[];
  inHandoff: boolean;
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
}

export interface PassengerClockOptions {
  paused?: boolean;
  hidden?: boolean;
  reducedMotion?: boolean;
  speed?: number;
}

const candidateDoor: Point = { x: 1_003, y: 430 };
const observedDoor: Point = { x: 472, y: 452 };

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function queuePosition(index: number): Point {
  const localIndex = index % 40;
  const row = Math.floor(localIndex / 10);
  return {
    x: (index >= 40 ? 775 : 323) + (localIndex % 10) * 23 + row * 4,
    y: 293 + row * 24,
  };
}

function destination(passenger: Passenger): PassengerDestination {
  return passenger.tx.status === 'confirmed'
    ? 'observed'
    : passenger.selectedForCandidate
      ? 'candidate'
      : 'queue';
}

function doorPosition(passenger: Passenger): Point {
  return passenger.tx.status === 'confirmed' ? observedDoor : candidateDoor;
}

function seatPosition(passenger: Passenger): Point {
  const observed = passenger.tx.status === 'confirmed';
  // Repeated source samples may contain more observed transactions than visible seats.
  // They stay on the observed platform rather than suggesting extra vehicle capacity.
  if (observed && passenger.seatIndex >= 12) {
    return {
      x: 290 + ((passenger.seatIndex - 12) % 14) * 14,
      y: 506 + Math.floor((passenger.seatIndex - 12) / 14) * 14,
    };
  }
  return {
    x: (observed ? 276 : 807) + (passenger.seatIndex % 6) * 28,
    y: (observed ? 452 : 430) + Math.floor(passenger.seatIndex / 6) * 12,
  };
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

function interpolatePath(path: Point[], progress: number): Point {
  const start = path[0] ?? { x: 0, y: 0 };
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

function passengerPosition(passenger: Passenger, elapsedMs: number): Point {
  const progress =
    passenger.durationMs > 0
      ? Math.min(1, Math.max(0, (elapsedMs - passenger.phaseStartedAt) / passenger.durationMs))
      : 1;
  return interpolatePath(passenger.path, progress);
}

function pathDuration(path: Point[]): number {
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
  path: Point[],
  durationMs: number,
): Passenger {
  return { ...passenger, inHandoff: false, phase, phaseStartedAt: now, durationMs, path };
}

function walkingPath(from: Point, to: Point): Point[] {
  return [from, { x: from.x + (to.x - from.x) * 0.35, y: 379 }, { x: to.x - 18, y: 402 }, to];
}

export function createPassengerMotion(snapshot: Snapshot): PassengerMotionState {
  const plan = planSnapshot(snapshot);
  let observedIndex = 0;
  return {
    context: `${snapshot.chain}:${snapshot.mode}`,
    elapsedMs: 0,
    observedBlockHash: snapshot.blocks[0]?.hash ?? null,
    handoffStartedAt: null,
    feeThreshold: plan.feeThreshold,
    candidateCount: plan.accepted.size,
    candidateUsed: plan.used,
    passengers: plan.transactions.map((tx, queueIndex) => {
      const queue = queuePosition(queueIndex);
      return {
        tx,
        queueIndex,
        seatIndex: tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0),
        selectedForCandidate: plan.accepted.has(tx.id),
        reason: plan.reasons.get(tx.id) ?? 'capacity',
        phase: 'queue',
        phaseStartedAt: 0,
        durationMs: 0,
        retryAt: (queueIndex % 16) * 110 + (stableHash(tx.id) % 190),
        path: [queue],
        inHandoff: false,
      };
    }),
  };
}

/** Source removal merely removes the sample; it must never become a confirmation. */
export function reconcilePassengerMotion(
  state: PassengerMotionState,
  snapshot: Snapshot,
): PassengerMotionState {
  if (state.context !== `${snapshot.chain}:${snapshot.mode}`)
    return createPassengerMotion(snapshot);
  const plan = planSnapshot(snapshot);
  const blockHash = snapshot.blocks[0]?.hash ?? null;
  const newObservedBlock =
    snapshot.mode === 'live' &&
    snapshot.status === 'ok' &&
    blockHash !== null &&
    state.observedBlockHash !== null &&
    blockHash !== state.observedBlockHash;
  const previous = new Map(state.passengers.map((passenger) => [passenger.tx.id, passenger]));
  const retainedIndices = new Set(
    plan.transactions.flatMap((tx) => {
      const passenger = previous.get(tx.id);
      return passenger ? [passenger.queueIndex] : [];
    }),
  );
  let observedIndex = 0;
  const passengers = plan.transactions.map((tx): Passenger => {
    const existing = previous.get(tx.id);
    const accepted = plan.accepted.has(tx.id);
    let queueIndex = existing?.queueIndex ?? 0;
    if (!existing) {
      while (retainedIndices.has(queueIndex)) queueIndex += 1;
      retainedIndices.add(queueIndex);
    }
    const updated: Passenger = {
      tx,
      queueIndex,
      seatIndex: tx.status === 'confirmed' ? observedIndex++ : (plan.accepted.get(tx.id) ?? 0),
      selectedForCandidate: accepted,
      reason: plan.reasons.get(tx.id) ?? 'capacity',
      phase: existing?.phase ?? 'queue',
      phaseStartedAt: existing?.phaseStartedAt ?? state.elapsedMs,
      durationMs: existing?.durationMs ?? 0,
      retryAt: existing?.retryAt ?? state.elapsedMs + (stableHash(tx.id) % 800),
      path: existing?.path ?? [queuePosition(queueIndex)],
      inHandoff: existing?.inHandoff ?? false,
    };
    if (!existing) return updated;
    const currentPosition = passengerPosition(existing, state.elapsedMs);
    if (tx.status === 'confirmed' && existing.tx.status !== 'confirmed') {
      if (newObservedBlock && existing.phase === 'boarded') {
        return {
          ...startPhase(
            updated,
            'boarding',
            state.elapsedMs,
            [currentPosition, seatPosition(updated)],
            HANDOFF_DURATION_MS,
          ),
          inHandoff: true,
        };
      }
      const path = walkingPath(currentPosition, observedDoor);
      return startPhase(updated, 'walking', state.elapsedMs, path, pathDuration(path));
    }
    if (
      newObservedBlock &&
      tx.status === 'pending' &&
      ['boarded', 'boarding'].includes(existing.phase)
    ) {
      return {
        ...startPhase(updated, 'exiting', state.elapsedMs, [currentPosition, candidateDoor], 650),
        inHandoff: false,
      };
    }
    if (tx.status === 'pending' && existing.tx.status === 'confirmed') {
      const target = accepted ? candidateDoor : queuePosition(updated.queueIndex);
      const path = walkingPath(currentPosition, target);
      return startPhase(
        updated,
        accepted ? 'walking' : 'returning',
        state.elapsedMs,
        path,
        pathDuration(path),
      );
    }
    if (existing.selectedForCandidate && !accepted && tx.status !== 'confirmed') {
      if (existing.phase === 'boarded' || existing.phase === 'boarding') {
        return startPhase(
          updated,
          'exiting',
          state.elapsedMs,
          [currentPosition, candidateDoor],
          650,
        );
      }
    }
    if (!existing.selectedForCandidate && accepted && existing.phase !== 'returning') {
      const path = walkingPath(currentPosition, candidateDoor);
      return startPhase(updated, 'walking', state.elapsedMs, path, pathDuration(path));
    }
    if (existing.phase === 'boarded' || existing.phase === 'confirmed') {
      return { ...updated, path: [seatPosition(updated)] };
    }
    return updated;
  });
  return {
    ...state,
    observedBlockHash: blockHash,
    handoffStartedAt: newObservedBlock ? state.elapsedMs : state.handoffStartedAt,
    feeThreshold: plan.feeThreshold,
    candidateCount: plan.accepted.size,
    candidateUsed: plan.used,
    passengers,
  };
}

function stationaryPassenger(passenger: Passenger, now: number): Passenger {
  const phase =
    passenger.tx.status === 'confirmed'
      ? 'confirmed'
      : passenger.selectedForCandidate
        ? 'boarded'
        : 'queue';
  return {
    ...passenger,
    inHandoff: false,
    phase,
    phaseStartedAt: now,
    durationMs: 0,
    retryAt: now + QUEUE_RETRY_MS,
    path: [phase === 'queue' ? queuePosition(passenger.queueIndex) : seatPosition(passenger)],
  };
}

function advancePassenger(passenger: Passenger, now: number): Passenger {
  const currentPosition = passengerPosition(passenger, now);
  if (passenger.phase === 'queue') {
    if (now < passenger.retryAt) return passenger;
    const path = walkingPath(currentPosition, doorPosition(passenger));
    return startPhase(passenger, 'walking', now, path, pathDuration(path));
  }
  if (now - passenger.phaseStartedAt < passenger.durationMs) return passenger;
  if (passenger.phase === 'walking') {
    if (passenger.tx.status === 'confirmed' || passenger.selectedForCandidate) {
      return startPhase(
        passenger,
        'boarding',
        now,
        [currentPosition, seatPosition(passenger)],
        650,
      );
    }
    return startPhase(passenger, 'exiting', now, [currentPosition, { x: 1_024, y: 450 }], 500);
  }
  if (passenger.phase === 'boarding') {
    return {
      ...startPhase(
        passenger,
        passenger.tx.status === 'confirmed' ? 'confirmed' : 'boarded',
        now,
        [seatPosition(passenger)],
        0,
      ),
      inHandoff: false,
    };
  }
  if (passenger.phase === 'exiting') {
    const path = walkingPath(currentPosition, queuePosition(passenger.queueIndex));
    return startPhase(passenger, 'returning', now, path, pathDuration(path));
  }
  if (passenger.phase === 'returning') {
    return {
      ...startPhase(passenger, 'queue', now, [queuePosition(passenger.queueIndex)], 0),
      retryAt: now + (passenger.selectedForCandidate ? 300 : QUEUE_RETRY_MS),
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
      passengers: state.passengers.map((passenger) =>
        stationaryPassenger(passenger, state.elapsedMs),
      ),
    };
  }
  if (paused || hidden || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const boundedSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const elapsedMs = state.elapsedMs + Math.min(MAX_STEP_MS, deltaMs) * boundedSpeed;
  return {
    ...state,
    elapsedMs,
    handoffStartedAt:
      state.handoffStartedAt !== null && elapsedMs - state.handoffStartedAt >= HANDOFF_DURATION_MS
        ? null
        : state.handoffStartedAt,
    passengers: state.passengers.map((passenger) => advancePassenger(passenger, elapsedMs)),
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
    return {
      tx: passenger.tx,
      ...point,
      queueX: queue.x,
      queueY: queue.y,
      phase: passenger.phase,
      destination: destination(passenger),
      reason: passenger.reason,
      selectedForCandidate: passenger.selectedForCandidate,
      inWagon:
        (passenger.inHandoff || passenger.phase === 'boarded' || passenger.phase === 'confirmed') &&
        passenger.seatIndex < 12,
      inHandoff: passenger.inHandoff,
      headScale: transactionHeadScale(passenger.tx),
      resourceUnits: transactionResourceUnits(passenger.tx),
      opacity: passenger.phase === 'boarded' || passenger.phase === 'confirmed' ? 0.82 : 1,
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
  };
}
