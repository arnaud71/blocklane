import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot, type Tx } from '../../shared/model';
import { historicalQueuePosition, queuePosition } from '../../src/lib/streetGeometry';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page, chain: ChainId) =>
  page.locator(`section.chain-pane[data-chain="${chain}"]`);
const wagon = (page: Page, chain: ChainId) =>
  pane(page, chain).locator('[data-projection="next"]').getByRole('img');

function transaction(chain: ChainId, index = 1, feeRate = 20): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`,
    chain,
    status: 'pending',
    feeRate,
    size: chain === 'ethereum' ? 21_000 : 200,
    kind: 'transfer',
    value: chain === 'ethereum' ? '0.01 ETH' : '0.01 BTC',
  };
}

/** Partial provider fixtures never infer an inclusion from a disappeared identifier. */
function liveSnapshot(
  chain: ChainId,
  transactions: Tx[],
  observedAt: number,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour la sélection historique',
    observedAt,
    coverage: `Échantillon partiel contrôlé (${transactions.length} transactions). Aucune suppression attestée.`,
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: 1,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions,
    blocks: [
      {
        hash: `${chain === 'ethereum' ? '0x' : ''}${'a'.repeat(64)}`,
        height: chain === 'ethereum' ? 23_000_000 : 900_000,
        timestamp: OBSERVED_AT / 1_000,
        txCount: 100,
        used: chain === 'ethereum' ? 30_000_000 : 500_000,
        capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
      },
    ],
    ...overrides,
  });
}

async function routeSnapshots(page: Page, current: (chain: ChainId) => Snapshot) {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    await route.fulfill({
      json: current(url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin'),
    });
  });
}

async function settle(page: Page) {
  for (const chain of ['bitcoin', 'ethereum'] as const) {
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

async function clickFirstQueuePassenger(page: Page, chain: ChainId, historical = false) {
  await hideInformationPanel(page);
  const svg = pane(page, chain).locator('.street-scene-svg');
  const columns = Number(await svg.getAttribute('data-queue-columns'));
  const rows = Number(await svg.getAttribute('data-queue-rows'));
  const position = (historical ? historicalQueuePosition : queuePosition)(0, {
    columns,
    rows,
    capacity: columns * rows,
  });
  const point = await svg.evaluate((element, canonical) => {
    const root = element as SVGSVGElement;
    const layout = root.viewBox.baseVal;
    const projectScale = (layout.x + layout.width - 298) / (460 - 298);
    const group = root.querySelector(':scope > g') as SVGGElement;
    const matrix = group.getScreenCTM();
    if (!matrix) throw new Error('Projection de la scène indisponible');
    const point = root.createSVGPoint();
    point.x = 298 + (canonical.x - 298) * projectScale;
    point.y = canonical.y - 15;
    const screen = point.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, position);
  await page.mouse.click(point.x, point.y);
}

async function hideInformationPanel(page: Page) {
  const hide = page.getByRole('button', {
    name: 'Masquer le panneau d’informations',
    exact: true,
  });
  if (await hide.count()) await hide.click();
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
}

async function closeBrowserByKeyboard(page: Page, chain: ChainId) {
  // The information panel can cover the transaction browser on a narrow screen.
  // Its close control remains keyboard accessible without a forced pointer click.
  await page
    .getByRole('dialog', {
      name: `Transactions observées ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
    })
    .getByRole('button', { name: 'Fermer les transactions' })
    .focus();
  await page.keyboard.press('Enter');
}

function stateDetail(page: Page, label: string) {
  return page
    .getByTestId('info-panel')
    .locator('.info-detail')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: OBSERVED_AT });
});

test('a red Ethereum waiter stays clickable after leaving the sample and reboards only on eligible reobservation', async ({
  page,
}, testInfo) => {
  const target = transaction('ethereum', 1, 0.5);
  const cheaper = Array.from({ length: 10 }, (_, index) =>
    transaction('ethereum', index + 2, 0.01),
  );
  let stage = 0;
  const fetched = new Set<number>();
  await routeSnapshots(page, (chain) => {
    if (chain === 'bitcoin') return liveSnapshot(chain, [], OBSERVED_AT + stage * 3_000);
    fetched.add(stage);
    return liveSnapshot(
      chain,
      stage === 0
        ? [target, ...cheaper]
        : stage < 3
          ? cheaper
          : [{ ...target, feeRate: 2 }, ...cheaper],
      OBSERVED_AT + stage * 3_000,
    );
  });
  await page.goto('/');
  await settle(page);
  await expect(wagon(page, 'ethereum')).toHaveAttribute('data-transaction-count', '0');
  const mean = Number(
    await pane(page, 'ethereum').locator('.street-scene-svg').getAttribute('data-average-fee-rate'),
  );
  expect(target.feeRate).toBeGreaterThan(mean * 2);
  await clickFirstQueuePassenger(page, 'ethereum');
  const panel = page.getByTestId('info-panel');
  await expect(panel).toHaveAttribute('data-selection-historical', 'false');
  await expect(stateDetail(page, 'État des détails reçus')).toHaveText('En attente');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', target.id);
  await page.getByRole('button', { name: 'Libérer le panneau d’informations' }).click();
  await hideInformationPanel(page);

  const browse = page.getByRole('button', { name: 'Parcourir les transactions Ethereum' });
  await browse.click();
  const browser = page.getByRole('dialog', { name: 'Transactions observées Ethereum' });
  await browser.getByRole('combobox').selectOption(target.id);
  await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
    'Frais inférieurs à la base fee Ethereum de référence',
  );
  await closeBrowserByKeyboard(page, 'ethereum');

  stage = 1;
  await page.clock.runFor(3_100);
  await expect.poll(() => fetched.has(1)).toBe(true);
  await expect(pane(page, 'ethereum').locator('.chain-coverage')).toContainText(
    '10 en attente échantillonnées',
  );
  await clickFirstQueuePassenger(page, 'ethereum', true);
  await expect(panel).toHaveAttribute('data-selection-historical', 'true');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', target.id);
  await expect(stateDetail(page, 'État des derniers détails reçus')).toHaveText(
    'En attente lors de cette observation',
  );
  await expect(panel).toContainText('Présence actuelle dans le mempool inconnue.');
  await expect(
    panel.getByText('Présence actuelle dans le mempool inconnue.', { exact: true }),
  ).toBeInViewport();
  await expect(stateDetail(page, 'Dernière observation').locator('time')).toHaveAttribute(
    'datetime',
    new Date(OBSERVED_AT).toISOString(),
  );
  await page.screenshot({
    path: testInfo.outputPath('ethereum-historical-selection.png'),
    fullPage: true,
  });

  await browse.focus();
  await page.keyboard.press('Enter');
  const selector = browser.getByRole('combobox');
  await expect(selector).toBeFocused();
  await selector.selectOption(target.id);
  await expect(selector.locator(`option[value="${target.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
    'frais de la dernière observation',
  );
  await page.keyboard.press('Tab');
  await expect(browser.getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('data-selection-historical', 'true');
  await closeBrowserByKeyboard(page, 'ethereum');

  stage = 2;
  await page.clock.runFor(3_100);
  await expect.poll(() => fetched.has(2)).toBe(true);
  await expect(panel).toHaveAttribute('data-selection-historical', 'true');
  await expect(stateDetail(page, 'Dernière observation').locator('time')).toHaveAttribute(
    'datetime',
    new Date(OBSERVED_AT).toISOString(),
  );
  await expect(wagon(page, 'ethereum')).toHaveAttribute('data-transaction-count', '0');

  stage = 3;
  await page.clock.runFor(3_100);
  await expect.poll(() => fetched.has(3)).toBe(true);
  await expect(panel).toHaveAttribute('data-selection-historical', 'false');
  await expect(stateDetail(page, 'État des détails reçus')).toHaveText('En attente');
  await expect(wagon(page, 'ethereum')).toHaveAttribute('data-transaction-count', '1');
  await expect(panel).not.toContainText('Présence actuelle dans le mempool inconnue.');
});

test('a retained Bitcoin selection remains historical until an exact inclusion journal proves confirmation', async ({
  page,
}) => {
  const target = transaction('bitcoin');
  let stage = 0;
  const fetched = new Set<number>();
  await routeSnapshots(page, (chain) => {
    const source = liveSnapshot(
      chain,
      stage === 0 && chain === 'bitcoin' ? [target] : [],
      OBSERVED_AT + stage * 3_000,
    );
    if (chain !== 'bitcoin') return source;
    fetched.add(stage);
    if (stage < 2) return source;
    const block = {
      ...source.blocks[0]!,
      hash: 'b'.repeat(64),
      height: source.blocks[0]!.height + 1,
      timestamp: (OBSERVED_AT + 6_000) / 1_000,
    };
    return snapshotSchema.parse({
      ...source,
      blocks: [block],
      inclusions: [{ block, transactionIds: [target.id] }],
    });
  });
  await page.goto('/');
  await settle(page);
  await expect(wagon(page, 'bitcoin')).toHaveAttribute('data-transaction-count', '1');
  stage = 1;
  await page.clock.runFor(3_100);
  await expect.poll(() => fetched.has(1)).toBe(true);
  await page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' }).click();
  const browser = page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });
  await browser.getByRole('combobox').selectOption(target.id);
  await browser.getByRole('button', { name: 'Afficher les détails' }).click();
  await closeBrowserByKeyboard(page, 'bitcoin');
  const panel = page.getByTestId('info-panel');
  await expect(panel).toHaveAttribute('data-selection-historical', 'true');
  await expect(stateDetail(page, 'État des derniers détails reçus')).toHaveText(
    'En attente lors de cette observation',
  );
  stage = 2;
  await page.clock.runFor(3_100);
  await expect.poll(() => fetched.has(2)).toBe(true);
  await expect(panel).toHaveAttribute('data-selection-historical', 'false');
  await expect(panel).toHaveAttribute('data-selection-inclusion-only', 'true');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', target.id);
  await expect(stateDetail(page, 'État des détails reçus')).toHaveText(
    'Incluse dans un bloc observé',
  );
  await expect(panel).not.toContainText('Présence actuelle dans le mempool inconnue.');
  await expect(panel).toContainText(
    'Les frais, la taille et la valeur proviennent de la dernière observation conservée',
  );
});
