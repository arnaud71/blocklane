import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import type { Snapshot, UsdQuote } from '../../shared/model';
import { hasUsableUsdQuote, QUOTE_MAX_AGE_MS } from '../lib/feeDisplay';
import { providerMempool } from '../lib/mempoolDisplay';

/** Wake only at a freshness boundary, even when memoized displays have no moving actors. */
function useFreshnessDeadline(deadline: number | null) {
  const [, invalidate] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const expire = () => invalidate((version) => version + 1);
    const timer = window.setTimeout(expire, Math.max(1, deadline - Date.now()));
    const onVisibility = () => {
      if (!document.hidden && Date.now() >= deadline) expire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [deadline]);
}

export function useUsableUsdQuote(quote: UsdQuote | null | undefined): boolean {
  const usable = hasUsableUsdQuote(quote);
  useFreshnessDeadline(usable && quote ? quote.observedAt + QUOTE_MAX_AGE_MS + 1 : null);
  return usable;
}

export function useProviderMempool(snapshot: Snapshot | null) {
  const { locale } = useI18n();
  const pool = providerMempool(snapshot, locale);
  const deadline =
    snapshot?.mode === 'live' &&
    (snapshot.chain === 'ethereum' || snapshot.sampling?.method === 'getrawmempool') &&
    pool.observedAt !== null &&
    pool.total !== null
      ? pool.observedAt + (pool.status === 'ok' ? 30_001 : 120_001)
      : null;
  useFreshnessDeadline(deadline);
  return pool;
}
