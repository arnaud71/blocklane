import {
  TRACKED_TRANSACTION_TTL_MS,
  bitcoinCandidateComparisonSchema,
  type BitcoinCandidateComparison,
} from '../../shared/model.js';
import { BITCOIN_TEMPLATE_MAX_AGE_MS, type BitcoinTemplateSample } from './bitcoinTemplate.js';

interface ObservedHead {
  id: string;
  height: number;
  tx_count: number;
  previousblockhash?: string;
}

interface PublishedCandidate {
  height: number;
  parentHash: string;
  observedAt: number;
  source: string;
  transactionIds: Set<string>;
}

interface HeadDetection {
  hash: string;
  height: number;
  transactionCount: number;
  parentHash: string | undefined;
  observedAt: number;
  source: string;
}

interface CheckedBlock {
  hash: string;
  /** Full, validated, unique IDs, in block order: the first is coinbase. */
  transactionIds: ReadonlySet<string>;
}

const HASH = /^[a-fA-F0-9]{64}$/;
const CANONICAL_HASH = /^[a-f0-9]{64}$/;
const MAX_CANDIDATE_TRANSACTIONS = 30_000;

function isTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sameHead(detection: HeadDetection, block: ObservedHead): boolean {
  return (
    detection.hash === block.id.toLowerCase() &&
    detection.height === block.height &&
    detection.transactionCount === block.tx_count &&
    detection.parentHash === block.previousblockhash?.toLowerCase()
  );
}

/**
 * Two bounded private candidate sets at most: the last published proposal and
 * the one frozen at the first detection of the current head. No network work.
 */
export function createBitcoinCandidateComparisonTracker() {
  let head: HeadDetection | null = null;
  let published: PublishedCandidate | null = null;
  let frozen: PublishedCandidate | null = null;
  let result: BitcoinCandidateComparison | null = null;

  function prune(now: number): void {
    if (!isTime(now) || (head && now < head.observedAt)) {
      published = null;
      frozen = null;
      result = null;
      return;
    }
    if (
      published &&
      (now < published.observedAt || now - published.observedAt > BITCOIN_TEMPLATE_MAX_AGE_MS)
    )
      published = null;
    if (
      frozen &&
      head &&
      (now < head.observedAt || now - head.observedAt > TRACKED_TRANSACTION_TTL_MS)
    )
      frozen = null;
  }

  return {
    /** Called immediately when the existing blocks response has been validated. */
    observeHead(block: ObservedHead, observedAt: number, source: string): void {
      prune(observedAt);
      if (head && sameHead(head, block)) return;
      const previous = head;
      const next: HeadDetection = {
        hash: block.id.toLowerCase(),
        height: block.height,
        transactionCount: block.tx_count,
        parentHash: block.previousblockhash?.toLowerCase(),
        observedAt,
        source,
      };
      frozen =
        previous &&
        published &&
        isTime(observedAt) &&
        observedAt >= previous.observedAt &&
        next.height === previous.height + 1 &&
        next.parentHash === previous.hash &&
        published.height === next.height &&
        published.parentHash === next.parentHash &&
        published.observedAt <= observedAt
          ? published
          : null;
      published = null;
      result = null;
      head = next;
    },

    /** A read completed after detection cannot retroactively become its candidate. */
    publishCandidate(
      template: BitcoinTemplateSample | null,
      block: ObservedHead,
      publishedAt: number,
    ): void {
      prune(publishedAt);
      if (
        !template ||
        !head ||
        !sameHead(head, block) ||
        !isTime(publishedAt) ||
        publishedAt < head.observedAt ||
        !isTime(template.observedAt) ||
        template.observedAt > publishedAt ||
        publishedAt - template.observedAt > BITCOIN_TEMPLATE_MAX_AGE_MS ||
        template.height !== head.height + 1 ||
        !HASH.test(template.previousBlockHash) ||
        template.previousBlockHash.toLowerCase() !== head.hash ||
        !Number.isSafeInteger(template.count) ||
        template.count < 0 ||
        template.count > MAX_CANDIDATE_TRANSACTIONS ||
        template.transactionIds.size !== template.count ||
        template.source.length < 1 ||
        template.source.length > 100 ||
        (published && template.observedAt < published.observedAt)
      )
        return;
      const transactionIds = new Set<string>();
      for (const id of template.transactionIds) {
        if (!HASH.test(id)) return;
        const canonical = id.toLowerCase();
        if (transactionIds.has(canonical)) return;
        transactionIds.add(canonical);
      }
      // Own the frozen inventory: a background reader can replace or reuse its sample.
      published = {
        height: template.height,
        parentHash: head.hash,
        observedAt: template.observedAt,
        source: template.source,
        transactionIds,
      };
    },

    /** Branch contradictions revoke the proposal too; no late recapture for this head. */
    invalidate(): void {
      published = null;
      frozen = null;
      result = null;
    },

    compare(
      block: ObservedHead,
      checkedBlock: CheckedBlock | undefined,
      now: number,
    ): BitcoinCandidateComparison | null {
      prune(now);
      if (!head || !sameHead(head, block) || !isTime(now) || now < head.observedAt) return null;
      if (result) return result;
      if (
        !frozen ||
        !checkedBlock ||
        checkedBlock.hash !== head.hash ||
        !head.parentHash ||
        !CANONICAL_HASH.test(head.hash) ||
        !CANONICAL_HASH.test(head.parentHash) ||
        block.tx_count < 1 ||
        block.tx_count > MAX_CANDIDATE_TRANSACTIONS ||
        checkedBlock.transactionIds.size !== block.tx_count
      )
        return null;

      let commonCount = 0;
      let index = 0;
      for (const id of checkedBlock.transactionIds) {
        if (!CANONICAL_HASH.test(id)) return null;
        if (index === 0 && frozen.transactionIds.has(id)) return null;
        // The existing complete block read includes coinbase; GBT's set does not.
        if (index++ > 0 && frozen.transactionIds.has(id)) commonCount += 1;
      }
      const candidateTransactionCount = frozen.transactionIds.size;
      const blockTransactionCount = block.tx_count - 1;
      const parsed = bitcoinCandidateComparisonSchema.safeParse({
        scope: 'complete',
        blockHash: head.hash,
        blockHeight: head.height,
        parentBlockHash: head.parentHash,
        candidateObservedAt: frozen.observedAt,
        blockObservedAt: head.observedAt,
        candidateSource: frozen.source,
        blockSource: head.source,
        candidateTransactionCount,
        blockTransactionCount,
        commonCount,
        candidateOnlyCount: candidateTransactionCount - commonCount,
        blockOnlyCount: blockTransactionCount - commonCount,
      });
      if (!parsed.success) return null;
      result = parsed.data;
      // Only the aggregates need to survive a successful comparison.
      frozen = null;
      return result;
    },
  };
}
