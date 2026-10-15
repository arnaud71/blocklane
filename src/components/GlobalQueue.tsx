import { useId } from 'react';
import type { ChainId, Snapshot } from '../../shared/model';
import { number } from '../lib/format';
import { MAX_GLOBAL_QUEUE_GROUPS } from '../lib/globalQueue';
import { providerMempool } from '../lib/mempoolDisplay';
import './GlobalQueue.css';

type GlobalQueueProps = {
  snapshot: Snapshot | null;
  chain: ChainId;
  mode: 'live' | 'demo';
  transactionsPerGroup: number;
};

const GROUPS_PER_ROW = 24;
const CROWD_COLORS = ['#a8c6b7', '#a4bbc9', '#b9afca', '#c1bda6'];

/** An aggregate of one provider's local pool, never a set of invented transaction IDs. */
export function GlobalQueue({ snapshot, chain, mode, transactionsPerGroup }: GlobalQueueProps) {
  const id = useId().replace(/:/g, '');
  const noteId = `global-queue-note-${id}`;
  const personId = `global-queue-person-${id}`;
  const observation = snapshot?.chain === chain && snapshot.mode === mode ? snapshot : null;
  const pool = providerMempool(observation);
  const total = pool.total;
  const sharedGroupSize =
    Number.isSafeInteger(transactionsPerGroup) && transactionsPerGroup > 0
      ? transactionsPerGroup
      : 1;
  // App supplies a shared scale; a defensive minimum keeps even an invalid caller bounded.
  const groupSize = Math.max(
    sharedGroupSize,
    total === null ? 1 : Math.ceil(total / MAX_GLOBAL_QUEUE_GROUPS),
  );
  const groupCount = total === null ? 0 : Math.ceil(total / groupSize);
  const lastGroupSize =
    total === null || groupCount === 0 ? 0 : total - groupSize * (groupCount - 1);
  const simulated = mode === 'demo' || pool.status === 'demo';
  const state = simulated
    ? 'Simulation'
    : pool.status === 'stale'
      ? 'Ancien relevé'
      : pool.status === 'unavailable'
        ? 'Indisponible'
        : 'Direct';
  const scaleLabel =
    total !== null
      ? `1 silhouette ${groupSize === 1 ? '=' : '≈'} ${number(groupSize)} tx`
      : 'Comptage non fourni';
  const groupingNote =
    groupCount === 0
      ? total === 0
        ? 'La file mesurée est vide.'
        : 'Aucune foule n’est dessinée sans comptage disponible.'
      : `${number(groupCount)} silhouettes regroupent exactement ${number(total)} transactions : chaque groupe contient ${number(groupSize)} transactions, sauf le dernier qui en contient ${number(lastGroupSize)}. Ces silhouettes collectives ne correspondent pas à des transactions identifiées et leurs couleurs n’indiquent aucun frais.`;
  const note = `${pool.note} ${groupingNote}`;
  const sourceName = pool.source ?? observation?.source ?? 'la source';
  const breakdown =
    pool.pending !== null && pool.queued !== null
      ? `Vue locale de ${sourceName} · ${number(pool.pending)} pending + ${number(pool.queued)} queued`
      : simulated
        ? 'Mempool simulée'
        : `Vue locale de ${sourceName} · distincte de l’échantillon`;

  return (
    <section
      className={`global-queue global-queue--${chain}`}
      aria-label={`File globale du fournisseur ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`}
      aria-describedby={noteId}
      data-status={pool.status}
      title={note}
    >
      <div className="global-queue-heading">
        <h3>File globale · fournisseur</h3>
        <p className={`global-queue-total${total === null ? ' global-queue-total--unknown' : ''}`}>
          {total === null ? 'Non mesurée' : number(total)}
          {total !== null && <span> tx</span>}
        </p>
      </div>
      <div className="global-queue-crowd">
        {groupCount > 0 ? (
          <svg
            viewBox="0 0 480 34"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <g id={personId}>
                <ellipse cx="8" cy="15" rx="6" ry="1.5" fill="#081d19" opacity=".6" />
                <path d="M5.2 10.5v4.8h2.3v-3h1v3h2.3v-4.8" fill="#344b51" />
                <path
                  d="M4.6 6.4Q8 4.8 11.4 6.4l1.1 5-2 .4-.7-3v3H6.2v-3l-.7 3-2-.4Z"
                  fill="currentColor"
                />
                <circle cx="8" cy="4" r="3.5" fill="#dbc4a6" stroke="#37544a" strokeWidth=".6" />
                <path d="M5 3.3q3-4 6 0" fill="#637866" />
              </g>
            </defs>
            {Array.from({ length: groupCount }, (_, index) => (
              <use
                key={index}
                href={`#${personId}`}
                x={(index % GROUPS_PER_ROW) * 20 + 2}
                y={Math.floor(index / GROUPS_PER_ROW) * 17}
                color={CROWD_COLORS[index % CROWD_COLORS.length]}
              />
            ))}
          </svg>
        ) : (
          <p className="global-queue-empty">
            {total === 0 ? 'File vide' : 'Comptage indisponible'}
          </p>
        )}
      </div>
      <div className="global-queue-caption">
        <p className="global-queue-scale">
          <span>{scaleLabel}</span>
          <span className="global-queue-state">{state}</span>
        </p>
        <p className="global-queue-breakdown">{breakdown}</p>
      </div>
      <p id={noteId} className="global-queue-note">
        {note}
      </p>
    </section>
  );
}
