import { translate, type Locale } from '../i18n/locale';
import {
  EVENT_FLOW_MAX_AGE_MS,
  EVENT_FLOW_SILENCE_MS,
  POOL_FLOW_MAX_AGE_MS,
  type PoolFlowPoint,
  type Snapshot,
} from '../../shared/model';
import { number } from './format';

export interface PoolFlowDisplay {
  state: 'unavailable' | 'warming' | 'ready' | 'stale';
  value: string;
  label: string;
  interval: string;
  average: string;
  note: string;
  source: string | null;
  observedAt: number | null;
  kind: 'inventory' | 'events' | 'none';
  kindLabel: string;
  history: readonly Pick<
    PoolFlowPoint,
    'fromObservedAt' | 'observedAt' | 'enteredCount' | 'outsideSampleEnteredCount'
  >[];
}

/** Counts are differences of complete provider inventories, never a world-wide arrival meter. */
export function poolFlowDisplay(
  snapshot: Snapshot,
  now = Date.now(),
  locale: Locale = 'fr',
): PoolFlowDisplay {
  const t = (fr: string, en: string) => translate(locale, fr, en);
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const flow = snapshot.poolFlow;
  const empty: PoolFlowDisplay = {
    state: 'unavailable',
    value: '—',
    label: t('Flux non mesuré', 'Flow not measured'),
    interval: '',
    average: '',
    source: flow?.source ?? null,
    observedAt: flow?.observedAt ?? null,
    kind: flow ? 'inventory' : 'none',
    kindLabel: t('Relevé périodique', 'Periodic inventory'),
    history: [],
    note:
      snapshot.mode === 'demo'
        ? t(
            'Le flux réel du fournisseur n’est pas simulé dans la démonstration.',
            'The provider’s real flow is not simulated in the demo.',
          )
        : t(
            'Deux inventaires complets successifs du même fournisseur sont nécessaires. Les détails de l’échantillon ne mesurent pas le flux total.',
            'Two successive complete inventories from the same provider are required. Sample details do not measure total flow.',
          ),
  };
  if (snapshot.mode !== 'live' || !flow || snapshot.status === 'unavailable') return empty;
  if (
    snapshot.status !== 'ok' ||
    now - flow.observedAt > POOL_FLOW_MAX_AGE_MS ||
    flow.observedAt > now
  )
    return {
      ...empty,
      state: 'stale',
      label: t('Flux ancien', 'Old flow data'),
      note: t(
        `Le dernier inventaire de ${flow.source} est ancien ou le direct est interrompu. Aucun débit actuel n’est déduit.`,
        `The latest inventory from ${flow.source} is old or the live feed is interrupted. No current rate is inferred.`,
      ),
    };
  if (flow.state === 'warming' || flow.history.length === 0)
    return {
      ...empty,
      state: 'warming',
      label: t('Flux en initialisation', 'Flow initializing'),
      interval: t(`Base : ${n(flow.inventoryCount)} tx`, `Baseline: ${n(flow.inventoryCount)} tx`),
      note: t(
        `Premier inventaire complet de ${flow.source} reçu. Attente d’un second relevé : le débit est encore inconnu, pas nul.`,
        `First complete inventory received from ${flow.source}. Waiting for a second observation: the rate is still unknown, not zero.`,
      ),
    };
  const latest = flow.history.at(-1)!;
  const seconds = (latest.observedAt - latest.fromObservedAt) / 1_000;
  const measuredMs = flow.history.reduce(
    (sum, point) => sum + point.observedAt - point.fromObservedAt,
    0,
  );
  const entered = flow.history.reduce((sum, point) => sum + point.enteredCount, 0);
  const rate = measuredMs > 0 ? (entered * 1_000) / measuredMs : 0;
  return {
    state: 'ready',
    value: `+${n(latest.enteredCount)}`,
    label: t('Entrées observées', 'Observed arrivals'),
    interval: t(`sur ${n(seconds, 1)} s`, `over ${n(seconds, 1)} s`),
    average: t(`${n(rate, 1)} tx/s · moy. observée`, `${n(rate, 1)} tx/s · observed avg.`),
    source: flow.source,
    observedAt: flow.observedAt,
    kind: 'inventory',
    kindLabel: t('Relevé périodique', 'Periodic inventory'),
    history: flow.history,
    note:
      locale === 'en'
        ? `Identifier differences between complete inventories from ${flow.source} (${flow.method}). ${n(latest.enteredCount)} arrivals and ${n(latest.disappearedCount)} disappearances over ${n(seconds, 1)} s: this is not the net change. The average covers ${n(measuredMs / 1_000, 1)} observed seconds; the chart retains points from the past 60 seconds. This is neither an instantaneous rate nor a worldwide measurement. A disappearance does not prove confirmation.`
        : `Différences d’identifiants entre inventaires complets de ${flow.source} (${flow.method}). ${n(latest.enteredCount)} entrées et ${n(latest.disappearedCount)} disparitions sur ${n(seconds, 1)} s : ce n’est pas la variation nette. La moyenne couvre ${n(measuredMs / 1_000, 1)} s observées ; la courbe conserve les points des 60 dernières secondes. Ce n’est ni un débit instantané ni une mesure mondiale. Une disparition ne prouve pas une confirmation.`,
  };
}

function currentEventFlow(snapshot: Snapshot, now: number) {
  const flow = snapshot.eventFlow;
  return snapshot.mode === 'live' &&
    snapshot.status !== 'unavailable' &&
    flow?.state === 'live' &&
    flow.startedAt !== null &&
    flow.startedAt <= now &&
    flow.observedAt <= now &&
    now - flow.observedAt <= EVENT_FLOW_MAX_AGE_MS &&
    flow.lastMessageAt !== null &&
    flow.lastMessageAt <= now &&
    now - flow.lastMessageAt <= EVENT_FLOW_SILENCE_MS &&
    flow.history.length > 0
    ? flow
    : null;
}

/** Event signals and inventory differences have distinct meanings and clocks. */
export function providerFlowDisplay(
  snapshot: Snapshot,
  now = Date.now(),
  locale: Locale = 'fr',
): PoolFlowDisplay {
  const t = (fr: string, en: string) => translate(locale, fr, en);
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const events = currentEventFlow(snapshot, now);
  if (events) {
    const bitcoin = snapshot.chain === 'bitcoin';
    const latest = events.history.at(-1)!;
    const measuredMs = events.history.reduce(
      (sum, point) => sum + point.observedAt - point.fromObservedAt,
      0,
    );
    const count = events.history.reduce((sum, point) => sum + point.enteredCount, 0);
    const seconds = (latest.observedAt - latest.fromObservedAt) / 1_000;
    return {
      state: 'ready',
      value: `+${n(latest.enteredCount)}`,
      label: bitcoin
        ? t('Ajouts observés', 'Observed additions')
        : t('Notifications pending', 'Pending notifications'),
      interval: t(`sur ${n(seconds, 1)} s`, `over ${n(seconds, 1)} s`),
      average: `${n((count * 1_000) / measuredMs, 1)} ${bitcoin ? t('ajouts', 'additions') : 'notif.'}/s · ${t('moy. observée', 'observed avg.')}`,
      source: events.source,
      observedAt: events.observedAt,
      kind: 'events',
      kindLabel: t('Flux suivi · événements', 'Tracked flow · events'),
      history: events.history,
      note:
        locale === 'en'
          ? `${snapshot.status === 'stale' ? 'Block observations are old; notifications are timestamped independently. ' : ''}${bitcoin ? 'Additions reported by the local Bitcoin flow from' : 'Pending notifications received from Ethereum provider'} ${events.source} (${events.method}). Average over ${n(measuredMs / 1_000, 1)} seconds actually observed; points retained for about a minute. ${bitcoin ? 'This flow describes this provider’s view, not a worldwide inventory.' : 'A notification may be a promotion from queued or a repeated notification; it does not measure new arrivals in a worldwide mempool.'} No signal proves selection or confirmation.`
          : `${snapshot.status === 'stale' ? 'Relevé des blocs ancien ; notifications datées indépendamment. ' : ''}${bitcoin ? 'Ajouts signalés par le flux local Bitcoin' : 'Notifications pending reçues du fournisseur Ethereum'} ${events.source} (${events.method}). Moyenne sur ${n(measuredMs / 1_000, 1)} s réellement observées, points conservés sur environ une minute. ${bitcoin ? 'Ce flux décrit la vue de ce fournisseur, pas un inventaire mondial.' : 'Une notification peut correspondre à une promotion depuis queued ou à une réémission ; elle ne mesure pas les nouvelles entrées d’un mempool mondial.'} Aucun signal ne prouve une sélection ni une confirmation.`,
    };
  }
  const inventory = poolFlowDisplay(snapshot, now, locale);
  const flow = snapshot.eventFlow;
  if (!flow || snapshot.mode !== 'live') return inventory;
  const reason =
    flow.state === 'disabled'
      ? t('Flux événementiel non activé', 'Event flow disabled')
      : flow.state === 'connecting'
        ? t('Connexion au flux…', 'Connecting to flow…')
        : flow.state === 'warming'
          ? t('Flux en initialisation', 'Flow initializing')
          : flow.state === 'limited'
            ? t('Limite du flux atteinte', 'Flow limit reached')
            : flow.state === 'interrupted'
              ? t('Flux interrompu', 'Flow interrupted')
              : t('Flux événementiel ancien', 'Old event flow');
  if (inventory.state === 'ready')
    return {
      ...inventory,
      kindLabel: `${t('Relevé périodique', 'Periodic inventory')} · ${flow.state === 'connecting' ? t('connexion', 'connecting') : flow.state === 'warming' ? t('initialisation', 'initializing') : flow.state === 'limited' ? t('limite atteinte', 'limit reached') : flow.state === 'interrupted' ? t('flux interrompu', 'flow interrupted') : flow.state === 'disabled' ? t('événements désactivés', 'events disabled') : t('flux ancien', 'old flow data')}`,
      note: t(
        `${reason}. Secours par relevé périodique indépendant. ${inventory.note}`,
        `${reason}. Falling back to independent periodic inventories. ${inventory.note}`,
      ),
    };
  return {
    ...inventory,
    state: flow.state === 'connecting' || flow.state === 'warming' ? 'warming' : 'unavailable',
    value: '—',
    label: reason,
    interval: '',
    average: '',
    history: [],
    source: flow.source,
    observedAt: flow.observedAt,
    kind: 'none',
    kindLabel: t('Flux suivi · événements', 'Tracked flow · events'),
    note: t(
      `${reason}. Aucun débit actuel n’est déduit ; une connexion ou un premier relevé ne signifie pas zéro. ${inventory.note}`,
      `${reason}. No current rate is inferred; a connection or first observation does not mean zero. ${inventory.note}`,
    ),
  };
}

export interface ProviderFlowArrival {
  key: string;
  count: number;
  fromObservedAt: number;
  observedAt: number;
  kind: 'inventory' | 'events';
}

export interface ProviderFlowArrivalState {
  context: string;
  observedAt: number | null;
  arrival: ProviderFlowArrival | null;
  eventContext?: string;
  eventObservedAt?: number | null;
}

/** A first render/source change establishes a baseline; identical polls cannot replay a cohort. */
export function advanceProviderFlowArrival(
  previous: ProviderFlowArrivalState | null,
  snapshot: Snapshot,
  now = Date.now(),
): ProviderFlowArrivalState {
  const flow = snapshot.poolFlow;
  const context = `${snapshot.chain}:${snapshot.mode}:${flow?.source ?? ''}:${flow?.method ?? ''}`;
  const sameScope =
    previous !== null && previous.context.startsWith(`${snapshot.chain}:${snapshot.mode}:`);
  const sameInventory = previous?.context === context;
  const inventoryDisplay = poolFlowDisplay(snapshot, now);
  const observedAt =
    !flow && sameScope
      ? previous.observedAt
      : inventoryDisplay.state === 'stale' && sameInventory
        ? previous.observedAt
        : (flow?.observedAt ?? null);
  const inventoryNew =
    sameInventory &&
    inventoryDisplay.state === 'ready' &&
    observedAt !== null &&
    (previous.observedAt === null || observedAt > previous.observedAt);
  const inventoryContext = !flow && sameScope ? previous.context : context;
  const event = snapshot.eventFlow;
  const datedEvent =
    event &&
    event.observedAt <= now &&
    (event.startedAt === null || event.startedAt <= now) &&
    (event.lastMessageAt === null || event.lastMessageAt <= now)
      ? event
      : null;
  const eventContext = datedEvent
    ? `${snapshot.chain}:${snapshot.mode}:${datedEvent.source}:${datedEvent.method}:${datedEvent.epoch}`
    : sameScope
      ? previous.eventContext
      : undefined;
  const sameEvent =
    !!previous && eventContext !== undefined && previous.eventContext === eventContext;
  const eventLive = currentEventFlow(snapshot, now);
  const eventObservedAt =
    !datedEvent && sameScope
      ? previous.eventObservedAt
      : eventLive ||
          datedEvent?.state === 'warming' ||
          datedEvent?.state === 'connecting' ||
          !sameEvent
        ? (datedEvent?.observedAt ?? null)
        : previous.eventObservedAt;
  const eventNew =
    sameEvent &&
    !!eventLive &&
    eventObservedAt != null &&
    (previous.eventObservedAt == null || eventObservedAt > previous.eventObservedAt);
  const selected = providerFlowDisplay(snapshot, now);
  const selectedNew = selected.kind === 'events' ? eventNew : inventoryNew;
  const selectedContext = selected.kind === 'events' ? eventContext : inventoryContext;
  let arrival = previous?.arrival ?? null;
  if (
    selected.state !== 'ready' ||
    !selectedContext ||
    (arrival && !arrival.key.startsWith(`${selectedContext}:`))
  )
    arrival = null;
  if (selectedNew) {
    const point = selected.history.at(-1)!;
    arrival =
      point.outsideSampleEnteredCount !== null && point.outsideSampleEnteredCount > 0
        ? {
            key: `${selectedContext}:${point.observedAt}`,
            count: point.outsideSampleEnteredCount,
            fromObservedAt: point.fromObservedAt,
            observedAt: point.observedAt,
            kind: selected.kind === 'events' ? 'events' : 'inventory',
          }
        : null;
  }
  if (
    !previous ||
    previous.context !== inventoryContext ||
    previous.observedAt !== observedAt ||
    previous.eventContext !== eventContext ||
    previous.eventObservedAt !== eventObservedAt ||
    previous.arrival !== arrival
  )
    return { context: inventoryContext, observedAt, eventContext, eventObservedAt, arrival };
  return previous;
}
