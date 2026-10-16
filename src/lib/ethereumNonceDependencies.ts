import type { EthereumDependencies, EthereumPredecessor, Tx } from '../../shared/model';

/** A planning constraint, never proof that the child can execute or has been included. */
export interface EthereumNonceDependency {
  predecessor: EthereumPredecessor;
  coverage: 'current' | 'local' | 'stale';
  observedAt?: number;
  source?: string;
  blocked: boolean;
}

export interface EthereumNonceObservation {
  tx: Tx;
  observedAt?: number;
  poolState?: 'pending' | 'queued' | 'absent' | 'replaced' | 'unknown';
  poolObservedAt?: number;
  resident?: boolean;
  dependency?: EthereumNonceDependency;
}

export interface EthereumNoncePlanningContext {
  observedAt: number;
  healthy: boolean;
  parentBlockHash?: string;
  height?: number;
  dependencies?: EthereumDependencies | null;
  known: EthereumNonceObservation[];
  inclusions: ReadonlyMap<string, { blockHash: string; blockHeight: number }>;
}

const FRESHNESS_MS = 60_000;
const identity = (tx: Tx) => `${tx.ethereum!.from.toLowerCase()}:${tx.ethereum!.nonce}`;
const predecessorId = (value: EthereumPredecessor): string | undefined =>
  'transactionId' in value ? value.transactionId : undefined;

/** The complete pool contributes bounded edges; local metadata preserves edges outside the sample. */
export function ethereumNonceDependencies(
  transactions: Tx[],
  context: EthereumNoncePlanningContext,
) {
  const known = new Map<string, EthereumNonceObservation>();
  for (const observation of context.known) {
    if (observation.tx.chain !== 'ethereum' || !observation.tx.ethereum) continue;
    const previous = known.get(observation.tx.id);
    if (!previous || (observation.observedAt ?? 0) >= (previous.observedAt ?? 0))
      known.set(observation.tx.id, observation);
  }
  for (const tx of transactions)
    if (tx.chain === 'ethereum' && tx.ethereum && !known.has(tx.id)) known.set(tx.id, { tx });

  const alternatives = new Map<string, EthereumNonceObservation[]>();
  for (const observation of known.values()) {
    if (observation.poolState === 'replaced') continue;
    const key = identity(observation.tx);
    const entries = alternatives.get(key) ?? [];
    entries.push(observation);
    alternatives.set(key, entries);
  }
  const owners = new Map<string, EthereumNonceObservation>();
  const excludedIds = new Set<string>();
  for (const [key, entries] of alternatives) {
    const proved = entries.filter(({ tx }) => context.inclusions.has(tx.id));
    const newestAt = Math.max(...entries.map((entry) => entry.observedAt ?? 0));
    const newest = entries.filter((entry) => (entry.observedAt ?? 0) === newestAt);
    const resident = newest.filter((entry) => entry.resident);
    const owner =
      proved.length === 1
        ? proved[0]
        : newest.length === 1
          ? newest[0]
          : resident.length === 1
            ? resident[0]
            : undefined;
    if (owner) owners.set(key, owner);
    for (const entry of entries) if (entry !== owner) excludedIds.add(entry.tx.id);
  }
  const lowerNonces = new Map<string, bigint>();
  for (const entry of owners.values()) {
    const age = context.observedAt - (entry.poolObservedAt ?? entry.observedAt ?? 0);
    if (
      !context.healthy ||
      entry.tx.status !== 'pending' ||
      entry.poolState === 'replaced' ||
      entry.poolState === 'absent' ||
      context.inclusions.has(entry.tx.id) ||
      age < 0 ||
      age > FRESHNESS_MS
    )
      continue;
    const from = entry.tx.ethereum!.from.toLowerCase();
    const nonce = BigInt(entry.tx.ethereum!.nonce);
    const previous = lowerNonces.get(from);
    if (previous === undefined || nonce < previous) lowerNonces.set(from, nonce);
  }

  const source = context.dependencies;
  const fresh = Boolean(
    context.healthy &&
    source &&
    context.parentBlockHash &&
    source.parentBlockHash.toLowerCase() === context.parentBlockHash.toLowerCase() &&
    source.height === context.height &&
    source.observedAt <= context.observedAt &&
    context.observedAt - source.observedAt <= FRESHNESS_MS,
  );
  const entries = new Map(
    source?.entries.map((entry) => [entry.transactionId.toLowerCase(), entry]),
  );
  const dependencies = new Map<string, EthereumNonceDependency>();
  const children = new Map(
    [...known.values()].filter(({ tx }) => tx.status === 'pending').map(({ tx }) => [tx.id, tx]),
  );
  for (const tx of transactions) children.set(tx.id, tx);
  for (const tx of children.values()) {
    if (tx.chain !== 'ethereum' || !tx.ethereum) continue;
    const nonce = BigInt(tx.ethereum.nonce);
    if (nonce === 0n) {
      dependencies.set(tx.id, {
        predecessor: { state: 'root' },
        coverage: 'local',
        blocked: false,
      });
      continue;
    }
    const expected = (nonce - 1n).toString();
    const from = tx.ethereum.from.toLowerCase();
    const child = known.get(tx.id);
    const prior = child?.dependency;
    const parentKey = `${from}:${expected}`;
    const parent = owners.get(parentKey);
    const entry = entries.get(tx.id.toLowerCase());
    const matching =
      entry &&
      entry.from.toLowerCase() === from &&
      entry.nonce === tx.ethereum.nonce &&
      entry.predecessor.state !== 'root' &&
      entry.predecessor.nonce === expected
        ? entry
        : undefined;
    const recorded = matching?.predecessor;
    const previous = prior?.predecessor;
    const previousId = previous && predecessorId(previous);
    const provedId =
      parent && context.inclusions.has(parent.tx.id)
        ? parent.tx.id
        : previousId && context.inclusions.has(previousId)
          ? previousId
          : recorded && predecessorId(recorded) && context.inclusions.has(predecessorId(recorded)!)
            ? predecessorId(recorded)
            : undefined;

    const unknown = (
      id?: string,
      coverage: 'local' | 'stale' = 'local',
    ): EthereumNonceDependency => ({
      predecessor: { state: 'unknown', nonce: expected, ...(id ? { transactionId: id } : {}) },
      coverage,
      observedAt: prior?.observedAt ?? (matching ? source?.observedAt : undefined),
      source: prior?.source ?? source?.source,
      blocked: true,
    });

    // An exact receipt for a known hash releases its edge, not the child's status.
    if (provedId) {
      dependencies.set(tx.id, {
        predecessor: {
          state: 'confirmed',
          nonce: expected,
          transactionId: provedId,
          ...context.inclusions.get(provedId)!,
        },
        coverage: fresh ? 'current' : 'local',
        observedAt: source?.observedAt ?? prior?.observedAt,
        source: source?.source ?? prior?.source,
        blocked: false,
      });
      continue;
    }
    // A newer local replacement supersedes an older pool edge for the same nonce.
    const newerParent = parent && source && (parent.observedAt ?? 0) > source.observedAt;
    if (fresh && matching && !newerParent) {
      const value = matching.predecessor;
      if (value.state === 'confirmed') dependencies.set(tx.id, unknown(value.transactionId));
      else if (
        value.state === 'unobserved' &&
        (parent ||
          alternatives.has(parentKey) ||
          previousId ||
          previous?.state === 'gap' ||
          previous?.state === 'unknown')
      ) {
        dependencies.set(tx.id, unknown(parent?.tx.id ?? previousId));
      } else if (value.state === 'unobserved' && (lowerNonces.get(from) ?? nonce) < nonce) {
        dependencies.set(tx.id, {
          predecessor: { state: 'gap', nonce: expected },
          coverage: 'local',
          blocked: true,
        });
      } else {
        dependencies.set(tx.id, {
          predecessor: value,
          coverage: 'current',
          source: source!.source,
          observedAt: source!.observedAt,
          blocked: value.state === 'gap' || value.state === 'unknown' || value.state === 'queued',
        });
      }
      continue;
    }
    if (parent) {
      const age = context.observedAt - (parent.poolObservedAt ?? parent.observedAt ?? 0);
      const state = parent.poolState;
      // Freshness removes expired public evidence without redating the snapshot.
      // Replayed immutable details must not silently refresh a remembered pool edge.
      const lostCoverage =
        !fresh &&
        ((source !== undefined && source !== null) ||
          prior?.coverage === 'current' ||
          prior?.coverage === 'stale') &&
        (parent.poolObservedAt ?? parent.observedAt ?? 0) <=
          (source?.observedAt ?? prior?.observedAt ?? 0);
      if (!context.healthy || age < 0 || age > FRESHNESS_MS || state === 'absent' || lostCoverage) {
        dependencies.set(tx.id, unknown(parent.tx.id, 'stale'));
      } else {
        dependencies.set(tx.id, {
          predecessor: {
            state: state === 'queued' ? 'queued' : 'pending',
            nonce: expected,
            transactionId: parent.tx.id,
          },
          coverage: 'local',
          observedAt: parent.poolObservedAt ?? parent.observedAt,
          blocked: state === 'queued',
        });
      }
      continue;
    }
    if (
      alternatives.has(parentKey) ||
      previousId ||
      previous?.state === 'gap' ||
      previous?.state === 'unknown' ||
      (recorded && recorded.state !== 'unobserved' && recorded.state !== 'root')
    ) {
      dependencies.set(
        tx.id,
        unknown(previousId ?? (recorded && predecessorId(recorded)), fresh ? 'local' : 'stale'),
      );
      continue;
    }
    if ((lowerNonces.get(from) ?? nonce) < nonce) {
      dependencies.set(tx.id, {
        predecessor: { state: 'gap', nonce: expected },
        coverage: 'local',
        blocked: true,
      });
      continue;
    }
    dependencies.set(tx.id, {
      predecessor: { state: 'unobserved', nonce: expected },
      coverage:
        (source && !fresh) || prior?.coverage === 'current' || prior?.coverage === 'stale'
          ? 'stale'
          : 'local',
      source: source?.source ?? prior?.source,
      observedAt: source?.observedAt ?? prior?.observedAt,
      blocked: false,
    });
  }
  return { dependencies, excludedIds };
}

export function ethereumPredecessorId(
  dependency: EthereumNonceDependency | undefined,
): string | undefined {
  return dependency?.predecessor.state === 'pending'
    ? dependency.predecessor.transactionId
    : undefined;
}
