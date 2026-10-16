import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type EthereumPredecessor,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import { queuePosition } from '../../src/lib/streetGeometry';

const NOW = Date.parse('2026-10-15T18:00:00Z');
const SOURCE = 'Pool contrôlé pour les dépendances de nonce';
const hash = (token: string) => `0x${token.repeat(8)}`;
const ACCOUNT = `0x${'a'.repeat(40)}`;
const pane = (page: Page) => page.locator('.chain-pane[data-chain="ethereum"]');
const firstWagon = (page: Page) => pane(page).locator('.street-first-wagon');
const wagon = (page: Page, kind: 'next' | 'later') =>
  (kind === 'next' ? firstWagon(page) : pane(page).locator('[data-projection="later"]')).getByRole(
    'img',
  );
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Ethereum' });
const selector = (page: Page) =>
  browser(page).getByRole('combobox', { name: 'Transaction représentée dans la scène' });
const description = (page: Page) => browser(page).locator('.passenger-canvas-browser-description');

function transaction(token: string, nonce: string, feeRate: number): Tx {
  return {
    id: hash(token),
    chain: 'ethereum',
    status: 'pending',
    feeRate,
    size: 21_000,
    kind: 'transfer',
    value: '0.01 ETH',
    ethereum: { from: ACCOUNT, nonce, gasPriceWei: String(feeRate * 1_000_000_000) },
  };
}

const parent = transaction('aa11aa11', '0', 0.5);
const replacement = transaction('bb22bb22', '0', 0.75);
const child = transaction('cc33cc33', '1', 3);

function block(token = 'eeee0000', height = 23_000_000): Block {
  return {
    hash: hash(token),
    height,
    timestamp: NOW / 1_000 - 12 + (height - 23_000_000) * 12,
    txCount: 100,
    used: 30_000_000,
    capacity: 60_000_000,
  };
}

interface Observation {
  observedAt: number;
  poolAt?: number;
  transactions?: Tx[];
  predecessor?: EthereumPredecessor;
  present?: string[];
  queued?: string[];
  absent?: string[];
  latest?: Block;
  inclusions?: Snapshot['inclusions'];
  context?: boolean;
  stage?: string;
}

/** The off-sample parent contributes an edge, never an invented individual or inclusion. */
function snapshot({
  observedAt,
  poolAt = observedAt,
  transactions = [child],
  predecessor = { state: 'pending', nonce: '0', transactionId: parent.id },
  present = [child.id, parent.id],
  queued = [],
  absent = [],
  latest = block(),
  inclusions = [],
  context = true,
  stage = 'initial',
}: Observation): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt,
    coverage: `Dépendances contrôlées : ${stage}. Les détails animés sont un échantillon ; une dépendance ne prouve aucune inclusion.`,
    pendingCount: null,
    feeRate: 1,
    feeUnit: 'Gwei',
    transactions,
    blocks: [latest],
    inclusions,
    ethereumProjection: {
      parentBlockHash: latest.hash,
      height: latest.height + 1,
      baseFeePerGasWei: '1000000000',
      observedAt,
      source: 'calculated',
    },
    sampling: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: poolAt,
      pendingCount: present.length,
      queuedCount: queued.length,
    },
    poolObservation: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: poolAt,
      presentTransactionIds: present,
      queuedTransactionIds: queued,
      absentTransactionIds: absent,
    },
    ethereumDependencies: context
      ? {
          source: SOURCE,
          observedAt: poolAt,
          parentBlockHash: latest.hash,
          height: latest.height + 1,
          entries: [
            {
              transactionId: child.id,
              from: ACCOUNT,
              nonce: '1',
              predecessor,
            },
          ],
        }
      : null,
  });
}

function bitcoinSnapshot(observedAt: number): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt,
    coverage: 'Source Bitcoin contrôlée sans transaction dans cet échantillon.',
    pendingCount: 0,
    feeRate: 1,
    feeUnit: 'sat/vB',
    transactions: [],
    blocks: [],
    inclusions: [],
  });
}

async function setup(page: Page, initial: Snapshot) {
  let current = initial;
  let revision = 0;
  let served = -1;
  let failure = false;
  let hold = false;
  let heldRequest: Route | undefined;
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    if (url.searchParams.get('chain') !== 'ethereum')
      return route.fulfill({ json: bitcoinSnapshot(current.observedAt) });
    served = revision;
    if (hold) {
      heldRequest = route;
      return;
    }
    if (failure) return route.fulfill({ status: 503, body: 'Source contrôlée indisponible' });
    return route.fulfill({ json: current });
  });
  await page.goto('/');
  await expect(pane(page).locator('.data-status')).toHaveAttribute(
    'aria-label',
    'Données en direct',
  );
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();

  return {
    async update(observation: Omit<Observation, 'observedAt'>, waitForPool = true) {
      // Model the provider's existing 30-second complete-pool cadence, not an extra RPC.
      if (waitForPool) await page.clock.fastForward(30_000);
      current = snapshot({ ...observation, observedAt: await page.evaluate(() => Date.now()) });
      revision += 1;
      for (let attempt = 0; attempt < 25 && served !== revision; attempt += 1)
        await page.clock.runFor(200);
      expect(served).toBe(revision);
      await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
        'title',
        new RegExp(`Dépendances contrôlées : ${observation.stage ?? 'initial'}\\.`),
      );
    },
    async failHeldRequest() {
      expect(heldRequest).toBeDefined();
      hold = false;
      failure = true;
      await heldRequest!.fulfill({ status: 503, body: 'Source contrôlée indisponible' });
      await expect(pane(page).locator('.data-status')).toHaveAttribute(
        'aria-label',
        'Dernières données conservées',
      );
    },
    holdNextRequest() {
      hold = true;
    },
  };
}

async function openBrowser(page: Page, selected: Tx = child) {
  await page
    .getByRole('button', { name: 'Parcourir les transactions Ethereum', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(selector(page)).toBeFocused();
  await selector(page).selectOption(selected.id);
  return description(page);
}

async function closeBrowser(page: Page) {
  await browser(page).getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
}

async function showDetails(page: Page): Promise<Locator> {
  await browser(page).getByRole('button', { name: 'Afficher les détails', exact: true }).focus();
  await page.keyboard.press('Enter');
  await closeBrowser(page);
  return page
    .getByTestId('info-panel')
    .locator('.info-detail')
    .filter({ has: page.locator('dt', { hasText: /^Dans la scène$/ }) })
    .locator('dd');
}

async function hidePanel(page: Page) {
  const hide = page.getByRole('button', { name: 'Masquer le panneau d’informations', exact: true });
  if (await hide.count()) await hide.click();
}

async function expectNoBoarding(page: Page, preparingBlock?: Block) {
  for (const kind of ['next', 'later'] as const) {
    await expect(wagon(page, kind)).toHaveAttribute('data-transaction-count', '0');
    await expect(wagon(page, kind)).toHaveAttribute(
      'data-resource-used',
      String(kind === 'next' && preparingBlock ? preparingBlock.used : 0),
    );
    await expect(wagon(page, kind)).toHaveAttribute('data-resource-capacity', '60000000');
  }
}

async function firstQueuePoint(page: Page) {
  const svg = pane(page).locator('.street-scene-svg');
  const columns = Number(await svg.getAttribute('data-queue-columns'));
  const rows = Number(await svg.getAttribute('data-queue-rows'));
  const position = queuePosition(0, { columns, rows, capacity: columns * rows });
  return svg.evaluate((element, canonical) => {
    const root = element as SVGSVGElement;
    const layout = root.viewBox.baseVal;
    const scale = (layout.x + layout.width - 298) / (460 - 298);
    const matrix = (root.querySelector(':scope > g') as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error('Projection de la scène indisponible');
    const point = root.createSVGPoint();
    point.x = 298 + (canonical.x - 298) * scale;
    point.y = canonical.y - 15;
    const screen = point.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, position);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('a known off-sample predecessor blocks an expensive child and remains explained at the pointer and keyboard', async ({
  page,
  isMobile,
}, testInfo) => {
  await setup(page, snapshot({ observedAt: NOW }));
  await expectNoBoarding(page);
  await hidePanel(page);
  const point = await firstQueuePoint(page);
  if (!isMobile) {
    await page.mouse.move(point.x, point.y);
    await expect(pane(page).locator('.passenger-canvas-tooltip')).toContainText(
      'même lorsqu’il est hors de l’échantillon animé',
    );
  }
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('info-panel').locator('.info-transaction-hash')).toHaveAttribute(
    'title',
    child.id,
  );
  await hidePanel(page);
  const reason = await openBrowser(page);
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(selector(page).locator(`option[value="${child.id}"]`)).toContainText(
    'en attente dans le dernier relevé complet du fournisseur',
  );
  await expect(reason).toContainText('doit être admis avant cette transaction');
  await expect(reason).toContainText(parent.id.slice(0, 12));
  const sceneReason = await showDetails(page);
  await expect(sceneReason).toContainText('hors de l’échantillon animé');
  await expect(page.getByTestId('info-panel')).toHaveAttribute(
    'data-selection-historical',
    'false',
  );
  await sceneReason.scrollIntoViewIfNeeded();
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({
    path: `.local/qa/ethereum-nonce-dependencies-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('a sampled parent becoming absent retains both travelers and does not release the child', async ({
  page,
}) => {
  const scenario = await setup(page, snapshot({ observedAt: NOW, transactions: [parent, child] }));
  await expectNoBoarding(page);
  await scenario.update({
    stage: 'parent absent',
    predecessor: { state: 'unknown', nonce: '0', transactionId: parent.id },
    present: [child.id],
    absent: [parent.id],
  });
  const reason = await openBrowser(page);
  await expect(selector(page).locator('option')).toHaveCount(2);
  await expect(reason).toContainText('Son absence ne prouve aucune inclusion');
  await expect(reason).toContainText('cette dépendance empêche l’embarquement');
  await selector(page).selectOption(parent.id);
  await expect(description(page)).toContainText('Absente du dernier relevé complet');
  await expect(description(page)).not.toContainText('inclusion observée');
  await selector(page).selectOption(child.id);
  await expect(await showDetails(page)).toContainText('est inconnu');
  await expectNoBoarding(page);
  await expect(pane(page).locator('[data-history-area]')).toHaveAttribute(
    'data-history-count',
    '1',
  );
});

test('a replacement of the off-sample parent updates its hash without confirming or drawing it', async ({
  page,
}) => {
  const scenario = await setup(page, snapshot({ observedAt: NOW }));
  await openBrowser(page);
  await expect(description(page)).toContainText(parent.id.slice(0, 12));
  await scenario.update({
    stage: 'parent remplacé',
    predecessor: { state: 'pending', nonce: '0', transactionId: replacement.id },
    present: [child.id, replacement.id],
    absent: [parent.id],
  });
  await expect(selector(page)).toHaveValue(child.id);
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(description(page)).toContainText(replacement.id.slice(0, 12));
  await expect(description(page)).not.toContainText(parent.id.slice(0, 12));
  await expect(description(page)).toContainText('hors de l’échantillon animé');
  await expectNoBoarding(page);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
});

test('exact parent inclusion releases the child after the ordinary stop and a reorg revokes that release', async ({
  page,
}) => {
  const scenario = await setup(page, snapshot({ observedAt: NOW }));
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  const includedBlock = block('ffff0000', 23_000_001);
  await scenario.update({
    stage: 'parent inclus',
    latest: includedBlock,
    predecessor: {
      state: 'confirmed',
      nonce: '0',
      transactionId: parent.id,
      blockHash: includedBlock.hash,
      blockHeight: includedBlock.height,
    },
    present: [child.id],
    absent: [parent.id],
    inclusions: [{ block: includedBlock, transactionIds: [parent.id] }],
  });
  await expect(firstWagon(page)).toHaveAttribute('data-preparation-progress', '0');
  await expectNoBoarding(page, includedBlock);
  await expect(wagon(page, 'next')).toHaveAttribute('data-occupancy-kind', 'block');
  await openBrowser(page);
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(description(page)).toContainText('a une inclusion exacte dans le bloc #23000001');
  await expect(description(page)).toContainText('elle ne confirme pas cette transaction');
  await closeBrowser(page);
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.runFor(1_650);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  await expect(wagon(page, 'next')).toHaveAttribute('data-transaction-count', '0');
  await openBrowser(page);
  await expect(description(page)).not.toContainText('à bord du wagon illustratif');
  await expect(description(page)).not.toContainText('inclusion observée');
  await closeBrowser(page);
  await page.clock.runFor(12_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(wagon(page, 'next')).toHaveAttribute('data-transaction-count', '1');
  await expect(wagon(page, 'next')).toHaveAttribute('data-resource-used', '21000');
  await openBrowser(page);
  await expect(description(page)).toContainText('à bord du wagon illustratif');
  await expect(description(page)).toContainText('elle ne confirme pas cette transaction');
  await closeBrowser(page);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await scenario.update({
    stage: 'réorganisation',
    latest: block('dddd0000', includedBlock.height),
    predecessor: { state: 'unknown', nonce: '0', transactionId: parent.id },
    present: [child.id],
    absent: [parent.id],
  });
  await openBrowser(page);
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(description(page)).toContainText('cette dépendance empêche l’embarquement');
  await expect(description(page)).not.toContainText('a une inclusion exacte');
  await expectNoBoarding(page);
});

test('a missing immediate nonce and a queued parent block admission while a never-observed parent is explicitly uncertain', async ({
  page,
}) => {
  const scenario = await setup(
    page,
    snapshot({
      observedAt: NOW,
      predecessor: { state: 'unobserved', nonce: '0' },
      present: [child.id],
    }),
  );
  await expect(wagon(page, 'next')).toHaveAttribute('data-transaction-count', '1');
  await openBrowser(page);
  await expect(description(page)).toContainText('Prédécesseur non observé pour le nonce 0');
  await expect(description(page)).toContainText('Projection incertaine');
  await scenario.update({
    stage: 'nonce manquant',
    predecessor: { state: 'gap', nonce: '0' },
    present: [child.id],
  });
  await expect(description(page)).toContainText('Un nonce intermédiaire manque');
  await expect(description(page)).toContainText('prédécesseur de nonce 0');
  await expectNoBoarding(page);
  await scenario.update({
    stage: 'parent différé',
    predecessor: { state: 'queued', nonce: '0', transactionId: parent.id },
    present: [child.id],
    queued: [parent.id],
  });
  await expect(selector(page)).toHaveValue(child.id);
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(description(page)).toContainText('est différé (queued) chez le fournisseur');
  await expectNoBoarding(page);
});

test('a slow refresh expires nonce evidence independently and a later failure never turns the old parent into a confirmation', async ({
  page,
}) => {
  await page.clock.fastForward(30_000);
  const scenario = await setup(page, snapshot({ observedAt: NOW + 30_000, poolAt: NOW }));
  await openBrowser(page);
  await expect(description(page)).toContainText('hors de l’échantillon animé');
  scenario.holdNextRequest();
  await page.clock.runFor(30_100);
  await expect(pane(page).locator('.data-status')).toHaveAttribute(
    'aria-label',
    'Données en direct',
  );
  await expect(description(page)).toContainText(
    'Couverture de dépendances ancienne ou indisponible',
  );
  await expect(description(page)).toContainText('cette dépendance empêche l’embarquement');
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expectNoBoarding(page);
  await scenario.failHeldRequest();
  await expect(pane(page).locator('.data-status')).toHaveAttribute(
    'aria-label',
    'Dernières données conservées',
  );
  await expect(description(page)).not.toContainText('a une inclusion exacte');
  await expect(description(page)).not.toContainText('inclusion observée');
  await expect(browser(page).getByRole('button', { name: 'Afficher les détails' })).toBeEnabled();
  await expect(await showDetails(page)).toContainText('cette dépendance empêche l’embarquement');
});
