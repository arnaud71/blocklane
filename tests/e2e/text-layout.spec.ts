import { expect, test, type Locator, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot } from '../../shared/model';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const CHAINS = ['bitcoin', 'ethereum'] as const;
const SOURCE =
  'ControlledProviderWithAnUnbrokenProvenanceIdentifier0123456789 · regional education observatory';
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const board = (page: Page, chain: ChainId) => pane(page, chain).locator('.info-billboard');

/** Large but valid observations exercise real formatting, not replacement DOM text. */
function snapshot(chain: ChainId): Snapshot {
  const bitcoin = chain === 'bitcoin';
  const hash = `${bitcoin ? '' : '0x'}${'a'.repeat(64)}`;
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt: NOW,
    coverage: 'Controlled local observation. The animated sample is not the complete network.',
    pendingCount: bitcoin ? 99_999 : 46_912,
    feeRate: bitcoin ? 17 : 1.23456789,
    feeUnit: bitcoin ? 'sat/vB' : 'Gwei',
    sampling: bitcoin
      ? {
          source: SOURCE,
          observedAt: NOW,
          method: 'getrawmempool',
          update: 'full',
          pendingCount: 99_999,
        }
      : {
          source: SOURCE,
          observedAt: NOW,
          method: 'txpool_content',
          pendingCount: 34_567,
          queuedCount: 12_345,
        },
    mempool: bitcoin
      ? null
      : {
          pending: 34_567,
          queued: 12_345,
          observedAt: NOW,
          status: 'ok',
          method: 'txpool_status',
        },
    transactions: [
      {
        id: `${bitcoin ? '' : '0x'}${'1'.repeat(64)}`,
        chain,
        feeRate: bitcoin ? 17 : 1.23456789,
        size: bitcoin ? 240 : 21_000,
        status: 'pending',
        kind: 'transfer',
        value: bitcoin ? '0.01 BTC' : '0.01 ETH',
      },
    ],
    blocks: [
      {
        hash,
        height: 900_000_001,
        timestamp: NOW / 1_000,
        txCount: 29_999,
        used: bitcoin ? 999_999 : 29_999_999,
        capacity: bitcoin ? 1_000_000 : 60_000_000,
      },
    ],
    inclusions: [],
    latestBlockValue: {
      blockHash: hash,
      blockHeight: 900_000_001,
      transactionCount: 29_999,
      amount: bitcoin ? '88888888812340000' : '888888888123400000000000000',
      unit: bitcoin ? 'sat' : 'wei',
      method: bitcoin ? 'bitcoin-output-sum' : 'ethereum-transaction-value-sum',
      observedAt: NOW,
    },
    candidateComparison: bitcoin
      ? {
          scope: 'complete',
          blockHash: hash,
          blockHeight: 900_000_001,
          parentBlockHash: 'b'.repeat(64),
          candidateObservedAt: NOW - 1_500,
          blockObservedAt: NOW,
          candidateSource: SOURCE,
          blockSource: SOURCE,
          candidateTransactionCount: 29_998,
          blockTransactionCount: 29_998,
          commonCount: 12_345,
          candidateOnlyCount: 17_653,
          blockOnlyCount: 17_653,
        }
      : null,
    eventFlow: {
      source: SOURCE,
      method: bitcoin ? 'mempool-txids' : 'newPendingTransactions',
      state: 'live',
      epoch: 1,
      startedAt: NOW - 3_000,
      observedAt: NOW,
      lastMessageAt: NOW,
      history: [
        {
          fromObservedAt: NOW - 3_000,
          observedAt: NOW,
          enteredCount: 19_999,
          outsideSampleEnteredCount: 0,
        },
      ],
    },
  });
}

async function openCity(page: Page) {
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/snapshot?*', async (route) => {
    const chain =
      new URL(route.request().url()).searchParams.get('chain') === 'ethereum'
        ? 'ethereum'
        : 'bitcoin';
    await route.fulfill({ json: snapshot(chain) });
  });
  await page.goto('/');
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-status', 'ok');
    await expect(board(page, chain)).toHaveAttribute('data-auto-rotating', 'false');
  }
}

/** Range rectangles reveal clipped glyphs even when an element's own box fits. */
async function textGeometry(region: Locator) {
  return region.evaluate((root) => {
    const tolerance = 1;
    const bounds = root.getBoundingClientRect();
    const issues: string[] = [];
    const boxes: { text: string; x: number; y: number; right: number; bottom: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const element = node.parentElement;
      const text = node.textContent ?? '';
      if (!element || !text.trim() || element.closest('.visually-hidden, .global-queue-note'))
        continue;
      if (getComputedStyle(element).visibility !== 'visible') continue;
      // Compact control labels intentionally replace a one-pixel accessible full label.
      let hiddenLabel = false;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const box = ancestor.getBoundingClientRect();
        const style = getComputedStyle(ancestor);
        if (style.position === 'absolute' && box.width <= 1 && box.height <= 1) hiddenLabel = true;
      }
      if (hiddenLabel) continue;
      const range = document.createRange();
      range.setStart(node, text.length - text.trimStart().length);
      range.setEnd(node, text.trimEnd().length);
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue;
        const label = text.trim().slice(0, 90);
        boxes.push({ text: label, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
        if (rect.x < bounds.x - tolerance || rect.right > bounds.right + tolerance)
          issues.push(`Outside region horizontally: ${label}`);
        if (rect.y < bounds.y - tolerance || rect.bottom > bounds.bottom + tolerance)
          issues.push(`Outside region vertically: ${label}`);
        if (rect.x < -tolerance || rect.right > document.documentElement.clientWidth + tolerance)
          issues.push(`Outside page horizontally: ${label}`);
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const clip = ancestor.getBoundingClientRect();
          if (
            ['hidden', 'clip'].includes(style.overflowX) &&
            (rect.x < clip.x - tolerance || rect.right > clip.right + tolerance)
          )
            issues.push(`Clipped horizontally by ${ancestor.className}: ${label}`);
          if (
            ['hidden', 'clip'].includes(style.overflowY) &&
            (rect.y < clip.y - tolerance || rect.bottom > clip.bottom + tolerance)
          )
            issues.push(`Clipped vertically by ${ancestor.className}: ${label}`);
        }
      }
    }
    return { issues, boxes };
  });
}

async function expectReadable(region: Locator) {
  const geometry = await textGeometry(region);
  expect(geometry.boxes.length, 'The region must contain visible text').toBeGreaterThan(0);
  expect(geometry.issues).toEqual([]);
  return geometry.boxes;
}

async function expectBoardReadable(screen: Locator) {
  await screen.scrollIntoViewIfNeeded();
  for (const item of await screen
    .locator(
      '.info-billboard-value, .info-billboard-unit, .info-billboard-label, ' +
        '.info-billboard-flow-kind, .info-billboard-lines p, ' +
        '.info-comparison-scope, .info-comparison-counts dt, .info-comparison-counts dd, ' +
        '.info-billboard-flow p, .info-billboard-footer, .info-billboard-source',
    )
    .all())
    await expect(item).toBeVisible();
  await expectReadable(screen);
  const content = await screen.locator('.info-billboard-screen').boundingBox();
  const footer = await screen.locator('.info-billboard-footer').boundingBox();
  const source = await screen.locator('.info-billboard-source').boundingBox();
  if (!content || !footer || !source) throw new Error('Board content and controls must exist');
  expect(content.y + content.height).toBeLessThanOrEqual(Math.min(footer.y, source.y) + 1);
  const boxes = await textGeometry(screen.locator('.info-billboard-screen'));
  expect(boxes.issues).toEqual([]);
  const controls = await textGeometry(screen.locator('.info-billboard-footer'));
  const provenance = await textGeometry(screen.locator('.info-billboard-source'));
  for (const left of [...boxes.boxes, ...controls.boxes]) {
    for (const right of provenance.boxes) {
      const overlapX = Math.min(left.right, right.right) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
      expect(
        overlapX > 1 && overlapY > 1,
        `Overlapping text: ${JSON.stringify({ left, right })}`,
      ).toBe(false);
    }
  }
  for (let left = 0; left < boxes.boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.boxes.length; right += 1) {
      const a = boxes.boxes[left]!;
      const b = boxes.boxes[right]!;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      expect(overlapX > 1 && overlapY > 1, `Overlapping text: ${JSON.stringify({ a, b })}`).toBe(
        false,
      );
    }
  }
}

async function expectPageTextReadable(page: Page) {
  for (const selector of [
    '.immersion-topbar',
    '.immersion-controls',
    '.shared-campus-header',
    '.shared-campus-footer',
  ]) {
    const region = page.locator(selector);
    await region.scrollIntoViewIfNeeded();
    await expectReadable(region);
  }
  for (const chain of CHAINS) {
    const queue = pane(page, chain).locator('.global-queue');
    const coverage = pane(page, chain).locator('.chain-coverage');
    await queue.scrollIntoViewIfNeeded();
    await expectReadable(queue);
    for (const item of await queue
      .locator('h3, .global-queue-caption p, .global-queue-total')
      .all())
      await expect(item).toBeVisible();
    await expect(queue.locator('.global-queue-breakdown')).toContainText(SOURCE);
    await coverage.scrollIntoViewIfNeeded();
    await expectReadable(coverage);
    await expect(coverage).toContainText(SOURCE);
    const queueBox = await queue.boundingBox();
    const coverageBox = await coverage.boundingBox();
    if (!queueBox || !coverageBox) throw new Error('Queue and coverage must exist');
    expect(queueBox.y + queueBox.height).toBeLessThanOrEqual(coverageBox.y + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
}

const sections = [
  ['Mempool', 'mempool', 'mempool'],
  ['Frais', 'frais', 'fees'],
  ['Bloc', 'bloc', 'block'],
  ['Valeur', 'valeur', 'value'],
  ['Voyageurs', 'voyageurs', 'travelers'],
  ['Comparaison', 'comparaison', 'comparison'],
  ['Flux', 'flux', 'flow'],
] as const;

for (const locale of ['fr', 'en'] as const) {
  test(`${locale}: long board values, provenance and page controls remain unclipped with larger text`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(
      testInfo.project.name === 'desktop'
        ? { width: 1_280, height: 720 }
        : { width: 320, height: 640 },
    );
    await openCity(page);
    await page
      .getByRole('button', { name: locale === 'fr' ? 'Français' : 'English', exact: true })
      .click();
    for (const enlarged of [false, true]) {
      if (enlarged) {
        // Reproduce a browser minimum-font preference without shrinking large numeric values.
        await page.addStyleTag({
          content: `
            .info-billboard :is(.info-billboard-page, .info-billboard-label,
              .info-billboard-unit, .info-billboard-lines, .info-comparison-scope,
              .info-comparison-counts dt, .info-comparison-counts dd,
              .info-billboard-flow-kind, .info-billboard-flow, .info-billboard-source,
              .info-billboard-rotation),
            .global-queue :is(h3, span, .global-queue-scale, .global-queue-breakdown),
            .chain-coverage, .shared-campus-title, .shared-campus-footer,
            .immersion-topbar :is(button, .control-label-full, .control-label-compact),
            .immersion-controls :is(button, label, select, .immersion-hint),
            .chain-title .data-status, .chain-departure-line,
            .chain-departure-line .departure-timer { font-size: 14px !important; }
          `,
        });
      }
      await expectPageTextReadable(page);
      for (const [id, french, english] of sections) {
        for (const chain of CHAINS) {
          if (id === 'Comparaison' && chain === 'ethereum') continue;
          const label = locale === 'fr' ? `Afficher ${french}` : `Show ${english}`;
          const name = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';
          const control = pane(page, chain).getByRole('button', {
            name: `${label} · ${name}`,
            exact: true,
          });
          await control.focus();
          await page.keyboard.press('Enter');
          await expect(control).toBeFocused();
          const screen = board(page, chain);
          await expect(screen).toHaveAttribute('data-page', id);
          // Existing compact layouts use the descriptive heading; Flow uses its kind label.
          if (id !== 'Flux' && page.viewportSize()!.width > 700)
            await expect(screen.locator('.info-billboard-page')).toBeVisible();
          if (id === 'Valeur')
            expect(
              (await screen.locator('.info-billboard-value').innerText()).length,
            ).toBeGreaterThan(10);
          if (id === 'Flux' || id === 'Comparaison')
            await expect(screen.locator('.info-billboard-source')).toContainText(SOURCE);
          await expectBoardReadable(screen);
        }
      }
      await expectPageTextReadable(page);
      await page.screenshot({
        path: testInfo.outputPath(`${locale}-${enlarged ? 'minimum-font' : 'normal'}-text.png`),
        fullPage: true,
      });
    }
  });
}
