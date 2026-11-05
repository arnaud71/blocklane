import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const SOURCE = 'Controlled USDT block logs';
const pane = (page: Page) => page.locator('.chain-pane[data-chain="ethereum"]');
const house = (page: Page) =>
  page.getByRole('button', { name: 'Maison USDT : parcourir les transactions', exact: true });
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Ethereum', exact: true });
const selector = (page: Page) =>
  browser(page).getByRole('combobox', { name: 'Transaction représentée dans la scène' });
const summary = (page: Page) => browser(page).getByRole('region', { name: 'Observations USDT' });
const transfer: Tx = {
  id: `0x${'a'.repeat(64)}`,
  chain: 'ethereum',
  status: 'pending',
  feeRate: 2,
  size: 65_000,
  kind: 'contract',
  value: '0 ETH',
  tokens: [{ tokenId: 'usdt', operation: 'transfer', evidence: 'call', amount: '1234567' }],
};
const approval: Tx = {
  ...transfer,
  id: `0x${'b'.repeat(64)}`,
  tokens: [{ tokenId: 'usdt', operation: 'approval', evidence: 'call', amount: '5000000' }],
};
const native: Tx = {
  ...transfer,
  id: `0x${'c'.repeat(64)}`,
  kind: 'transfer',
  value: '1 ETH',
  tokens: undefined,
};

type ReportState = 'observed' | 'zero' | 'unavailable' | 'stale' | 'older-exact-head';
function snapshot(chain: ChainId, state: ReportState, mode: 'live' | 'demo' = 'live'): Snapshot {
  const block = {
    hash: `${chain === 'ethereum' ? '0x' : ''}${'8'.repeat(64)}`,
    height: chain === 'ethereum' ? 23_000_000 : 900_000,
    timestamp: NOW / 1_000 - 12,
    txCount: 100,
    used: chain === 'ethereum' ? 30_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
  };
  return snapshotSchema.parse({
    chain,
    mode,
    status: state === 'stale' && mode === 'live' ? 'stale' : 'ok',
    source: SOURCE,
    observedAt: NOW,
    coverage: 'Controlled bounded sample for USDT browser checks.',
    pendingCount: chain === 'bitcoin' ? 0 : null,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions:
      chain === 'ethereum'
        ? [transfer, approval, native].map((tx) =>
            mode === 'demo'
              ? { ...tx, tokens: tx.tokens?.map((activity) => ({ ...activity, evidence: 'demo' })) }
              : tx,
          )
        : [],
    blocks: [block],
    ...(chain === 'ethereum'
      ? {
          tokenTransfers:
            state === 'unavailable'
              ? null
              : [
                  {
                    tokenId: 'usdt',
                    blockHash: block.hash,
                    blockHeight: block.height,
                    source: SOURCE,
                    observedAt:
                      NOW -
                      (state === 'stale' ? 45_000 : state === 'older-exact-head' ? 125_000 : 0),
                    method: mode === 'demo' ? 'simulation' : 'eth_getLogs',
                    transactionCount: state === 'zero' ? 0 : 2,
                    transferCount: state === 'zero' ? 0 : 3,
                    amount: state === 'zero' ? '0' : '1234567890123456789012345',
                  },
                ],
        }
      : {}),
  });
}

async function setup(page: Page, state: ReportState = 'observed') {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    await route.fulfill({ json: snapshot(chain, state, mode) });
  });
  await page.goto('/');
  await expect(house(page)).toBeVisible();
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
}

async function canvasHash(page: Page) {
  return pane(page)
    .locator('canvas.passenger-canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2_166_136_261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16_777_619);
      return hash >>> 0;
    });
}

async function openHouse(page: Page) {
  await house(page).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toBeVisible();
  await expect(browser(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('USDT house opens the accessible subset and highlights existing passengers without losing the general browser', async ({
  page,
}, testInfo) => {
  await setup(page);
  await expect(page.locator('[data-token-house="usdt"]')).toHaveCount(1);
  await expect(page.locator('.chain-pane[data-chain="bitcoin"] [data-token-house]')).toHaveCount(0);
  const initial = await canvasHash(page);
  await openHouse(page);
  await expect(house(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(selector(page).locator('option')).toHaveCount(2);
  await expect(selector(page).locator(`option[value="${transfer.id}"]`)).toContainText(
    'Intention de transfert',
  );
  await expect(selector(page).locator(`option[value="${approval.id}"]`)).toContainText(
    'Autorisation, pas un transfert',
  );
  await expect(summary(page).locator('[data-token-pending-count]')).toHaveText('2');
  await expect(summary(page).locator('[data-token-block-transactions]')).toHaveText('2');
  await expect(summary(page).locator('[data-token-block-events]')).toHaveText('3');
  await expect(summary(page).locator('[data-token-block-amount]')).toHaveText(
    '1\u202f234\u202f567\u202f890\u202f123\u202f456\u202f789,012345 USDT',
  );
  await expect(summary(page)).toContainText('sans total mondial');
  await expect(summary(page)).toContainText('Une autorisation n’est pas un transfert');
  await expect(summary(page).locator('time')).toHaveAttribute(
    'datetime',
    new Date(NOW).toISOString(),
  );
  expect(await canvasHash(page)).not.toBe(initial);
  await page.screenshot({
    path: testInfo.outputPath('usdt-house-accessible-list.png'),
    fullPage: true,
  });
  await browser(page)
    .getByRole('checkbox', { name: 'USDT uniquement · voyageurs mis en évidence' })
    .uncheck();
  await expect(selector(page).locator('option')).toHaveCount(3);
  await expect.poll(() => canvasHash(page)).toBe(initial);
  await selector(page).selectOption(native.id);
  await browser(page).getByRole('searchbox').fill(native.id.slice(15, 40).toUpperCase());
  await expect(selector(page).locator('option')).toHaveCount(1);
  await expect(selector(page)).toHaveValue(native.id);
  await page.keyboard.press('Escape');
  await expect(browser(page)).toHaveCount(0);
  await expect(house(page)).toBeFocused();
  await page
    .getByRole('button', { name: 'Parcourir les transactions Ethereum', exact: true })
    .click();
  await expect(selector(page)).toHaveValue(native.id);
  await expect(browser(page).getByRole('checkbox')).not.toBeChecked();
  await expect(browser(page).getByRole('searchbox')).toHaveValue(
    native.id.slice(15, 40).toUpperCase(),
  );
  await page.keyboard.press('Escape');
  await house(page).focus();
  await page.keyboard.press('Space');
  await expect(selector(page).locator('option')).toHaveCount(2);
  await expect(browser(page).getByRole('searchbox')).toHaveValue('');
  const bounds = await browser(page).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  const shortcut = page.getByRole('button', {
    name: 'Parcourir les transactions USDT sur Ethereum',
    exact: true,
  });
  await shortcut.focus();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toBeFocused();
  await expect(selector(page).locator('option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(shortcut).toBeFocused();
  await page.keyboard.press('Enter');
  await selector(page).selectOption(transfer.id);
  await browser(page).getByRole('button', { name: 'Afficher les détails' }).click();
  const details = page.getByTestId('info-panel');
  await expect(details).toHaveAttribute('data-page', 'transaction');
  await expect(details).toContainText('USDT · Intention de transfert');
  await expect(details).toContainText('1,234567 USDT');
  await expect(details).toContainText('0 ETH');
  // On a phone the details panel covers the non-modal browser. Close it before
  // choosing another traveler, as a pointer user would, rather than clicking through it.
  await details.getByRole('button', { name: 'Fermer le panneau d’informations' }).click();
  await expect(details).toHaveCount(0);
  await selector(page).selectOption(approval.id);
  await browser(page).getByRole('button', { name: 'Afficher les détails' }).click();
  await expect(details).toContainText('USDT · Autorisation, pas un transfert');
  await expect(details).toContainText('5 USDT');
});

for (const state of ['zero', 'unavailable', 'stale', 'older-exact-head'] as const) {
  test(`USDT block totals distinguish ${state} from other source states`, async ({ page }) => {
    await setup(page, state);
    await openHouse(page);
    await expect(summary(page)).toHaveAttribute(
      'data-token-report',
      state === 'zero' || state === 'older-exact-head' ? 'ok' : state,
    );
    await expect(summary(page).locator('[data-token-pending-count]')).toHaveText('2');
    await expect(summary(page).locator('[data-token-block-transactions]')).toHaveText(
      state === 'unavailable' ? '—' : state === 'zero' ? '0' : '2',
    );
    if (state === 'unavailable') {
      await expect(summary(page)).toContainText('Transferts du dernier bloc indisponibles');
      await expect(summary(page).locator('time')).toHaveCount(0);
    } else if (state === 'stale') {
      await expect(summary(page)).toContainText('Observation ancienne');
      await expect(summary(page).locator('time')).toHaveAttribute(
        'datetime',
        new Date(NOW - 45_000).toISOString(),
      );
    } else if (state === 'older-exact-head') {
      await expect(summary(page)).toContainText('Journaux du bloc observés');
      await expect(summary(page).locator('time')).toHaveAttribute(
        'datetime',
        new Date(NOW - 125_000).toISOString(),
      );
    } else {
      await expect(summary(page).locator('[data-token-block-events]')).toHaveText('0');
      await expect(summary(page).locator('[data-token-block-amount]')).toHaveText('0 USDT');
    }
  });
}

test('USDT simulation and English labels stay explicit with a quiet reduced-motion house', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await openHouse(page);
  await expect(summary(page)).toHaveAttribute('data-token-report', 'demo');
  await expect(summary(page)).toContainText('Simulation explicite');
  await expect(selector(page).locator(`option[value="${transfer.id}"]`)).toContainText(
    'Transfert simulé',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const englishHouse = page.getByRole('button', {
    name: 'USDT house: browse transactions',
    exact: true,
  });
  await englishHouse.focus();
  await page.keyboard.press('Enter');
  const englishBrowser = page.getByRole('dialog', {
    name: 'Observed Ethereum transactions',
    exact: true,
  });
  await expect(englishBrowser).toContainText('Limited sample, without a worldwide mempool total');
  await expect(englishBrowser).toContainText('An approval is not a transfer');
  await expect(englishBrowser).toContainText('Explicit simulation');
  await expect(
    englishBrowser.getByRole('checkbox', { name: 'USDT only · highlighted passengers' }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(englishHouse).toBeFocused();
  await expect(englishHouse).toHaveAttribute('data-token-house-active', 'false');
  const before = await englishHouse.innerHTML();
  await page.clock.runFor(5_000);
  expect(await englishHouse.innerHTML()).toBe(before);
  await expect(
    page.locator('.mode-switch').getByRole('button', { name: 'Demo', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Enable motion', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('usdt-house-english-reduced-motion.png'),
    fullPage: true,
  });
});

test('a new recognized pending passenger lights the house and shares the pause clock', async ({
  page,
}, testInfo) => {
  let added = false;
  let delivered = false;
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const data = snapshot(chain, 'observed');
    if (chain === 'ethereum') {
      data.transactions = added ? [native, transfer] : [native];
      delivered ||= added;
    }
    await route.fulfill({ json: snapshotSchema.parse(data) });
  });
  await page.goto('/');
  await expect(house(page)).toHaveAttribute('data-token-house-active', 'false');
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  added = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => delivered).toBe(true);
  await expect(house(page)).toHaveAttribute('data-token-house-active', 'true');
  const door = house(page).locator('[data-token-house-door]');
  await expect(door).toHaveAttribute('data-token-house-door-progress', '0');
  // Commit the admission's pending Canvas frame while the animation clock is paused.
  await page.clock.runFor(120);
  const pausedOrigin = { door: await door.innerHTML(), bitmap: await canvasHash(page) };
  await page.clock.runFor(500);
  expect({ door: await door.innerHTML(), bitmap: await canvasHash(page) }).toEqual(pausedOrigin);
  await page.screenshot({
    path: testInfo.outputPath('usdt-house-paused-arrival.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  for (
    let step = 0;
    step < 8 && Number(await door.getAttribute('data-token-house-door-progress')) === 0;
    step += 1
  )
    await page.clock.runFor(60);
  expect(Number(await door.getAttribute('data-token-house-door-progress'))).toBeGreaterThan(0);
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await page.clock.runFor(120);
  const pausedPassage = { door: await door.innerHTML(), bitmap: await canvasHash(page) };
  await page.clock.runFor(500);
  expect({ door: await door.innerHTML(), bitmap: await canvasHash(page) }).toEqual(pausedPassage);
  await expect(house(page)).toHaveAttribute('data-token-house-active', 'true');
  await page.screenshot({
    path: testInfo.outputPath('usdt-house-paused-passage.png'),
    fullPage: true,
  });
});
