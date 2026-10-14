import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/model';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
} from '../lib/passengerMotion';

interface PassengerMotionOptions {
  snapshot: Snapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
}

const FRAME_INTERVAL_MS = 1_000 / 24;

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
  const [lastDepartureAt, setLastDepartureAt] = useState<number | null>(null);
  const recordedDepartureMarker = useRef<number | null>(null);

  useEffect(() => {
    // The marker persists after the moving wagon leaves, including while paused or reduced.
    if (frame.lastDepartureStartedAt === recordedDepartureMarker.current) return;
    recordedDepartureMarker.current = frame.lastDepartureStartedAt;
    setLastDepartureAt(frame.lastDepartureStartedAt === null ? null : Date.now());
  }, [frame.lastDepartureStartedAt]);

  useEffect(() => {
    motion.current = reconcilePassengerMotion(motion.current, snapshot);
    motion.current = advancePassengerMotion(motion.current, 0, { reducedMotion });
    setFrame(passengerFrame(motion.current));
  }, [snapshot, reducedMotion]);

  useEffect(() => {
    if (paused || reducedMotion) return;
    let animationId = 0;
    let previousTime: number | null = null;
    const animate = (time: number) => {
      if (!document.hidden) {
        if (previousTime === null) {
          previousTime = time;
        } else if (time - previousTime >= FRAME_INTERVAL_MS) {
          motion.current = advancePassengerMotion(motion.current, time - previousTime, { speed });
          setFrame(passengerFrame(motion.current));
          previousTime = time;
        }
      } else {
        previousTime = null;
      }
      animationId = requestAnimationFrame(animate);
    };
    const visibilityChanged = () => {
      previousTime = null;
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    animationId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationId);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [paused, speed, reducedMotion]);

  return { ...frame, lastDepartureAt };
}
