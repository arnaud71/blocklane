import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';

const chains = ['bitcoin', 'ethereum'] as const;
const waitingCount = 20;
const pane = (page: Page, chain: ChainId) =>
  page.locator(`section.chain-pane[data-chain="${chain}"]`);
const scene = (page: Page, chain: ChainId) => pane(page, chain).locator('.street-scene-svg');

function transaction(chain: ChainId, index: number): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${(index + 1).toString(16).padStart(64, '0')}`,
    chain,
    // Ethereum transactions remain on the quay below the observed base fee.
    feeRate: chain === 'ethereum' ? 1 : 20,
    size: chain === 'ethereum' ? 21_000 : 200,
    status: 'pending',
    kind: 'transfer',
    value: chain === 'ethereum' ? '0.01 ETH' : '0.01 BTC',
  };
}

/** A partial live observation with no demo data or fabricated inclusion evidence. */
function liveSnapshot(chain: ChainId, observedAt: number): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour la disposition de la file',
    observedAt,
    coverage: 'Échantillon partiel contrôlé de 20 transactions en attente dans la source.',
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: chain === 'ethereum' ? 10 : 1,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions: Array.from({ length: waitingCount }, (_, index) => transaction(chain, index)),
    blocks: [
      {
        height: chain === 'ethereum' ? 23_000_000 : 900_000,
        hash: `${chain === 'ethereum' ? '0x' : ''}${'a'.repeat(64)}`,
        timestamp: Math.floor(observedAt / 1_000),
        txCount: 100,
        used: chain === 'ethereum' ? 30_000_000 : 500_000,
        capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
      },
    ],
  });
}

async function settleQueue(page: Page) {
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  }
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Activer les mouvements', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function grid(page: Page, chain: ChainId) {
  const element = scene(page, chain);
  await expect(element).toHaveAttribute('data-queue-columns', /^[1-9]\d*$/);
  await expect(element).toHaveAttribute('data-queue-rows', /^[1-9]\d*$/);
  await expect(element).toHaveAttribute('data-queue-capacity', /^[1-9]\d*$/);
  return {
    columns: Number(await element.getAttribute('data-queue-columns')),
    rows: Number(await element.getAttribute('data-queue-rows')),
    capacity: Number(await element.getAttribute('data-queue-capacity')),
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const observedAt = Date.now();
  const snapshots = {
    bitcoin: liveSnapshot('bitcoin', observedAt),
    ethereum: liveSnapshot('ethereum', observedAt),
  };
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    await route.fulfill({ json: snapshots[chain] });
  });
});

test('both queue grids use wider desktop space and contract on mobile while paused', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto('/');
  await settleQueue(page);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre l’animation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const initial = await Promise.all(chains.map((chain) => grid(page, chain)));

  await page.setViewportSize({ width: 1_920, height: 900 });
  for (const [index, chain] of chains.entries()) {
    await expect
      .poll(async () => (await grid(page, chain)).columns)
      .toBeGreaterThan(initial[index]!.columns);
    await expect
      .poll(async () => (await grid(page, chain)).capacity)
      .toBeGreaterThan(initial[index]!.capacity);
  }
  const desktop = await Promise.all(chains.map((chain) => grid(page, chain)));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('queue-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, chain] of chains.entries()) {
    await expect
      .poll(async () => (await grid(page, chain)).columns)
      .toBeLessThan(desktop[index]!.columns);
    await expect
      .poll(async () => (await grid(page, chain)).capacity)
      .toBeLessThan(desktop[index]!.capacity);
    await expect(pane(page, chain).locator('.street-scene')).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Reprendre l’animation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activer les mouvements' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('queue-mobile.png'), fullPage: true });
});

test('current low-fee waiters stay accessible and details open by keyboard with usable animation controls', async ({
  page,
}) => {
  await page.goto('/');
  await settleQueue(page);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre l’animation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await expect(page.getByRole('button', { name: 'Mettre l’animation en pause' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  const browse = page.getByRole('button', { name: 'Parcourir les transactions Ethereum' });
  await browse.focus();
  await page.keyboard.press('Enter');
  const browser = page.getByRole('dialog', { name: 'Transactions observées Ethereum' });
  const selector = browser.getByRole('combobox');
  await expect(selector).toBeFocused();
  await expect(selector).toBeEnabled();
  await expect(selector.locator('option')).toHaveCount(waitingCount);
  // The native picker uses different keys on desktop and mobile; selectOption
  // exercises that public control without assuming an emulated platform's picker.
  const selected = transaction('ethereum', waitingCount - 1);
  await selector.selectOption(selected.id);
  await expect(selector).toHaveValue(selected.id);
  await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
    'en attente dans la source. sur le quai',
  );
  await page.keyboard.press('Tab');
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('info-panel')).toHaveAttribute('data-page', 'transaction');
  await expect(page.getByTestId('info-panel').locator('.info-transaction-hash')).toHaveAttribute(
    'title',
    selected.id,
  );
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await expect(browse).toBeFocused();

  await page
    .getByRole('button', { name: 'Masquer le panneau d’informations', exact: true })
    .click();
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Réduire les mouvements', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expectNoHorizontalOverflow(page);
});
