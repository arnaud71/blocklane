import type { BitcoinBlockTemplate, Block, Snapshot, Tx } from '../../shared/model';

/** BIP-141's 4,000,000 weight units expressed in the same vB units as the provider. */
export const BITCOIN_BLOCK_VBYTES = 1_000_000;

export function capacityForSnapshot(snapshot: Pick<Snapshot, 'chain' | 'blocks'>): number | null {
  if (snapshot.chain === 'bitcoin') return BITCOIN_BLOCK_VBYTES;
  const capacity = snapshot.blocks[0]?.capacity;
  return capacity !== undefined && Number.isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Bitcoin vB, or Ethereum's declared gas limit (not gas consumed by execution). */
export function transactionBlockSize(tx: Pick<Tx, 'size'>): number {
  return Number.isFinite(tx.size) && tx.size > 0 ? tx.size : 0;
}

export function blockUsagePercent(used: number, capacity: number | null): number | null {
  if (
    capacity === null ||
    !Number.isFinite(capacity) ||
    capacity <= 0 ||
    !Number.isFinite(used) ||
    used < 0
  )
    return null;
  const percentage = (used / capacity) * 100;
  return Number.isFinite(percentage) ? percentage : null;
}

export interface WagonBlockOccupancy {
  transactionCount: number;
  used: number | null;
  capacity: number | null;
  percentage: number | null;
  kind: 'sample' | 'template' | 'block' | 'unavailable';
}

// Snapshots are immutable: retain this normalized membership only while its
// candidate is reachable, rather than rebuilding it at the animation cadence.
const candidateMembers = new WeakMap<BitcoinBlockTemplate, ReadonlySet<string>>();

/** Collective members have no invented identity; count existing individuals anywhere in the scene. */
export function bitcoinCandidateRepresentation(
  template: BitcoinBlockTemplate,
  transactions: Iterable<Pick<Tx, 'id' | 'status'>>,
): { individualCount: number; groupedCount: number } {
  let members = candidateMembers.get(template);
  if (!members) {
    members = new Set(template.selectedTransactionIds.map((id) => id.toLowerCase()));
    candidateMembers.set(template, members);
  }
  const individuals = new Set<string>();
  for (const tx of transactions) {
    const id = tx.id.toLowerCase();
    if (tx.status === 'pending' && members.has(id)) individuals.add(id);
  }
  const individualCount = Math.min(template.transactionCount, individuals.size);
  return { individualCount, groupedCount: template.transactionCount - individualCount };
}

/** An explicit null block means confirmed metadata is missing; never substitute gas limits. */
export function wagonBlockOccupancy(
  transactions: Iterable<Pick<Tx, 'id' | 'size'>>,
  capacity: number | null,
  confirmedBlock?: Block | null,
  nodeTemplate?: BitcoinBlockTemplate | null,
): WagonBlockOccupancy {
  const ids = new Set<string>();
  let sampleSize = 0;
  let validSizes = true;
  for (const tx of transactions) {
    if (ids.has(tx.id)) continue;
    ids.add(tx.id);
    const size = transactionBlockSize(tx);
    validSizes &&= size > 0;
    sampleSize += size;
  }
  const unavailable: WagonBlockOccupancy = {
    transactionCount: ids.size,
    used: null,
    capacity,
    percentage: null,
    kind: 'unavailable',
  };
  if (confirmedBlock !== undefined) {
    if (!confirmedBlock) return unavailable;
    const percentage = blockUsagePercent(confirmedBlock.used, confirmedBlock.capacity);
    if (percentage === null || percentage > 100) return unavailable;
    return {
      transactionCount: ids.size,
      used: confirmedBlock.used,
      capacity: confirmedBlock.capacity,
      percentage,
      kind: 'block',
    };
  }
  if (nodeTemplate) {
    const used = nodeTemplate.weight / 4;
    const templateCapacity = nodeTemplate.weightLimit / 4;
    const percentage = blockUsagePercent(used, templateCapacity);
    if (percentage === null || percentage > 100) return unavailable;
    return {
      transactionCount: nodeTemplate.transactionCount,
      used,
      capacity: templateCapacity,
      percentage,
      kind: 'template',
    };
  }
  const percentage = validSizes ? blockUsagePercent(sampleSize, capacity) : null;
  if (percentage === null) return unavailable;
  return {
    transactionCount: ids.size,
    used: sampleSize,
    capacity,
    percentage,
    kind: 'sample',
  };
}
