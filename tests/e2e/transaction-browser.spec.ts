import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const NOW = Date.parse('2026-10-15T18:00:00Z');
const SOURCE = 'Nœud contrôlé pour le navigateur';
const pane = (page: Page, chain: ChainId = 'ethereum') =>
  page.locator(`.chain-pane[data-chain="${chain}"]`);
const dialog = (page: Page, chain: ChainId = 'ethereum') =>
  page.getByRole('dialog', {
    name: `Transactions observées ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
  });
const selector = (browser: Locator) =>
  browser.getByRole('combobox', { name: 'Transaction représentée dans la scène' });
const search = (browser: Locator) =>
  browser.getByRole('searchbox', { name: 'Rechercher une transaction' });
const filter = (browser: Locator, name: string) =>
  browser
    .getByRole('group', { name: 'Filtrer les transactions' })
    .getByRole('radio', { name, exact: true });
const results = (browser: Locator) =>
  browser.getByRole('status', { name: 'Résultats de recherche' });
const representedOptions = (browser: Locator) =>
  selector(browser).locator('option:not([value=""])');

function transaction(chain: ChainId, token: string, sender: string, feeRate = 2): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${token.repeat(8)}`,
    chain,
    status: 'pending',
    feeRate,
    size: chain === 'ethereum' ? 21_000 : 200,
    kind: 'transfer',
    value: chain === 'ethereum' ? '0.01 ETH' : '0.01 BTC',
    ...(chain === 'ethereum'
      ? {
          ethereum: {
            from: `0x${sender.repeat(40)}`,
            nonce: '0',
            maxFeePerGasWei: '4000000000',
            maxPriorityFeePerGasWei: String((feeRate - 1) * 1_000_000_000),
          },
        }
      : {}),
  };
}

const current = { ...transaction('ethereum', 'a1b2c3d4', 'a', 3), size: 40_000_000 };
const deferred = transaction('ethereum', 'b2c3d4e5', 'b');
// Three large gas reservations cannot all fit in two 60M-gas projections.
// The lower-priority unknown traveler has never boarded, so its later history belongs on the quay.
const unknown = { ...transaction('ethereum', 'c3d4e5f6', 'c'), size: 40_000_000 };
const absent = transaction('ethereum', 'd4e5f6a7', 'd');
const replaced = transaction('ethereum', 'e5f6a7b8', 'e');
const replacement = transaction('ethereum', 'f6a7b8c9', 'e', 3);
const datedPresent = { ...transaction('ethereum', 'ab90cd12', 'f', 3), size: 40_000_000 };
const initial = [current, deferred, unknown, absent, replaced, datedPresent];
const allIds = [...initial, replacement].map((tx) => tx.id);
const bitcoin = [
  transaction('bitcoin', 'a1b2c3d4', 'a'),
  transaction('bitcoin', 'b2c3d4e5', 'b'),
  transaction('bitcoin', 'ab90cd12', 'c'),
];

function block(chain: ChainId, next = false): Block {
  return {
    hash: `${chain === 'ethereum' ? '0x' : ''}${next ? '9'.repeat(64) : '8'.repeat(64)}`,
    height: (chain === 'ethereum' ? 23_000_000 : 900_000) + Number(next),
    timestamp: NOW / 1_000 - 12 + Number(next) * 12,
    txCount: 100,
    used: chain === 'ethereum' ? 30_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
  };
}

/** Reconciliation covers only the returned tracked IDs; unknown has no presence evidence. */
function snapshot(chain: ChainId, stage: number): Snapshot {
  const observedAt = NOW + Math.min(stage, 2) * 3_000;
  const proved = chain === 'ethereum' && stage === 3;
  const latest = block(chain, proved);
  const transactions =
    chain === 'bitcoin'
      ? bitcoin
      : stage === 0
        ? initial
        : stage === 1
          ? [current, replacement]
          : stage === 2
            ? [replacement]
            : [{ ...current, status: 'confirmed' as const, blockHash: latest.hash }, replacement];
  const present =
    stage < 2 ? [current.id, datedPresent.id, replacement.id] : [datedPresent.id, replacement.id];
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt,
    coverage: `Navigateur contrôlé étape ${stage}. Échantillon partiel ; identifiants suivis réconciliés séparément, sans inférer de confirmation d’une absence.`,
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: 1,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions,
    blocks: [latest],
    inclusions: proved ? [{ block: latest, transactionIds: [current.id] }] : [],
    ...(chain === 'ethereum'
      ? {
          ethereumProjection: {
            parentBlockHash: latest.hash,
            height: latest.height + 1,
            baseFeePerGasWei: '1000000000',
            observedAt,
            source: 'calculated',
          },
        }
      : {}),
    ...(chain === 'ethereum' && stage > 0
      ? {
          sampling: {
            source: SOURCE,
            observedAt,
            method: 'txpool_content',
            pendingCount: present.length,
            queuedCount: 1,
          },
          poolObservation: {
            source: SOURCE,
            observedAt,
            method: 'txpool_content',
            presentTransactionIds: present,
            queuedTransactionIds: [deferred.id],
            absentTransactionIds: [absent.id, ...(stage === 2 ? [current.id] : [])],
          },
        }
      : {}),
  });
}

async function setup(page: Page) {
  let stage = 0;
  const served = new Set<number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    if (chain === 'ethereum') served.add(stage);
    await route.fulfill({ json: snapshot(chain, stage) });
  });
  await page.goto('/');
  for (const chain of ['bitcoin', 'ethereum'] as const) {
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  }
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  return async (nextStage: number) => {
    stage = nextStage;
    for (let attempt = 0; attempt < 20 && !served.has(stage); attempt += 1)
      await page.clock.runFor(200);
    expect(served.has(stage)).toBe(true);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      new RegExp(`Navigateur contrôlé étape ${stage}\\.`),
    );
  };
}

async function openBrowser(page: Page, chain: ChainId = 'ethereum') {
  const trigger = page.getByRole('button', {
    name: `Parcourir les transactions ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const browser = dialog(page, chain);
  if (await selector(browser).isEnabled()) await expect(selector(browser)).toBeFocused();
  else await expect(search(browser)).toBeFocused();
  return browser;
}

async function expectResults(browser: Locator, count: number, total: number) {
  await expect(results(browser)).toHaveText(
    new RegExp(`^${count} résultats? sur ${total} transactions? représentées?\\.?$`),
  );
  await expect(representedOptions(browser)).toHaveCount(count);
}

async function expectIds(browser: Locator, ids: string[], total = allIds.length) {
  await expectResults(browser, ids.length, total);
  expect(
    await representedOptions(browser).evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    ),
  ).toEqual([...ids].sort());
}

async function canvasState(page: Page) {
  const bitmap = await pane(page)
    .locator('canvas.passenger-canvas')
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D indisponible');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2_166_136_261;
      let painted = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3]) painted += 1;
        for (let channel = 0; channel < 4; channel += 1)
          hash = Math.imul(hash ^ pixels[index + channel]!, 16_777_619);
      }
      return { hash: hash >>> 0, painted };
    });
  const wagons = await pane(page)
    .locator('.street-wagon-transaction-count')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        count: node.getAttribute('data-transaction-count'),
        used: node.getAttribute('data-resource-used'),
      })),
    );
  return { bitmap, wagons };
}

async function selectDetails(page: Page, browser: Locator, id: string) {
  await selector(browser).selectOption(id);
  await browser.getByRole('button', { name: 'Afficher les détails', exact: true }).focus();
  await page.keyboard.press('Enter');
  await browser.getByRole('button', { name: 'Fermer les transactions', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(browser).toHaveCount(0);
  const panel = page.getByTestId('info-panel');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', id);
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('hash-fragment search is case insensitive and preserves a matching keyboard selection', async ({
  page,
}) => {
  await setup(page);
  const browser = await openBrowser(page, 'bitcoin');
  await expectResults(browser, 3, 3);
  const selected = bitcoin[2]!;
  await selector(browser).selectOption(selected.id);
  await search(browser).focus();
  // This middle fragment is longer than the shortened option label: match the full hash.
  await page.keyboard.type(selected.id.slice(16, 40).toUpperCase());
  await expectIds(browser, [selected.id], 3);
  await expect(selector(browser)).toHaveValue(selected.id);
  await search(browser).fill('');
  await expectResults(browser, 3, 3);
  await expect(selector(browser)).toHaveValue(selected.id);
  await selector(browser).focus();
  await page.keyboard.press('Tab');
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' }),
  ).toBeFocused();
});

test('presence, queued and historical filters use dated evidence without removing Canvas travelers', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await refresh(1);
  const browser = await openBrowser(page);
  await expectIds(browser, allIds);
  await expect(pane(page).locator('[data-history-area]')).toHaveAttribute(
    'data-history-count',
    '3',
  );
  const scene = await canvasState(page);
  expect(scene.bitmap.painted).toBeGreaterThan(0);

  await filter(browser, 'Présentes').check();
  await expectIds(browser, [current.id, datedPresent.id, replacement.id]);
  await expect(selector(browser).locator(`option[value="${datedPresent.id}"]`)).toContainText(
    /pending|présen|relevé/i,
  );
  await filter(browser, 'Différées').check();
  await expectIds(browser, [deferred.id]);
  await expect(selector(browser).locator('option')).toContainText(/queued|différée/i);
  await filter(browser, 'Historiques').check();
  await expectIds(browser, [unknown.id, absent.id, replaced.id]);
  await expect(selector(browser).locator(`option[value="${absent.id}"]`)).toContainText(/absen/i);
  await expect(selector(browser).locator(`option[value="${replaced.id}"]`)).toContainText(
    /remplac/i,
  );
  await page.screenshot({
    path: `.local/qa/transaction-browser-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await filter(browser, 'Incluses').check();
  await expectResults(browser, 0, 7);
  await expect(selector(browser)).toBeDisabled();
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeDisabled();
  await filter(browser, 'Toutes').check();
  await expectIds(browser, allIds);
  expect(await canvasState(page)).toEqual(scene);
  await page.screenshot({
    path: testInfo.outputPath('transaction-status-filters.png'),
    fullPage: true,
  });
  await browser.getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
  await expect(browser).toHaveCount(0);
  await page.screenshot({
    path: `.local/qa/transaction-history-quay-${testInfo.project.name}.png`,
    fullPage: true,
  });

  const inspection = await openBrowser(page);
  await filter(inspection, 'Historiques').check();
  await selector(inspection).selectOption(replaced.id);
  const details = inspection.getByRole('button', { name: 'Afficher les détails' });
  if (testInfo.project.name === 'desktop') {
    const sceneBox = await pane(page).locator('.street-scene').boundingBox();
    const dialogBox = await inspection.boundingBox();
    if (!sceneBox || !dialogBox) throw new Error('Scène et dialogue doivent être visibles.');
    expect(dialogBox.x).toBeGreaterThanOrEqual(sceneBox.x - 1);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + 1);
    expect(dialogBox.y).toBeGreaterThanOrEqual(sceneBox.y - 1);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(sceneBox.y + sceneBox.height + 1);
    const clippedParents = pane(page).locator('.scene-stage, .street-scene');
    const before = await clippedParents.evaluateAll((nodes) => nodes.map((node) => node.scrollTop));
    expect(before.every((offset) => offset === 0)).toBe(true);
    await inspection.hover();
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => inspection.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect(details).toBeInViewport();
    expect(
      await clippedParents.evaluateAll((nodes) => nodes.map((node) => node.scrollTop)),
    ).toEqual(before);
    await details.click();
  } else {
    await details.focus();
    await page.keyboard.press('Enter');
  }
  await inspection.getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('info-panel');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', replaced.id);
  await expect(panel).toHaveAttribute('data-selection-pool-state', 'replaced');
  const replacementTime = panel
    .locator('.info-detail')
    .filter({
      has: page.locator('dt', { hasText: /^Observation du remplacement$/ }),
    })
    .locator('time');
  await expect(replacementTime).toHaveAttribute('datetime', new Date(NOW + 3_000).toISOString());
  await expect(panel.getByText('Inventaire vérifié', { exact: true })).toHaveCount(0);
});

test('an empty search disables details without keeping a phantom selection and can be cleared', async ({
  page,
}) => {
  const refresh = await setup(page);
  await refresh(1);
  const browser = await openBrowser(page);
  await selector(browser).selectOption(deferred.id);
  await search(browser).fill('hash-inexistant');
  await expectResults(browser, 0, 7);
  await expect(selector(browser)).toHaveValue('');
  await expect(selector(browser)).toBeDisabled();
  await expect(browser.locator('.passenger-canvas-browser-description')).toHaveCount(0);
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeDisabled();
  await search(browser).press('Enter');
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  await search(browser).press('Escape');
  await expect(browser).toHaveCount(0);
  await openBrowser(page);
  await expect(search(browser)).toHaveValue('hash-inexistant');
  await expect(search(browser)).toBeFocused();
  await expectResults(browser, 0, 7);
  await search(browser).fill('');
  await expectIds(browser, allIds);
  await expect(selector(browser)).toBeEnabled();
  const selectedId = await selector(browser).inputValue();
  expect(allIds).toContain(selectedId);
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeEnabled();
  const panel = await selectDetails(page, browser, selectedId);
  await expect(panel).toHaveAttribute('data-page', 'transaction');
});

test('a refreshed absence updates an active search and keeps the old detail date honest', async ({
  page,
}) => {
  const refresh = await setup(page);
  await refresh(1);
  const browser = await openBrowser(page);
  await filter(browser, 'Présentes').check();
  await search(browser).fill(current.id.toUpperCase());
  await expectIds(browser, [current.id]);
  await refresh(2);
  await expectResults(browser, 0, 7);
  await expect(selector(browser)).toHaveValue('');
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeDisabled();
  await filter(browser, 'Historiques').check();
  await expectIds(browser, [current.id]);
  await expect(selector(browser).locator('option')).toContainText(/absen/i);
  const panel = await selectDetails(page, browser, current.id);
  await expect(panel).toHaveAttribute('data-selection-pool-state', 'absent');
  await expect(panel).toContainText('Cela ne prouve ni une confirmation ni un remplacement');
  const date = panel
    .locator('.info-detail')
    .filter({ has: page.locator('dt', { hasText: /^Dernière observation$/ }) })
    .locator('time');
  await expect(date).toHaveAttribute('datetime', new Date(NOW + 3_000).toISOString());
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
});

test('only exact confirmed evidence enters the inclusion filter before the verified traveler leaves', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await refresh(1);
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(3);
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute(
    'data-preparation-progress',
    /^[0-9.]+$/,
  );
  const browser = await openBrowser(page);
  await filter(browser, 'Incluses').check();
  await expectIds(browser, [current.id]);
  await expect(selector(browser).locator('option')).toContainText('incluse dans un bloc observé');
  const panel = await selectDetails(page, browser, current.id);
  await expect(panel.getByText('Incluse dans un bloc observé', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Masquer le panneau d’informations' }).click();
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  const remaining = await openBrowser(page);
  await filter(remaining, 'Incluses').check();
  await expectResults(remaining, 0, 6);
  await expect(remaining.getByRole('button', { name: 'Afficher les détails' })).toBeDisabled();
  await filter(remaining, 'Toutes').check();
  await expectIds(
    remaining,
    allIds.filter((id) => id !== current.id),
    6,
  );
  await expect(selector(remaining).locator(`option[value="${absent.id}"]`)).toContainText(/absen/i);
  await page.screenshot({
    path: testInfo.outputPath('transaction-browser-after-exact-inclusion.png'),
    fullPage: true,
  });
});
