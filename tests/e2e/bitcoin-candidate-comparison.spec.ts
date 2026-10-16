import { expect, test, type Locator, type Page } from '@playwright/test';
import { generateDemoSnapshot } from '../../server/demo';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';

const NOW = Date.parse('2026-10-15T18:00:00Z');
const PARENT_HASH = 'a'.repeat(64);
const BLOCK_HASH = 'b'.repeat(64);
const CANDIDATE_SOURCE = 'Nœud contrôlé · getblocktemplate';
const BLOCK_SOURCE = 'Nœud contrôlé · bloc complet';
const BASE_COMPARISON = {
  scope: 'complete' as const,
  blockHash: BLOCK_HASH,
  blockHeight: 900_001,
  parentBlockHash: PARENT_HASH,
  candidateObservedAt: NOW - 1_500,
  blockObservedAt: NOW,
  candidateSource: CANDIDATE_SOURCE,
  blockSource: BLOCK_SOURCE,
  candidateTransactionCount: 3,
  blockTransactionCount: 3,
  commonCount: 2,
  candidateOnlyCount: 1,
  blockOnlyCount: 1,
};
type Comparison = typeof BASE_COMPARISON;
const LARGE_COMPARISON: Comparison = {
  ...BASE_COMPARISON,
  candidateTransactionCount: 1_500,
  blockTransactionCount: 1_700,
  commonCount: 1_200,
  candidateOnlyCount: 300,
  blockOnlyCount: 500,
};
const pane = (page: Page, chain: ChainId = 'bitcoin') =>
  page.locator(`.chain-pane[data-chain="${chain}"]`);
const billboard = (page: Page, chain: ChainId = 'bitcoin') =>
  pane(page, chain).locator('.info-billboard');
const details = (page: Page) => page.getByTestId('candidate-comparison-details');
const category = (region: Locator, name: string) =>
  region.locator(`[data-comparison-category="${name}"]`);
const metric = (region: Locator, label: string) =>
  region
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
    .locator('dd');

function transaction(chain: ChainId): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${'1'.repeat(64)}`,
    chain,
    feeRate: 20,
    size: chain === 'bitcoin' ? 200 : 21_000,
    status: 'pending',
    kind: 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
  };
}

/** Comparison aggregates do not identify or confirm the one sampled pending traveler. */
function liveSnapshot(
  chain: ChainId,
  comparison: Comparison | null = null,
  observedAt = NOW,
  nextBlock = false,
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: BLOCK_SOURCE,
    observedAt,
    coverage:
      'Un seul détail pending contrôlé ; le bilan complet est indépendant de cet échantillon animé.',
    pendingCount: chain === 'bitcoin' ? 1_000 : null,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions: [transaction(chain)],
    blocks: [
      {
        hash:
          chain === 'ethereum' ? `0x${'e'.repeat(64)}` : nextBlock ? 'c'.repeat(64) : BLOCK_HASH,
        height: chain === 'bitcoin' ? 900_001 + Number(nextBlock) : 23_000_000,
        timestamp: NOW / 1_000,
        txCount: chain === 'bitcoin' ? (comparison?.blockTransactionCount ?? 3) + 1 : 100,
        used: chain === 'bitcoin' ? 500_000 : 30_000_000,
        capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
      },
    ],
    inclusions: [],
    candidateComparison: chain === 'bitcoin' ? comparison : null,
  });
}

async function routeSnapshots(
  page: Page,
  current: (chain: ChainId, mode: 'live' | 'demo') => unknown | null,
) {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    const payload = current(chain, mode);
    await route.fulfill(
      payload === null ? { status: 503, body: 'Fixture indisponible' } : { json: payload },
    );
  });
}

async function start(page: Page, reduced = true) {
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  if (reduced)
    await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
}

async function openComparison(page: Page) {
  await pane(page)
    .getByRole('button', { name: 'Afficher comparaison · Bitcoin', exact: true })
    .click();
  const screen = billboard(page);
  await expect(screen).toHaveAttribute('data-page', 'Comparaison');
  return screen;
}

async function expectWaiting(screen: Locator) {
  await expect(screen).toHaveAttribute('data-comparison-available', 'false');
  await expect(screen.locator('.info-billboard-value')).toHaveText('—');
  await expect(screen).toContainText('En attente d’un bilan');
  await expect(screen.locator('[data-comparison-category]')).toHaveCount(0);
  await expectComparisonGeometry(screen);
}

async function expectComparisonGeometry(screen: Locator) {
  const frame = await screen.boundingBox();
  const footer = await screen.locator('.info-billboard-footer').boundingBox();
  if (!frame || !footer) throw new Error('Le panneau et sa navigation doivent être visibles.');
  const selectors = [
    '.info-billboard-value',
    '.info-billboard-unit',
    '.info-comparison-scope',
    '[data-comparison-category]',
  ];
  const rectangles = [];
  for (const selector of selectors) {
    for (const element of await screen.locator(selector).all()) {
      const rectangle = await element.boundingBox();
      if (!rectangle) throw new Error(`Élément de comparaison invisible : ${selector}`);
      expect(rectangle.x).toBeGreaterThanOrEqual(frame.x - 1);
      expect(rectangle.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
      expect(
        rectangle.y + rectangle.height,
        `${selector} doit rester avant la navigation`,
      ).toBeLessThanOrEqual(footer.y + 1);
      rectangles.push(rectangle);
    }
  }
  for (let left = 0; left < rectangles.length; left += 1) {
    for (let right = left + 1; right < rectangles.length; right += 1) {
      const a = rectangles[left]!;
      const b = rectangles[right]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 1 && overlapY > 1).toBe(false);
    }
  }
  for (const [name, label] of [
    ['common', 'Prévues et incluses'],
    ['candidate-only', 'Prévues non incluses dans ce bloc'],
    ['block-only', 'Incluses hors candidat'],
  ] as const) {
    const item = category(screen, name);
    if (!(await item.count())) continue;
    const term = item.locator('dt');
    const longLabel = term.locator('.visually-hidden');
    await expect(longLabel).toHaveText(label);
    const masked = await longLabel.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        position: style.position,
        overflow: style.overflow,
        clip: style.clip,
        display: style.display,
        visibility: style.visibility,
        ariaHidden: node.getAttribute('aria-hidden'),
      };
    });
    expect(masked.width).toBeLessThanOrEqual(1);
    expect(masked.height).toBeLessThanOrEqual(1);
    expect(masked.position).toBe('absolute');
    expect(masked.overflow).toBe('hidden');
    expect(masked.clip).not.toBe('auto');
    expect(masked.display).not.toBe('none');
    expect(masked.visibility).toBe('visible');
    expect(masked.ariaHidden).not.toBe('true');
    expect(await term.ariaSnapshot()).toContain(label);
  }
}

async function expectCounts(region: Locator, comparison: Comparison) {
  for (const [name, count] of [
    ['common', comparison.commonCount],
    ['candidate-only', comparison.candidateOnlyCount],
    ['block-only', comparison.blockOnlyCount],
  ] as const) {
    await expect(category(region, name)).toHaveAttribute('data-count', String(count));
  }
  await expect(region).toContainText('Prévues et incluses');
  await expect(region).toContainText('Prévues non incluses dans ce bloc');
  await expect(region).toContainText('Incluses hors candidat');
}

function numeric(value: string) {
  const amount = value.replace(/[\s'’\u00a0\u202f%]/g, '').match(/^\d+(?:[.,]\d+)?/);
  return amount ? Number(amount[0].replace(',', '.')) : Number.NaN;
}

async function openDetails(page: Page) {
  await page
    .getByRole('button', { name: 'Afficher le panneau d’informations', exact: true })
    .click();
  const panel = page.getByTestId('info-panel');
  await panel.getByRole('tab', { name: 'Bloc', exact: true }).click();
  await expect(panel).toHaveAttribute('data-page', 'block');
  await expect(details(page)).toContainText('Comparaison candidat / bloc');
  return details(page);
}

async function wagonCounts(page: Page) {
  return pane(page)
    .locator('.street-wagon-transaction-count')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        count: node.getAttribute('data-transaction-count'),
        used: node.getAttribute('data-resource-used'),
        kind: node.getAttribute('data-occupancy-kind'),
      })),
    );
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop')
    await page.setViewportSize({ width: 1_280, height: 1_024 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('a missing comparison stays unknown until a complete same-block balance arrives without changing wagons', async ({
  page,
}) => {
  let ready = false;
  await routeSnapshots(page, (chain) => liveSnapshot(chain, ready ? BASE_COMPARISON : null));
  await start(page);
  const screen = await openComparison(page);
  await expectWaiting(screen);
  const wagons = await wagonCounts(page);
  expect(wagons.map((wagon) => wagon.count)).toEqual(['1', '0']);
  ready = true;
  await page.clock.runFor(3_100);
  await expect(screen).toHaveAttribute('data-comparison-available', 'true');
  await expect(screen).toHaveAttribute('data-comparison-scope', 'complete');
  await expectCounts(screen, BASE_COMPARISON);
  await expectComparisonGeometry(screen);
  expect(numeric(await screen.locator('.info-billboard-value').innerText())).toBeCloseTo(66.7, 1);
  expect(await wagonCounts(page)).toEqual(wagons);
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
  await expect(pane(page).locator('[data-preparation-progress]')).toHaveCount(0);
});

test('the Bitcoin comparison follows the four-second cycle and manual choice and pause stop rotation', async ({
  page,
}) => {
  await routeSnapshots(page, (chain) => liveSnapshot(chain, BASE_COMPARISON));
  await start(page, false);
  const screen = billboard(page);
  await expect(screen).toHaveAttribute('data-page', 'Mempool');
  for (const label of ['Frais', 'Bloc', 'Valeur', 'Voyageurs', 'Comparaison']) {
    await page.clock.fastForward(4_000);
    await expect(screen).toHaveAttribute('data-page', label);
  }
  await expectCounts(screen, BASE_COMPARISON);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await expect(screen).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.fastForward(12_000);
  await expect(screen).toHaveAttribute('data-page', 'Comparaison');
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.fastForward(4_000);
  await expect(screen).toHaveAttribute('data-page', 'Flux');
  await page.clock.fastForward(4_000);
  await expect(screen).toHaveAttribute('data-page', 'Mempool');
  await openComparison(page);
  await expect(screen).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.fastForward(8_000);
  await expect(screen).toHaveAttribute('data-page', 'Comparaison');
});

test('complete counts above the sample limit expose sources and original dates and clear for the next block', async ({
  page,
}, testInfo) => {
  let nextBlock = false;
  await routeSnapshots(page, (chain) =>
    liveSnapshot(
      chain,
      nextBlock ? null : LARGE_COMPARISON,
      nextBlock ? NOW + 3_000 : NOW,
      nextBlock,
    ),
  );
  await start(page);
  const screen = await openComparison(page);
  await expectCounts(screen, LARGE_COMPARISON);
  await expectComparisonGeometry(screen);
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1_280, height: 720 });
    await expectComparisonGeometry(screen);
    await page.setViewportSize({ width: 1_280, height: 1_024 });
    await expectComparisonGeometry(screen);
  }
  expect(numeric(await screen.locator('.info-billboard-value').innerText())).toBe(80);
  await expect(screen.locator('.info-billboard-screen')).toHaveAttribute('title', /hors coinbase/);
  const wagons = await wagonCounts(page);
  expect(wagons.map((wagon) => wagon.count)).toEqual(['1', '0']);
  await page.screenshot({
    path: `.local/qa/bitcoin-comparison-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const detail = await openDetails(page);
  await expectCounts(detail, LARGE_COMPARISON);
  expect(numeric(await metric(detail, 'Total du candidat').innerText())).toBe(1_500);
  expect(numeric(await metric(detail, 'Total du bloc hors coinbase').innerText())).toBe(1_700);
  await expect(metric(detail, 'Source du candidat')).toHaveText(CANDIDATE_SOURCE);
  await expect(metric(detail, 'Source du bloc')).toHaveText(BLOCK_SOURCE);
  await expect(metric(detail, 'Relevé du candidat').locator('time')).toHaveAttribute(
    'datetime',
    new Date(NOW - 1_500).toISOString(),
  );
  await expect(metric(detail, 'Première détection du bloc').locator('time')).toHaveAttribute(
    'datetime',
    new Date(NOW).toISOString(),
  );
  await expect(detail).toContainText('hors coinbase');
  await expect(detail.locator(`a[href*="${BLOCK_HASH}"]`)).toHaveCount(1);
  await detail.evaluate((section) => {
    const panel = section.closest<HTMLElement>('[data-testid="info-panel"]');
    if (!panel) throw new Error('Panneau de détails indisponible.');
    panel.scrollTop += section.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
  });
  await page.screenshot({
    path: `.local/qa/bitcoin-comparison-details-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(await wagonCounts(page)).toEqual(wagons);

  nextBlock = true;
  await page.clock.runFor(3_100);
  await expectWaiting(screen);
  await expect(detail).toContainText('En attente d’un bilan');
  await expect(detail.locator('[data-comparison-category]')).toHaveCount(0);
  await expect(detail.getByText(CANDIDATE_SOURCE, { exact: true })).toHaveCount(0);
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
});

test('a failed refresh keeps the original comparison dates before expiration removes the old counts', async ({
  page,
}) => {
  let failed = false;
  await routeSnapshots(page, (chain) =>
    chain === 'bitcoin' && failed ? null : liveSnapshot(chain, BASE_COMPARISON),
  );
  await start(page);
  const screen = await openComparison(page);
  const detail = await openDetails(page);
  const candidateDate = metric(detail, 'Relevé du candidat').locator('time');
  const blockDate = metric(detail, 'Première détection du bloc').locator('time');
  await expect(candidateDate).toHaveAttribute('datetime', new Date(NOW - 1_500).toISOString());
  await expect(blockDate).toHaveAttribute('datetime', new Date(NOW).toISOString());
  failed = true;
  await page.clock.fastForward(3_100);
  await expect(pane(page).getByRole('status')).toHaveAttribute(
    'aria-label',
    'Dernières données conservées',
  );
  await expect(screen).toHaveAttribute('data-status', 'stale');
  await expectCounts(screen, BASE_COMPARISON);
  await expect(detail).toContainText('Ancien bilan conservé');
  await expect(candidateDate).toHaveAttribute('datetime', new Date(NOW - 1_500).toISOString());
  await expect(blockDate).toHaveAttribute('datetime', new Date(NOW).toISOString());
  await page.clock.fastForward(120_001);
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Source indisponible');
  await expect(screen).toHaveAttribute('data-status', 'unavailable');
  await expectWaiting(screen);
  await expect(page.locator('[data-comparison-category]')).toHaveCount(0);
});

test('invalid real balances are rejected and neither Ethereum nor explicit demonstration invents a real comparison', async ({
  page,
}) => {
  let invalid = false;
  await routeSnapshots(page, (chain, mode) => {
    if (mode === 'demo') {
      const demo = generateDemoSnapshot(chain, NOW);
      return snapshotSchema.parse({
        ...demo,
        transactions: demo.transactions.filter((tx) => tx.status === 'pending').slice(0, 1),
        candidateComparison: null,
      });
    }
    const valid = liveSnapshot(chain);
    return invalid
      ? { ...valid, candidateComparison: { ...BASE_COMPARISON, candidateTransactionCount: 9_000 } }
      : valid;
  });
  await start(page);
  const screen = await openComparison(page);
  await expectWaiting(screen);
  await expect(
    pane(page, 'ethereum').getByRole('button', { name: /Afficher comparaison/ }),
  ).toHaveCount(0);
  invalid = true;
  await page.clock.runFor(3_100);
  for (const chain of ['bitcoin', 'ethereum'] as const) {
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Dernières données conservées',
    );
  }
  await expectWaiting(screen);
  await expect(screen).not.toContainText(/9['’\s]*000/);
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(pane(page).getByRole('status')).toHaveAttribute(
    'aria-label',
    'Simulation pédagogique',
  );
  await openComparison(page);
  await expectWaiting(screen);
  await expect(screen.locator('.info-billboard-screen')).toHaveAttribute(
    'title',
    /Démonstration.*aucun bilan réel/,
  );
  await expect(
    pane(page, 'ethereum').getByRole('button', { name: /Afficher comparaison/ }),
  ).toHaveCount(0);
  await expect(page.locator('[data-comparison-category]')).toHaveCount(0);
});
