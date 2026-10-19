import { useEffect, useMemo, useState } from 'react';
import { snapshotSchema, type ChainId, type Snapshot } from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../lib/freshness';

export function useSnapshot(chain: ChainId, mode: 'live' | 'demo') {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<{
    chain: ChainId;
    mode: 'live' | 'demo';
    message: string;
  } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    let generation = 0;
    const poll = async () => {
      if (!active || document.hidden) return;
      setClock(Date.now());
      const currentGeneration = ++generation;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/snapshot?chain=${chain}&mode=${mode}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Service momentanément indisponible');
        const parsed = snapshotSchema.parse(await response.json());
        if (parsed.chain !== chain || parsed.mode !== mode) throw new Error('Source incohérente');
        if (active && generation === currentGeneration) {
          setData(parsed);
          setFailure(null);
        }
      } catch {
        if (active && generation === currentGeneration)
          setFailure({
            chain,
            mode,
            message: 'Connexion interrompue. Nouvelle tentative automatique.',
          });
      } finally {
        if (active && generation === currentGeneration) {
          setClock(Date.now());
          timer = setTimeout(() => void poll(), mode === 'demo' ? 5_000 : 3_000);
        }
      }
    };
    const visibility = () => {
      setClock(Date.now());
      clearTimeout(timer);
      generation += 1;
      controller?.abort();
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [chain, mode, refresh]);

  useEffect(() => {
    if (!data) return;
    const deadline = nextSnapshotFreshnessDeadline(data, clock);
    if (deadline === null) return;
    const expiry = setTimeout(() => setClock(Date.now()), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(expiry);
  }, [data, clock]);

  const error = failure?.chain === chain && failure.mode === mode ? failure.message : null;
  const current = data?.chain === chain && data.mode === mode ? data : null;
  const snapshot = useMemo(
    () => (current ? assessFreshness(current, !!error, clock) : null),
    [current, error, clock],
  );
  useEffect(() => {
    if (!snapshot || snapshot.status !== 'unavailable' || current?.status === 'unavailable') return;
    // A rejected observation cannot become live again just because the clock catches up.
    // Preserve a newer response if it arrived between this render and the effect.
    setData((previous) => (previous === current ? snapshot : previous));
  }, [current, snapshot]);
  return {
    snapshot,
    expiredBlockTemplate:
      current?.blockTemplate &&
      snapshot &&
      !snapshot.blockTemplate &&
      snapshot.status !== 'unavailable'
        ? current.blockTemplate
        : null,
    error: snapshot ? error : null,
    loading: !snapshot && !error,
    connectionError: error,
    retry: () => setRefresh((value) => value + 1),
  };
}
