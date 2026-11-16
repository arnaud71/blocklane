import { languageTag, translate, type Locale } from '../i18n/locale';
import type { Snapshot } from '../../shared/model';

export type ProviderMempool = {
  source?: string;
  total: number | null;
  pending: number | null;
  queued: number | null;
  observedAt: number | null;
  status: 'ok' | 'stale' | 'unavailable' | 'demo';
  note: string;
};

const unavailable = (locale: Locale): ProviderMempool => ({
  total: null,
  pending: null,
  queued: null,
  observedAt: null,
  status: 'unavailable',
  note: translate(
    locale,
    'Le fournisseur ne donne aucun comptage récent exploitable de sa mempool. La taille de l’échantillon n’est pas un total de mempool.',
    'The provider supplies no usable recent count of its mempool. The sample size is not a mempool total.',
  ),
});
const validCount = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 0;

/** A provider's local pool is distinct from the visible sample and from the global network. */
export function providerMempool(snapshot: Snapshot | null, locale: Locale = 'fr'): ProviderMempool {
  if (!snapshot || snapshot.status === 'unavailable') return unavailable(locale);
  if (snapshot.mode === 'demo') {
    return {
      ...unavailable(locale),
      total: validCount(snapshot.pendingCount) ? snapshot.pendingCount : null,
      observedAt: snapshot.observedAt,
      status: 'demo',
      note: translate(
        locale,
        'Nombre de transactions fictif de la mempool simulée.',
        'Fictional transaction count in the simulated mempool.',
      ),
    };
  }
  if (snapshot.chain === 'bitcoin') {
    if (!validCount(snapshot.pendingCount)) return unavailable(locale);
    const sample = snapshot.sampling?.method === 'getrawmempool' ? snapshot.sampling : null;
    const observedAt = sample?.observedAt ?? snapshot.observedAt;
    const source = sample?.source ?? snapshot.source;
    const age = Date.now() - observedAt;
    if (sample && (age < -5_000 || age > 120_000)) return unavailable(locale);
    const status = snapshot.status === 'stale' || (sample && age > 30_000) ? 'stale' : 'ok';
    return {
      total: snapshot.pendingCount,
      pending: snapshot.pendingCount,
      queued: null,
      observedAt,
      source,
      status,
      note:
        locale === 'en'
          ? `Mempool observed by ${source} at ${new Date(observedAt).toLocaleTimeString(languageTag(locale))}${status === 'stale' ? ', last value retained' : ''}. This is the source’s local view, distinct from the displayed sample.`
          : `Mempool observée par ${source}, relevée à ${new Date(observedAt).toLocaleTimeString('fr-CH')}${status === 'stale' ? ', dernière valeur conservée' : ''}. Vue locale de la source, distincte de l’échantillon affiché.`,
    };
  }
  const pool = snapshot.mempool;
  if (!pool || !validCount(pool.pending) || !validCount(pool.queued)) return unavailable(locale);
  const total = pool.pending + pool.queued;
  const age = Date.now() - pool.observedAt;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(pool.observedAt) ||
    pool.observedAt < 0 ||
    age < -5_000 ||
    age > 120_000 ||
    pool.method !== 'txpool_status'
  )
    return unavailable(locale);
  const status =
    pool.status === 'stale' || age > 30_000 || snapshot.status === 'stale' ? 'stale' : 'ok';
  return {
    total,
    source: snapshot.source,
    pending: pool.pending,
    queued: pool.queued,
    observedAt: pool.observedAt,
    status,
    note:
      locale === 'en'
        ? `Local mempool of ${snapshot.source}: ${pool.pending} pending + ${pool.queued} queued via txpool_status. Observed at ${new Date(pool.observedAt).toLocaleTimeString(languageTag(locale))}${status === 'stale' ? ', last value retained' : ''}. This total does not represent the whole network.`
        : `Mempool locale de ${snapshot.source} : ${pool.pending} pending + ${pool.queued} queued via txpool_status. Relevé à ${new Date(pool.observedAt).toLocaleTimeString('fr-CH')}${status === 'stale' ? ', dernière valeur conservée' : ''}. Ce total ne représente pas tout le réseau.`,
  };
}
