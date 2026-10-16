import type {
  BlockInclusions,
  EthereumDependencies,
  EthereumPredecessor,
} from '../../shared/model.js';

export interface EthereumNonceMetadata {
  transactionId: string;
  from: string;
  /** Canonical decimal uint256, without conversion through Number. */
  nonce: string;
}

export interface EthereumPoolNonceEntry extends EthereumNonceMetadata {
  state: 'pending' | 'queued';
}

export interface EthereumPoolNonceIndex {
  byNonce: ReadonlyMap<string, EthereumPoolNonceEntry>;
  pendingIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  minimumNonce: ReadonlyMap<string, bigint>;
  observedAt: number;
}

interface RememberedMetadata extends EthereumNonceMetadata {
  observedAt: number;
}

interface RememberedEdge {
  transactionId?: string;
  observedAt: number;
  reason: 'parent' | 'gap';
}

interface ParentObservation {
  metadata: EthereumNonceMetadata;
  observedAt: number;
}

export function ethereumNonceKey(from: string, nonce: string): string {
  return `${from.toLowerCase()}:${nonce}`;
}

/** No account-state RPC: retain only metadata and uncertainty for already watched IDs. */
export function createEthereumDependencyTracker() {
  const metadata = new Map<string, RememberedMetadata>();
  const knownEdges = new Map<string, RememberedEdge>();

  function metadataByNonce(tracked: ReadonlyMap<string, number>) {
    const byNonce = new Map<string, RememberedMetadata>();
    for (const entry of metadata.values()) {
      if (!tracked.has(entry.transactionId)) continue;
      const key = ethereumNonceKey(entry.from, entry.nonce);
      const previous = byNonce.get(key);
      if (!previous || entry.observedAt > previous.observedAt) byNonce.set(key, entry);
    }
    return byNonce;
  }

  function remember(entry: EthereumNonceMetadata, observedAt: number): void {
    const previous = metadata.get(entry.transactionId);
    // A hash's account/nonce identity cannot be rewritten by a later pool observation.
    if (previous && (previous.from !== entry.from || previous.nonce !== entry.nonce)) return;
    if (!previous || observedAt >= previous.observedAt)
      metadata.set(entry.transactionId, { ...entry, observedAt });
  }

  return {
    remember,

    prune(tracked: ReadonlyMap<string, number>): void {
      for (const id of metadata.keys()) if (!tracked.has(id)) metadata.delete(id);
      for (const [id, edge] of knownEdges) {
        if (!tracked.has(id)) knownEdges.delete(id);
        else if (edge.transactionId && !tracked.has(edge.transactionId)) {
          // Forget the expired hash, never the fact that its availability was uncertain.
          knownEdges.set(id, { observedAt: edge.observedAt, reason: edge.reason });
        }
      }
    },

    /** Request only immediate parents, ordered with the current sample's children first. */
    parentObservations(
      children: Iterable<string>,
      tracked: ReadonlyMap<string, number>,
      pool: EthereumPoolNonceIndex,
      latestTransactions: Iterable<EthereumNonceMetadata>,
      collectedAt: number,
    ): ParentObservation[] {
      const wanted = new Map<string, string[]>();
      for (const id of children) {
        const child = metadata.get(id);
        if (!child || !tracked.has(id) || child.nonce === '0') continue;
        const key = ethereumNonceKey(child.from, (BigInt(child.nonce) - 1n).toString());
        const ids = wanted.get(key) ?? [];
        ids.push(id);
        wanted.set(key, ids);
      }
      // Scan the already-read full block once; retain only relevant compact matches.
      const includedParents = new Map<string, EthereumNonceMetadata>();
      for (const entry of latestTransactions) {
        const key = ethereumNonceKey(entry.from, entry.nonce);
        if (wanted.has(key)) includedParents.set(key, entry);
      }
      const historical = metadataByNonce(tracked);
      const parents = new Map<string, ParentObservation>();
      for (const [key, childIds] of wanted) {
        const included = includedParents.get(key);
        const present = pool.byNonce.get(key);
        const remembered = historical.get(key);
        for (const childId of childIds) {
          const edge = knownEdges.get(childId);
          const newerPool =
            present &&
            (!edge ||
              (pool.observedAt >= edge.observedAt &&
                (edge.transactionId === present.transactionId ||
                  pool.observedAt > edge.observedAt)));
          const parent = included ?? (newerPool ? present : undefined) ?? remembered;
          if (!parent) continue;
          parents.set(parent.transactionId, {
            metadata: parent,
            observedAt: included
              ? collectedAt
              : parent === present
                ? pool.observedAt
                : remembered!.observedAt,
          });
        }
      }
      return [...parents.values()];
    },

    build(
      tracked: ReadonlyMap<string, number>,
      pool: EthereumPoolNonceIndex,
      inclusions: readonly BlockInclusions[],
      source: string,
      parentBlockHash: string,
      height: number,
      collectedAt: number,
    ): EthereumDependencies {
      const historical = metadataByNonce(tracked);
      const confirmed = new Map<
        string,
        { metadata: RememberedMetadata; blockHash: string; blockHeight: number } | null
      >();
      for (const inclusion of inclusions) {
        for (const id of inclusion.transactionIds) {
          const entry = metadata.get(id);
          if (!entry || !tracked.has(id)) continue;
          const key = ethereumNonceKey(entry.from, entry.nonce);
          const previous = confirmed.get(key);
          confirmed.set(
            key,
            confirmed.has(key) && (previous === null || previous!.metadata.transactionId !== id)
              ? null
              : {
                  metadata: entry,
                  blockHash: inclusion.block.hash,
                  blockHeight: inclusion.block.height,
                },
          );
        }
      }
      const entries: EthereumDependencies['entries'] = [];
      for (const [id] of tracked) {
        const child = metadata.get(id);
        if (!child) continue;
        let predecessor: EthereumPredecessor;
        if (child.nonce === '0') {
          predecessor = { state: 'root' };
        } else {
          const nonce = (BigInt(child.nonce) - 1n).toString();
          const key = ethereumNonceKey(child.from, nonce);
          const included = confirmed.get(key);
          const present = pool.byNonce.get(key);
          const remembered = historical.get(key);
          const edge = knownEdges.get(id);
          if (included) {
            predecessor = {
              state: 'confirmed',
              nonce,
              transactionId: included.metadata.transactionId,
              blockHash: included.blockHash,
              blockHeight: included.blockHeight,
            };
            knownEdges.set(id, {
              transactionId: included.metadata.transactionId,
              observedAt: Math.max(edge?.observedAt ?? 0, collectedAt),
              reason: 'parent',
            });
          } else if (
            present &&
            !confirmed.has(key) &&
            tracked.has(present.transactionId) &&
            (!edge ||
              (pool.observedAt >= edge.observedAt &&
                (edge.transactionId === present.transactionId ||
                  pool.observedAt > edge.observedAt)))
          ) {
            predecessor = { state: present.state, nonce, transactionId: present.transactionId };
            knownEdges.set(id, {
              transactionId: present.transactionId,
              observedAt: pool.observedAt,
              reason: 'parent',
            });
          } else if (
            !remembered &&
            !present &&
            edge?.reason !== 'parent' &&
            (pool.minimumNonce.get(child.from) ?? BigInt(child.nonce)) < BigInt(nonce)
          ) {
            predecessor = { state: 'gap', nonce };
            knownEdges.set(id, { observedAt: pool.observedAt, reason: 'gap' });
          } else if (edge || remembered || present || confirmed.has(key)) {
            const previousId = edge?.transactionId ?? remembered?.transactionId;
            predecessor = {
              state: 'unknown',
              nonce,
              ...(previousId && tracked.has(previousId) ? { transactionId: previousId } : {}),
            };
            if (!edge)
              knownEdges.set(id, {
                ...(previousId && tracked.has(previousId) ? { transactionId: previousId } : {}),
                observedAt: pool.observedAt,
                reason: 'parent',
              });
          } else if (pool.pendingIds.has(id)) {
            // First observed pending nonce: the provider estimates it executable.
            // This does not assert an account nonce or reconstruct unseen history.
            predecessor = { state: 'unobserved', nonce };
          } else {
            predecessor = { state: 'unknown', nonce };
          }
        }
        entries.push({
          transactionId: child.transactionId,
          from: child.from,
          nonce: child.nonce,
          predecessor,
        });
      }
      return { source, observedAt: pool.observedAt, parentBlockHash, height, entries };
    },
  };
}
