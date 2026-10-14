import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerFrame,
} from '../lib/passengerMotion';

interface PassengerMotionOptions {
  snapshot: Snapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
}

const FRAME_INTERVAL_MS = 1_000 / 24;

function sameVisibleFrame(previous: PassengerFrame, next: PassengerFrame): boolean {
  // The engine clock keeps advancing for deadlines and admissions, but it is not
  // itself drawn. Only publish when a person, vehicle, door or displayed count changes.
  return (
    previous.passengers === next.passengers &&
    (previous.departingPassengers === next.departingPassengers ||
      (previous.departingPassengers.length === 0 && next.departingPassengers.length === 0)) &&
    previous.departingBlock === next.departingBlock &&
    previous.departureRecovered === next.departureRecovered &&
    previous.lastDepartureStartedAt === next.lastDepartureStartedAt &&
    previous.candidateCount === next.candidateCount &&
    previous.candidateUsed === next.candidateUsed &&
    previous.candidateCapacity === next.candidateCapacity &&
    previous.projectionCount.next === next.projectionCount.next &&
    previous.projectionCount.later === next.projectionCount.later &&
    previous.projectionUsed.next === next.projectionUsed.next &&
    previous.projectionUsed.later === next.projectionUsed.later &&
    previous.feeThreshold === next.feeThreshold &&
    previous.preparationProgress === next.preparationProgress &&
    previous.preparationPassengerCount === next.preparationPassengerCount &&
    previous.waitingArchiveCount === next.waitingArchiveCount &&
    previous.waitingArchiveTrackedCount === next.waitingArchiveTrackedCount &&
    previous.waitingArchiveUnknownCount === next.waitingArchiveUnknownCount &&
    previous.handoffProgress === next.handoffProgress &&
    previous.laterArrivalProgress === next.laterArrivalProgress &&
    previous.candidateArrivalProgress === next.candidateArrivalProgress &&
    previous.doors.next.entry === next.doors.next.entry &&
    previous.doors.next.exit === next.doors.next.exit &&
    previous.doors.later.entry === next.doors.later.entry &&
    previous.doors.later.exit === next.doors.later.exit &&
    previous.counts.arriving === next.counts.arriving &&
    previous.counts.queue === next.counts.queue &&
    previous.counts.reordering === next.counts.reordering &&
    previous.counts.parked === next.counts.parked &&
    previous.counts.walking === next.counts.walking &&
    previous.counts.boarding === next.counts.boarding &&
    previous.counts.preparing === next.counts.preparing &&
    previous.counts.boarded === next.counts.boarded &&
    previous.counts.exiting === next.counts.exiting &&
    previous.counts.returning === next.counts.returning &&
    previous.counts.retiring === next.counts.retiring &&
    previous.counts.confirmed === next.counts.confirmed
  );
}

/** One bounded animation clock for all people; data refreshes retain their visual positions. */
export function usePassengerMotion({
  snapshot,
  paused,
  speed,
  reducedMotion,
}: PassengerMotionOptions) {
  const [initialMotion] = useState(() =>
    advancePassengerMotion(createPassengerMotion(snapshot), 0, { reducedMotion }),
  );
  const motion = useRef(initialMotion);
  const [frame, setFrame] = useState(() => passengerFrame(motion.current));
  const renderedFrame = useRef(frame);
  const [lastDepartureAt, setLastDepartureAt] = useState<number | null>(null);
  const recordedDepartureMarker = useRef<number | null>(null);
  const publishFrame = useCallback(() => {
    const next = passengerFrame(motion.current);
    if (sameVisibleFrame(renderedFrame.current, next)) return;
    renderedFrame.current = next;
    setFrame(next);
  }, []);

  useEffect(() => {
    // The marker persists after the moving wagon leaves, including while paused or reduced.
    if (frame.lastDepartureStartedAt === recordedDepartureMarker.current) return;
    recordedDepartureMarker.current = frame.lastDepartureStartedAt;
    setLastDepartureAt(frame.lastDepartureStartedAt === null ? null : Date.now());
  }, [frame.lastDepartureStartedAt]);

  useEffect(() => {
    motion.current = reconcilePassengerMotion(motion.current, snapshot);
    motion.current = advancePassengerMotion(motion.current, 0, { reducedMotion });
    publishFrame();
  }, [snapshot, reducedMotion, publishFrame]);

  useEffect(() => {
    if (paused || reducedMotion) return;
    let animationId: number | null = null;
    let previousTime: number | null = null;
    let active = true;
    const animate = (time: number) => {
      animationId = null;
      if (!active || document.hidden) {
        previousTime = null;
        return;
      }
      if (previousTime === null) {
        previousTime = time;
      } else if (time - previousTime >= FRAME_INTERVAL_MS) {
        motion.current = advancePassengerMotion(motion.current, time - previousTime, { speed });
        publishFrame();
        previousTime = time;
      }
      animationId = requestAnimationFrame(animate);
    };
    const visibilityChanged = () => {
      previousTime = null;
      if (document.hidden) {
        if (animationId !== null) cancelAnimationFrame(animationId);
        animationId = null;
      } else if (active && animationId === null) {
        animationId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    visibilityChanged();
    return () => {
      active = false;
      if (animationId !== null) cancelAnimationFrame(animationId);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [paused, speed, reducedMotion, publishFrame]);

  return { ...frame, lastDepartureAt };
}
