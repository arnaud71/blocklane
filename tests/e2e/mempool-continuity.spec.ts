import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';

const NOW = Date.parse('2026-10-15T18:00:00Z');
const hash = (n: number) => n.toString(16).padStart(64, '0');
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const dialog = (page: Page, chain: ChainId) =>
  page.getByRole('dialog', {
    name: `Transactions observées ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
  });
function transaction(chain: ChainId, n: number, feeRate = 20): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${hash(n)}`,
    chain,
    feeRate,
    size: chain === 'bitcoin' ? 200 : 21_000,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant contrôlé',
  };
}
function snapshot(
  chain: ChainId,
  observedAt: number,
  transactions: Tx[],
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée',
    observedAt,
    coverage: 'Cycle contrôlé du mempool observé.',
    pendingCount: 1000,
    feeRate: chain === 'bitcoin' ? 1 : 40,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [
      {
        hash: `${chain === 'ethereum' ? '0x' : ''}${hash(10000)}`,
        height: 100,
        timestamp: NOW / 1000,
        txCount: 100,
        used: chain === 'bitcoin' ? 500_000 : 0,
        capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
      },
    ],
    inclusions: [],
    ...overrides,
  });
}
async function inspect(page: Page, chain: ChainId, tx: Tx) {
  await page
    .getByRole('button', {
      name: `Parcourir les transactions ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
    })
    .focus();
  await page.keyboard.press('Enter');
  await dialog(page, chain).getByRole('combobox').selectOption(tx.id);
  return dialog(page, chain).locator('.passenger-canvas-browser-description');
}
async function close(page: Page, chain: ChainId) {
  await dialog(page, chain).getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
});

test('Bitcoin keeps inventory, candidate and historical absence distinct without a false departure', async ({
  page,
}, testInfo) => {
  const member = transaction('bitcoin', 1);
  const outsider = transaction('bitcoin', 2, 5);
  let stage = 0;
  let observedAt = NOW;
  let served = -1;
  await page.route('**/api/snapshot?*', async (route) => {
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    if (chain === 'ethereum') return route.fulfill({ json: snapshot(chain, observedAt, []) });
    served = stage;
    await route.fulfill({
      json: snapshot(chain, observedAt, stage === 0 ? [member, outsider] : [member], {
        sampling: {
          source: 'Nœud contrôlé',
          method: 'getrawmempool',
          observedAt,
          pendingCount: 1000,
          update: stage === 0 ? 'full' : 'incremental',
        },
        poolObservation: {
          source: 'Nœud contrôlé',
          method: 'getrawmempool',
          observedAt,
          presentTransactionIds: stage === 0 ? [member.id, outsider.id] : [member.id],
          queuedTransactionIds: [],
          absentTransactionIds: stage === 0 ? [] : [outsider.id],
        },
        blockTemplate: {
          source: 'Nœud contrôlé',
          observedAt,
          height: 101,
          previousBlockHash: hash(10000),
          transactionCount: 100,
          weight: 500_000,
          weightLimit: 4_000_000,
          selectedTransactionIds: [member.id],
        },
      }),
    });
  });
  await page.goto('/');
  await expect(pane(page, 'bitcoin').locator('canvas[data-renderer="canvas-2d"]')).toBeVisible();
  await page.clock.runFor(12_000);
  const stock = await inspect(page, 'bitcoin', outsider);
  await expect(stock).toContainText('stock initial observé');
  await expect(stock).toContainText('à bord du wagon illustratif');
  await close(page, 'bitcoin');
  stage = 1;
  observedAt = await page.evaluate(() => Date.now());
  for (let n = 0; n < 25 && served !== 1; n++) await page.clock.runFor(200);
  expect(served).toBe(1);
  await page.clock.runFor(12_000);
  const retained = await inspect(page, 'bitcoin', outsider);
  await expect(retained).toContainText('Absente du dernier relevé complet');
  await expect(retained).not.toContainText('incluse dans un bloc observé');
  await dialog(page, 'bitcoin').getByRole('button', { name: 'Afficher les détails' }).focus();
  await page.keyboard.press('Enter');
  await close(page, 'bitcoin');
  await expect(page.getByTestId('info-panel')).toHaveAttribute(
    'data-selection-pool-state',
    'absent',
  );
  await expect(page.getByTestId('info-panel')).toContainText(
    'Cela ne prouve ni une confirmation ni un remplacement',
  );
  await expect(pane(page, 'bitcoin').locator('.street-scene')).not.toHaveClass(/departing/);
  await page.clock.runFor(300);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-inventory-absence.png'),
    fullPage: true,
  });
});

test('Ethereum uses the next base fee and explains known nonce and queued waits', async ({
  page,
}, testInfo) => {
  const eth = (n: number, sender: string, nonce: string, cap: string, feeRate: number): Tx => ({
    ...transaction('ethereum', n, feeRate),
    ethereum: {
      from: `0x${sender.repeat(40)}`,
      nonce,
      maxFeePerGasWei: cap,
      maxPriorityFeePerGasWei: '2000000000',
    },
  });
  const admitted = eth(11, 'a', '0', '36000000000', 36);
  const prior = eth(12, 'b', '0', '30000000000', 30);
  const later = eth(13, 'b', '1', '90000000000', 37);
  const deferred = eth(14, 'c', '0', '60000000000', 37);
  let stage = 0;
  let observedAt = NOW;
  let served = -1;
  await page.route('**/api/snapshot?*', async (route) => {
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    if (chain === 'bitcoin') return route.fulfill({ json: snapshot(chain, observedAt, []) });
    served = stage;
    const current = stage === 0 ? [admitted, prior, later, deferred] : [admitted, prior, later];
    await route.fulfill({
      json: snapshot(chain, observedAt, current, {
        ethereumProjection: {
          parentBlockHash: `0x${hash(10000)}`,
          height: 101,
          baseFeePerGasWei: '35000000000',
          source: 'calculated',
          observedAt,
        },
        sampling: {
          method: 'txpool_content',
          source: 'Nœud ETH contrôlé',
          observedAt,
          pendingCount: current.length,
          queuedCount: stage === 0 ? 0 : 1,
        },
        poolObservation: {
          method: 'txpool_content',
          source: 'Nœud ETH contrôlé',
          observedAt,
          presentTransactionIds: current.map((tx) => tx.id),
          queuedTransactionIds: stage === 0 ? [] : [deferred.id],
          absentTransactionIds: [],
        },
      }),
    });
  });
  await page.goto('/');
  await page.clock.runFor(12_000);
  await expect(await inspect(page, 'ethereum', admitted)).toContainText(
    'à bord du wagon illustratif',
  );
  await close(page, 'ethereum');
  const nonceWait = await inspect(page, 'ethereum', later);
  await expect(nonceWait).toContainText('Le prédécesseur connu de nonce 0');
  await expect(nonceWait).toContainText('doit être admis avant cette transaction');
  await close(page, 'ethereum');
  await expect(await inspect(page, 'ethereum', prior)).toContainText('base fee Ethereum');
  await close(page, 'ethereum');
  stage = 1;
  observedAt = await page.evaluate(() => Date.now());
  for (let n = 0; n < 25 && served !== 1; n++) await page.clock.runFor(200);
  expect(served).toBe(1);
  await page.clock.runFor(12_000);
  await expect(await inspect(page, 'ethereum', deferred)).toContainText('différée (queued)');
  await dialog(page, 'ethereum').getByRole('button', { name: 'Afficher les détails' }).focus();
  await page.keyboard.press('Enter');
  await close(page, 'ethereum');
  await expect(page.getByTestId('info-panel')).toHaveAttribute(
    'data-selection-pool-state',
    'queued',
  );
  await page.clock.runFor(300);
  await page.screenshot({ path: testInfo.outputPath('ethereum-nonce-queued.png'), fullPage: true });
});
