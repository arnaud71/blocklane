import { describe, expect, it } from 'vitest';
import { assessFreshness } from '../../src/lib/freshness';
import { explorerUrl } from '../../src/lib/format';
import { safeExternalUrl } from '../../src/config/brand';
import { generateDemoSnapshot } from '../../server/demo';

describe('Browser data safeguards', () => {
  it('retires expired live transactions even when the server is unreachable', () => {
    const live = { ...generateDemoSnapshot('bitcoin', 1000), mode: 'live' as const };
    const expired = assessFreshness(live, true, 121001);
    expect(expired.status).toBe('unavailable');
    expect(expired.transactions).toEqual([]);
    expect(expired.blocks).toEqual([]);
    expect(expired.pendingCount).toBeNull();
    expect(expired.observedAt).toBe(1000);
  });
  it('keeps the original observation time for recent disconnected data', () => {
    const live = { ...generateDemoSnapshot('ethereum', 1000), mode: 'live' as const };
    expect(assessFreshness(live, true, 2000)).toMatchObject({ status: 'stale', observedAt: 1000 });
    expect(assessFreshness(live, false, 2000).status).toBe('ok');
  });
  it('never turns a demo into a stale live network', () => {
    const demo = generateDemoSnapshot('bitcoin', 1000);
    expect(assessFreshness(demo, true, 999999)).toBe(demo);
  });
  it('only builds explorer links from correctly shaped hashes', () => {
    expect(explorerUrl('bitcoin', 'a'.repeat(64), 'tx')).toBe(
      `https://mempool.space/tx/${'a'.repeat(64)}`,
    );
    expect(explorerUrl('ethereum', `0x${'b'.repeat(64)}`, 'tx')).toContain('etherscan.io');
    expect(explorerUrl('bitcoin', '../../secrets', 'tx')).toBeNull();
    expect(explorerUrl('ethereum', 'javascript:alert(1)', 'block')).toBeNull();
  });
  it('keeps FairOnChain optional and prohibits active or credential-bearing URLs', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('https://secret@example.com/')).toBeNull();
    expect(safeExternalUrl('https://example.com/course')).toBe('https://example.com/course');
  });
});
