import { describe, expect, it } from 'vitest';
import type { BitcoinBlockTemplate, Block, Tx } from '../../shared/model';
import { bitcoinCandidateRepresentation, wagonBlockOccupancy } from '../../src/lib/blockCapacity';

const id = (index: number) => index.toString(16).padStart(64, '0');
const members = Array.from({ length: 960 }, (_, index) => ({
  id: id(index + 1),
  size: 100,
  status: 'pending' as const,
}));
function template(overrides: Partial<BitcoinBlockTemplate> = {}): BitcoinBlockTemplate {
  return {
    source: 'Nœud contrôlé',
    observedAt: 1_700_000_000_000,
    height: 101,
    previousBlockHash: id(100),
    transactionCount: 5_000,
    weight: 3_992_000,
    weightLimit: 4_000_000,
    selectedTransactionIds: members.map((tx) => tx.id),
    ...overrides,
  };
}

describe('Complete Bitcoin candidate accounting with bounded individuals', () => {
  it('shows the complete proposed count and weight rather than the top-fee avatars alone', () => {
    const candidate = template();
    expect(wagonBlockOccupancy(members, 1_000_000, undefined, candidate)).toEqual({
      transactionCount: 5_000,
      used: 998_000,
      capacity: 1_000_000,
      percentage: 99.8,
      kind: 'template',
    });
    expect(wagonBlockOccupancy(members, 1_000_000)).toMatchObject({
      transactionCount: 960,
      used: 96_000,
      percentage: 9.6,
      kind: 'sample',
    });
    expect(members).toHaveLength(960);
  });

  it('uses the node candidate weight policy and preserves exact quarter-vB resources', () => {
    const occupancy = wagonBlockOccupancy(
      [],
      1_000_000,
      undefined,
      template({
        weight: 1_000_001,
        weightLimit: 2_000_000,
      }),
    );
    expect(occupancy).toMatchObject({ used: 250_000.25, capacity: 500_000 });
    expect(occupancy.percentage).toBeCloseTo(50.00005, 8);
  });

  it('does not require every proposed member to have reached a drawn seat', () => {
    expect(wagonBlockOccupancy([], 1_000_000, undefined, template())).toMatchObject({
      transactionCount: 5_000,
      percentage: 99.8,
      kind: 'template',
    });
  });

  it('keeps a real empty candidate empty with a measured zero', () => {
    const empty = template({ transactionCount: 0, weight: 0, selectedTransactionIds: [] });
    expect(wagonBlockOccupancy([], 1_000_000, undefined, empty)).toMatchObject({
      transactionCount: 0,
      used: 0,
      percentage: 0,
      kind: 'template',
    });
    expect(bitcoinCandidateRepresentation(empty, [])).toEqual({
      individualCount: 0,
      groupedCount: 0,
    });
  });

  it('gives real mined-block metadata precedence and never treats the candidate as a confirmation', () => {
    const block: Block = {
      hash: id(101),
      height: 101,
      timestamp: 1_700_000_000,
      txCount: 2_000,
      used: 750_000,
      capacity: 1_000_000,
    };
    expect(wagonBlockOccupancy(members.slice(0, 1), 1_000_000, block, template())).toMatchObject({
      transactionCount: 1,
      used: 750_000,
      percentage: 75,
      kind: 'block',
    });
    expect(wagonBlockOccupancy(members, 1_000_000, null, template())).toMatchObject({
      transactionCount: 960,
      used: null,
      percentage: null,
      kind: 'unavailable',
    });
  });

  it('returns to sampled occupancy when a candidate is withdrawn', () => {
    expect(wagonBlockOccupancy(members, 1_000_000, undefined, null)).toMatchObject({
      transactionCount: 960,
      used: 96_000,
      kind: 'sample',
    });
  });

  it('groups exactly the complement of individually represented members, including queue arrivals', () => {
    // Positions intentionally do not enter this contract: a member waiting outside
    // the door already has an individual and must not also appear in the group.
    expect(bitcoinCandidateRepresentation(template(), members)).toEqual({
      individualCount: 960,
      groupedCount: 4_040,
    });
  });

  it('does not subtract server-known members without an individual instance', () => {
    const candidate = template({
      selectedTransactionIds: [...members.map((tx) => tx.id), id(9_999)],
    });
    expect(bitcoinCandidateRepresentation(candidate, members)).toEqual({
      individualCount: 960,
      groupedCount: 4_040,
    });
  });

  it('deduplicates case-insensitively and excludes nonmembers and proven confirmations', () => {
    const candidate = template({ selectedTransactionIds: [id(11), id(12)] });
    const people: Pick<Tx, 'id' | 'status'>[] = [
      { id: id(11), status: 'pending' },
      { id: id(11).toUpperCase(), status: 'pending' },
      { id: id(12), status: 'confirmed' },
      { id: id(13), status: 'pending' },
    ];
    expect(bitcoinCandidateRepresentation(candidate, people)).toEqual({
      individualCount: 1,
      groupedCount: 4_999,
    });
  });

  it('does not add a collective group when all members already have individuals', () => {
    expect(bitcoinCandidateRepresentation(template({ transactionCount: 960 }), members)).toEqual({
      individualCount: 960,
      groupedCount: 0,
    });
  });

  it('refreshes membership for a revised candidate at the same height and parent', () => {
    const candidate = template({
      selectedTransactionIds: [id(11)],
      transactionCount: 2,
    });
    const revised = { ...candidate, selectedTransactionIds: [id(12)] };
    const first = [{ id: id(11), status: 'pending' as const }];
    const second = [{ id: id(12), status: 'pending' as const }];
    expect(bitcoinCandidateRepresentation(candidate, first)).toEqual({
      individualCount: 1,
      groupedCount: 1,
    });
    expect(bitcoinCandidateRepresentation(candidate, second)).toEqual({
      individualCount: 0,
      groupedCount: 2,
    });
    expect(bitcoinCandidateRepresentation(revised, first)).toEqual({
      individualCount: 0,
      groupedCount: 2,
    });
    expect(bitcoinCandidateRepresentation(revised, second)).toEqual({
      individualCount: 1,
      groupedCount: 1,
    });
  });
});
