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
export function poolFlowDisplay(snapshot: Snapshot, now = Date.now()): PoolFlowDisplay {
  const flow = snapshot.poolFlow;
  const empty: PoolFlowDisplay = {
    state: 'unavailable',
    value: '—',
    label: 'Flux non mesuré',
    interval: '',
    average: '',
    source: flow?.source ?? null,
    observedAt: flow?.observedAt ?? null,
    kind: flow ? 'inventory' : 'none',
    kindLabel: 'Relevé périodique',
    history: [],
    note:
      snapshot.mode === 'demo'
        ? 'Le flux réel du fournisseur n’est pas simulé dans la démonstration.'
        : 'Deux inventaires complets successifs du même fournisseur sont nécessaires. Les détails de l’échantillon ne mesurent pas le flux total.',
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
      label: 'Flux ancien',
      note: `Le dernier inventaire de ${flow.source} est ancien ou le direct est interrompu. Aucun débit actuel n’est déduit.`,
    };
  if (flow.state === 'warming' || flow.history.length === 0)
    return {
      ...empty,
      state: 'warming',
      label: 'Flux en initialisation',
      interval: `Base : ${number(flow.inventoryCount)} tx`,
      note: `Premier inventaire complet de ${flow.source} reçu. Attente d’un second relevé : le débit est encore inconnu, pas nul.`,
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
    value: `+${number(latest.enteredCount)}`,
    label: 'Entrées observées',
    interval: `sur ${number(seconds, 1)} s`,
    average: `${number(rate, 1)} tx/s · moy. observée`,
    source: flow.source,
    observedAt: flow.observedAt,
    kind: 'inventory',
    kindLabel: 'Relevé périodique',
    history: flow.history,
    note: `Différences d’identifiants entre inventaires complets de ${flow.source} (${flow.method}). ${number(latest.enteredCount)} entrées et ${number(latest.disappearedCount)} disparitions sur ${number(seconds, 1)} s : ce n’est pas la variation nette. La moyenne couvre ${number(measuredMs / 1_000, 1)} s observées ; la courbe conserve les points des 60 dernières secondes. Ce n’est ni un débit instantané ni une mesure mondiale. Une disparition ne prouve pas une confirmation.`,
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
export function providerFlowDisplay(snapshot: Snapshot, now = Date.now()): PoolFlowDisplay {
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
      value: `+${number(latest.enteredCount)}`,
      label: bitcoin ? 'Ajouts observés' : 'Notifications pending',
      interval: `sur ${number(seconds, 1)} s`,
      average: `${number((count * 1_000) / measuredMs, 1)} ${bitcoin ? 'ajouts' : 'notif.'}/s · moy. observée`,
      source: events.source,
      observedAt: events.observedAt,
      kind: 'events',
      kindLabel: 'Flux suivi · événements',
      history: events.history,
      note: `${snapshot.status === 'stale' ? 'Relevé des blocs ancien ; notifications datées indépendamment. ' : ''}${bitcoin ? 'Ajouts signalés par le flux local Bitcoin' : 'Notifications pending reçues du fournisseur Ethereum'} ${events.source} (${events.method}). Moyenne sur ${number(measuredMs / 1_000, 1)} s réellement observées, points conservés sur environ une minute. ${bitcoin ? 'Ce flux décrit la vue de ce fournisseur, pas un inventaire mondial.' : 'Une notification peut correspondre à une promotion depuis queued ou à une réémission ; elle ne mesure pas les nouvelles entrées d’un mempool mondial.'} Aucun signal ne prouve une sélection ni une confirmation.`,
    };
  }
  const inventory = poolFlowDisplay(snapshot, now);
  const flow = snapshot.eventFlow;
  if (!flow || snapshot.mode !== 'live') return inventory;
  const reason =
    flow.state === 'disabled'
      ? 'Flux événementiel non activé'
      : flow.state === 'connecting'
        ? 'Connexion au flux…'
        : flow.state === 'warming'
          ? 'Flux en initialisation'
          : flow.state === 'limited'
            ? 'Limite du flux atteinte'
            : flow.state === 'interrupted'
              ? 'Flux interrompu'
              : 'Flux événementiel ancien';
  if (inventory.state === 'ready')
    return {
      ...inventory,
      kindLabel: `Relevé périodique · ${flow.state === 'connecting' ? 'connexion' : flow.state === 'warming' ? 'initialisation' : flow.state === 'limited' ? 'limite atteinte' : flow.state === 'interrupted' ? 'flux interrompu' : flow.state === 'disabled' ? 'événements désactivés' : 'flux ancien'}`,
      note: `${reason}. Secours par relevé périodique indépendant. ${inventory.note}`,
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
    kindLabel: 'Flux suivi · événements',
    note: `${reason}. Aucun débit actuel n’est déduit ; une connexion ou un premier relevé ne signifie pas zéro. ${inventory.note}`,
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
