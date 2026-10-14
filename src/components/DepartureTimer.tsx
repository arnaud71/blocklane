import { useEffect, useState } from 'react';

/** A wall-clock counter with its own one-second tick, independent of animation speed. */
export function DepartureTimer({
  departedAt,
  demo = false,
}: {
  departedAt: number | null;
  demo?: boolean;
}) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (departedAt === null) return;
    let interval: number | undefined;
    const tick = () => setNow(Date.now());
    const syncVisibility = () => {
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
      tick();
      if (!document.hidden) interval = window.setInterval(tick, 1_000);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [departedAt]);

  const seconds = departedAt === null ? null : Math.max(0, Math.floor((now - departedAt) / 1_000));
  const duration =
    seconds === null
      ? '—'
      : [
          ...(seconds >= 3_600 ? [Math.floor(seconds / 3_600).toString()] : []),
          Math.floor((seconds % 3_600) / 60)
            .toString()
            .padStart(2, '0'),
          (seconds % 60).toString().padStart(2, '0'),
        ].join(':');

  return (
    <time
      className="departure-timer"
      dateTime={seconds === null ? undefined : `PT${seconds}S`}
      title={
        departedAt === null
          ? `Aucun départ ${demo ? 'simulé' : 'animé'} dans cette session.`
          : `Dernier départ ${demo ? 'simulé' : 'animé'} à ${new Date(departedAt).toLocaleTimeString('fr-CH')}. Temps réel écoulé depuis le départ du wagon dans cette session.`
      }
    >
      {duration}
    </time>
  );
}
