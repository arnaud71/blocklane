import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';
import { ACTIVITY_HOUSES, HOUSE_IDS, type HouseId } from '../../shared/activityHouses';

const NOW = Date.parse('2026-11-05T14:00:00Z');
const SOURCE = 'Controlled activity house source';
const hash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const transaction = (index: number, overrides: Partial<Tx> = {}): Tx => ({
  id: hash(index),
  chain: 'ethereum',
  status: 'pending',
  feeRate: 0,
  size: 21_000,
  kind: 'contract',
  value: '0 ETH',
  ...overrides,
});
const token = (tokenId: 'usdt' | 'usdc', amount = '1234567') => ({
  tokenId,
  operation: 'transfer' as const,
  evidence: 'call' as const,
  amount,
});
const baseTransactions = [
  transaction(1, { kind: 'transfer', value: '1 ETH' }),
  transaction(2, { tokens: [token('usdc', '1234567890123456789012345')] }),
  transaction(3, {
    // Controlled contract-valid overlap: category views must never clone this identity.
    tokens: [token('usdt'), token('usdc')],
    protocols: [{ protocolId: 'uniswap', operation: 'execute', evidence: 'call' }],
  }),
  transaction(4, { protocols: [{ protocolId: 'aave', operation: 'supply', evidence: 'call' }] }),
  transaction(5, { tokens: [token('usdt')] }),
];

type State = 'observed' | 'zero' | 'unavailable' | 'stale';
function snapshot(
  chain: ChainId,
  state: State = 'observed',
  demo = false,
  added = false,
): Snapshot {
  const block = {
    hash: chain === 'ethereum' ? hash(1000) : 'b'.repeat(64),
    height: 100,
    timestamp: NOW / 1000 - 12,
    txCount: 200,
    used: chain === 'ethereum' ? 1_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
  };
  let transactions = chain === 'ethereum' ? baseTransactions.map((tx) => ({ ...tx })) : [];
  if (state === 'zero') transactions = transactions.filter((tx) => tx.status !== 'confirmed');
  if (added)
    transactions.push(
      transaction(6, {
        protocols: [{ protocolId: 'aave', operation: 'borrow', evidence: 'call' }],
      }),
    );
  if (demo)
    transactions = transactions.map((tx) => ({
      ...tx,
      tokens: tx.tokens?.map((activity) => ({ ...activity, evidence: 'demo' as const })),
      protocols: tx.protocols?.map((activity) => ({ ...activity, evidence: 'demo' as const })),
    }));
  const observedAt = state === 'stale' ? NOW - 45_000 : NOW;
  // Log timestamps follow the dated chain envelope, not a later header or clock read.
  transactions = transactions.map((tx) => ({
    ...tx,
    tokens: tx.tokens?.map((activity) =>
      activity.observedAt === undefined ? activity : { ...activity, observedAt },
    ),
  }));
  return snapshotSchema.parse({
    chain,
    mode: demo ? 'demo' : 'live',
    status: state === 'stale' ? 'stale' : 'ok',
    source: SOURCE,
    observedAt: NOW,
    coverage: 'Controlled limited sample with separate complete-block reports.',
    pendingCount: chain === 'bitcoin' ? 0 : null,
    feeRate: 0,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    blocks: [block],
    transactions,
    ...(chain === 'ethereum'
      ? {
          tokenTransfers:
            state === 'unavailable'
              ? null
              : (['usdt', 'usdc'] as const).map((tokenId) => ({
                  tokenId,
                  blockHash: block.hash,
                  blockHeight: block.height,
                  source: SOURCE,
                  observedAt,
                  method: demo ? 'simulation' : 'eth_getLogs',
                  transactionCount: state === 'zero' ? 0 : 1,
                  transferCount: state === 'zero' ? 0 : tokenId === 'usdc' ? 2 : 1,
                  amount: state === 'zero' ? '0' : '1234567',
                })),
          protocolCalls:
            state === 'unavailable'
              ? null
              : (['uniswap', 'aave'] as const).map((protocolId) => ({
                  protocolId,
                  blockHash: block.hash,
                  blockHeight: block.height,
                  source: SOURCE,
                  observedAt,
                  method: demo ? 'simulation' : 'block-calls',
                  transactionCount: state === 'zero' || protocolId === 'aave' ? 0 : 1,
                })),
        }
      : {}),
  });
}
const house = (page: Page, id: HouseId) =>
  page.getByRole('button', {
    name: `Maison ${ACTIVITY_HOUSES[id].label} : parcourir les transactions`,
    exact: true,
  });
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Ethereum' });
const selectTx = (page: Page) =>
  browser(page).getByRole('combobox', { name: 'Transaction représentée dans la scène' });
async function setup(page: Page, state: State = 'observed') {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: snapshot(
        url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin',
        state,
        url.searchParams.get('mode') === 'demo',
      ),
    });
  });
  await page.goto('/');
  await expect(house(page, 'aave')).toBeVisible();
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
}
async function openHouse(page: Page, id: HouseId) {
  await house(page, id).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toBeFocused();
}
async function canvasHash(page: Page) {
  return page
    .locator('.chain-pane[data-chain="ethereum"] canvas.passenger-canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let result = 2166136261;
      for (const pixel of pixels) result = Math.imul(result ^ pixel, 16777619);
      return result >>> 0;
    });
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('four houses share existing travelers, keep overlapping categories and restore each keyboard trigger', async ({
  page,
}, testInfo) => {
  await setup(page);
  await expect(page.locator('[data-token-house]')).toHaveCount(4);
  await expect(page.locator('.chain-pane[data-chain="bitcoin"] [data-token-house]')).toHaveCount(0);
  const bounds = await Promise.all(HOUSE_IDS.map((id) => house(page, id).boundingBox()));
  const ethereum = page.locator('.chain-pane[data-chain="ethereum"]');
  const entrance = await ethereum
    .locator('.street-scene text')
    .filter({ hasText: /^(ARRIVÉES|ENTRÉE)$/ })
    .boundingBox();
  expect(bounds[0]!.y).toBeGreaterThan(entrance!.y + entrance!.height);
  const network = await ethereum.locator('.network-remainder-body').boundingBox();
  for (const id of HOUSE_IDS) {
    const isToken = id === 'usdt' || id === 'usdc';
    await expect(house(page, id)).toHaveAccessibleDescription(isToken ? /^Token :/ : /^dApp :/);
    await expect(house(page, id).locator('.token-house-kind-label')).toHaveText(
      isToken ? 'TOKEN' : 'DAPP',
    );
    const body = await house(page, id).locator('.token-house-body').boundingBox();
    expect(body!.width).toBeLessThan(network!.width);
  }
  for (let index = 1; index < bounds.length; index++)
    expect(bounds[index]!.y).toBeGreaterThan(bounds[index - 1]!.y + bounds[index - 1]!.height);
  await page.screenshot({ path: testInfo.outputPath('four-houses-scene.png'), fullPage: true });
  const initial = await canvasHash(page);
  const expectedCounts = { usdt: 2, usdc: 2, uniswap: 1, aave: 1 };
  for (const id of HOUSE_IDS) {
    await openHouse(page, id);
    await expect(selectTx(page).locator('option')).toHaveCount(expectedCounts[id]);
    await expect(browser(page).getByRole('combobox', { name: 'Maison', exact: true })).toHaveValue(
      id,
    );
    const summary = browser(page).getByRole('region', {
      name: `Observations ${ACTIVITY_HOUSES[id].label}`,
    });
    await expect(summary).toContainText('Ces compteurs ne s’additionnent pas');
    await expect(summary.locator('.house-kind-pill')).toHaveText(
      id === 'usdt' || id === 'usdc' ? 'TOKEN' : 'dApp',
    );
    expect(await canvasHash(page)).not.toBe(initial);
    await page.keyboard.press('Escape');
    await expect(house(page, id)).toBeFocused();
    await expect.poll(() => canvasHash(page)).toBe(initial);
  }
  await openHouse(page, 'uniswap');
  await expect(selectTx(page).locator('option')).toHaveAttribute('value', hash(3));
  await expect(selectTx(page).locator('option')).toContainText('USDT');
  await expect(selectTx(page).locator('option')).toContainText('USDC');
  await expect(selectTx(page).locator('option')).toContainText('Uniswap');
  await browser(page).getByRole('combobox', { name: 'Maison', exact: true }).selectOption('usdc');
  await expect(selectTx(page).locator(`option[value="${hash(3)}"]`)).toHaveCount(1);
  await browser(page).getByRole('checkbox').uncheck();
  await expect(selectTx(page).locator('option')).toHaveCount(5);
  await expect.poll(() => canvasHash(page)).toBe(initial);
  await page.keyboard.press('Escape');
});

test('USDC amounts stay exact and protocol included calls never claim successful execution', async ({
  page,
}, testInfo) => {
  await setup(page);
  await openHouse(page, 'usdc');
  await selectTx(page).selectOption(hash(2));
  await expect(selectTx(page).locator(`option[value="${hash(2)}"]`)).toContainText(
    'USDC · Intention de transfert',
  );
  await browser(page).getByRole('button', { name: 'Afficher les détails' }).click();
  const details = page.getByTestId('info-panel');
  await expect(details).toContainText('USDC · Intention de transfert');
  await expect(details).toContainText(
    '1\u202f234\u202f567\u202f890\u202f123\u202f456\u202f789,012345 USDC',
  );
  await details.getByRole('button', { name: 'Fermer le panneau d’informations' }).click();
  await page.keyboard.press('Escape');
  await openHouse(page, 'uniswap');
  const summary = browser(page).getByRole('region', { name: 'Observations Uniswap' });
  await expect(summary).toContainText('Appels inclus aux contrats reconnus');
  await expect(summary).toContainText('y compris ceux qui ont échoué');
  await expect(summary).toContainText('résultat non vérifié');
  await expect(summary.locator('[data-token-block-amount]')).toHaveCount(0);
  await expect(summary.locator('[data-token-block-transactions]')).toHaveText('1');
  await selectTx(page).selectOption(hash(3));
  await browser(page).getByRole('button', { name: 'Afficher les détails' }).click();
  await expect(details).toContainText('Uniswap · Instructions au routeur');
  await expect(details).toContainText('résultat d’exécution non vérifié, même après inclusion');
  await details.getByRole('button', { name: 'Fermer le panneau d’informations' }).click();
  await page.keyboard.press('Escape');
  await openHouse(page, 'aave');
  await expect(browser(page)).toContainText('Aave · Demande de dépôt');
  await expect(
    browser(page)
      .getByRole('region', { name: 'Observations Aave' })
      .locator('[data-token-block-transactions]'),
  ).toHaveText('0');
  await page.screenshot({
    path: testInfo.outputPath('aave-counter-and-filter.png'),
    fullPage: true,
  });
});

for (const state of ['zero', 'unavailable', 'stale'] as const)
  test(`all category counters distinguish ${state} with dated provenance`, async ({ page }) => {
    await setup(page, state);
    for (const id of ['usdc', 'uniswap', 'aave'] as const) {
      await openHouse(page, id);
      const summary = browser(page).getByRole('region', {
        name: `Observations ${ACTIVITY_HOUSES[id].label}`,
      });
      await expect(summary).toHaveAttribute('data-token-report', state === 'zero' ? 'ok' : state);
      await expect(summary.locator('[data-token-block-transactions]')).toHaveText(
        state === 'unavailable' ? '—' : state === 'zero' || id === 'aave' ? '0' : '1',
      );
      if (state === 'unavailable') await expect(summary.locator('time')).toHaveCount(0);
      else
        await expect(summary.locator('time')).toHaveAttribute(
          'datetime',
          new Date(state === 'stale' ? NOW - 45000 : NOW).toISOString(),
        );
      await page.keyboard.press('Escape');
    }
  });

test('English simulation and reduced motion preserve house filters and quiet doors', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  for (const id of ['usdc', 'uniswap', 'aave'] as const) {
    const trigger = page.getByRole('button', {
      name: `Browse ${ACTIVITY_HOUSES[id].label} transactions on Ethereum`,
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Observed Ethereum transactions' });
    await expect(
      dialog.getByRole('region', { name: `${ACTIVITY_HOUSES[id].label} observations` }),
    ).toHaveAttribute('data-token-report', 'demo');
    await expect(dialog).toContainText('Explicit simulation');
    await expect(dialog).toContainText(
      id === 'usdc'
        ? 'Digital asset · token contract'
        : 'Decentralized application · protocol contracts',
    );
    await expect(dialog).toContainText('These counters must not be added together');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  const before = await page
    .locator('[data-token-house]')
    .evaluateAll((elements) => elements.map((element) => element.innerHTML));
  await page.clock.runFor(5000);
  expect(
    await page
      .locator('[data-token-house]')
      .evaluateAll((elements) => elements.map((element) => element.innerHTML)),
  ).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath('four-houses-english-reduced-motion.png'),
    fullPage: true,
  });
});

test('a new Aave observation uses only its own shared-clock house doorway and freezes on pause', async ({
  page,
}, testInfo) => {
  let added = false;
  let delivered = false;
  await page.route('**/api/snapshot?*', async (route) => {
    const chain =
      new URL(route.request().url()).searchParams.get('chain') === 'ethereum'
        ? 'ethereum'
        : 'bitcoin';
    const data = snapshot(chain, 'observed', false, chain === 'ethereum' && added);
    if (chain === 'ethereum' && added) delivered = true;
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(house(page, 'aave')).toHaveAttribute('data-token-house-active', 'false');
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  added = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => delivered).toBe(true);
  await expect(house(page, 'aave')).toHaveAttribute('data-token-house-active', 'true');
  for (const id of ['usdt', 'usdc', 'uniswap'] as const)
    await expect(house(page, id)).toHaveAttribute('data-token-house-active', 'false');
  await page.clock.runFor(120);
  const door = house(page, 'aave').locator('[data-token-house-door]');
  const baseline = { door: await door.innerHTML(), pixels: await canvasHash(page) };
  await page.clock.runFor(500);
  expect({ door: await door.innerHTML(), pixels: await canvasHash(page) }).toEqual(baseline);
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  for (
    let step = 0;
    step < 8 && Number(await door.getAttribute('data-token-house-door-progress')) === 0;
    step++
  )
    await page.clock.runFor(60);
  expect(Number(await door.getAttribute('data-token-house-door-progress'))).toBeGreaterThan(0);
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await page.clock.runFor(120);
  const passage = { door: await door.innerHTML(), pixels: await canvasHash(page) };
  await page.clock.runFor(500);
  expect({ door: await door.innerHTML(), pixels: await canvasHash(page) }).toEqual(passage);
  await page.screenshot({
    path: testInfo.outputPath('aave-house-paused-passage.png'),
    fullPage: true,
  });
});
