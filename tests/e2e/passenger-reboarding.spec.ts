import { expect, test, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page) => page.locator('section.chain-pane[data-chain="bitcoin"]');
const firstWagon = (page: Page) => pane(page).locator('.street-first-wagon');
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });

function transaction(index: number, feeRate: number): Tx {
  return {
    id: index.toString(16).padStart(64, '0'),
    chain: 'bitcoin',
    status: 'pending',
    feeRate,
    size: 200,
    kind: 'transfer',
    value: '0.01 BTC',
  };
}

function block(chain: ChainId, next = false): Block {
  return {
    hash: `${chain === 'ethereum' ? '0x' : ''}${next ? 'b'.repeat(64) : 'a'.repeat(64)}`,
    height: (chain === 'bitcoin' ? 900_000 : 23_000_000) + Number(next),
    timestamp: OBSERVED_AT / 1_000 - 12 + Number(next) * 12,
    txCount: 100,
    used: chain === 'bitcoin' ? 500_000 : 30_000_000,
    capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
  };
}

/** Only the second traveler is proved included; the missing first remains uncertain. */
function liveSnapshot(chain: ChainId, stage: number, retained: Tx, included: Tx): Snapshot {
  const latest = block(chain, chain === 'bitcoin' && stage >= 2);
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour le réembarquement historique',
    observedAt: OBSERVED_AT + stage * 3_000,
    coverage: `Réembarquement contrôlé étape ${stage}. Échantillon partiel ; seul un identifiant exact prouve une inclusion.`,
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions:
      chain === 'ethereum'
        ? []
        : stage === 0
          ? [retained, included]
          : stage === 1
            ? [included]
            : [{ ...included, status: 'confirmed', blockHash: latest.hash }],
    blocks: [latest],
    inclusions:
      chain === 'bitcoin' && stage >= 2 ? [{ block: latest, transactionIds: [included.id] }] : [],
  });
}

async function openHistoricalTraveler(page: Page, tx: Tx, phase: string) {
  await page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' }).focus();
  await page.keyboard.press('Enter');
  const selector = browser(page).getByRole('combobox');
  await expect(selector).toBeFocused();
  await expect(selector.locator(`option[value="${tx.id}"]`)).toHaveCount(1);
  await expect(selector.locator(`option[value="${tx.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await selector.selectOption(tx.id);
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'dernière observation conservée',
  );
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(phase);
  return selector;
}

async function closeBrowser(page: Page) {
  await browser(page).getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toHaveCount(0);
}

function stateDetail(page: Page, label: string) {
  return page
    .getByTestId('info-panel')
    .locator('.info-detail')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');
}

test('a previously boarded historical Bitcoin traveler reboards after another verified cohort departs', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: OBSERVED_AT });
  const retained = transaction(1, 10);
  const included = transaction(2, 20);
  let stage = 0;
  const fetched = new Set<number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'bitcoin' ? 'bitcoin' : 'ethereum';
    if (chain === 'bitcoin') fetched.add(stage);
    await route.fulfill({ json: liveSnapshot(chain, stage, retained, included) });
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');

  // Settle the initial boarding, then exercise an actual exit and reboarding.
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '2');
  const speed = page.getByRole('combobox', { name: 'Vitesse d’animation' });
  await speed.selectOption('5');
  await expect(speed).toHaveValue('5');
  await speed.selectOption('10');
  await expect(speed).toHaveValue('10');
  await speed.selectOption('0.5');
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();

  const refresh = async (nextStage: number) => {
    stage = nextStage;
    for (let attempt = 0; attempt < 20 && !fetched.has(stage); attempt += 1) {
      await page.clock.runFor(200);
    }
    expect(fetched.has(stage)).toBe(true);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      new RegExp(`Réembarquement contrôlé étape ${stage}\\.`),
    );
  };

  await refresh(1);
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '2');
  await openHistoricalTraveler(page, retained, 'à bord du wagon illustratif');
  await closeBrowser(page);

  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page)).toHaveAttribute('data-preparation-progress', /^[0-9.]+$/);
  await page.clock.runFor(2_500);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await openHistoricalTraveler(page, retained, 'retour en file illustré');
  await closeBrowser(page);

  // At 0.5×, the ordinary three-second API poll occurs during the returning walk.
  // Bitcoin is still preparing: the refresh must preserve the right to reboard later.
  await refresh(3);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await openHistoricalTraveler(page, retained, 'retour en file illustré');
  await closeBrowser(page);
  // Three animation seconds take six wall-clock seconds at 0.5×.
  await page.clock.runFor(3_500);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  // The departing count is exactly the proved cohort, excluding the historical rider.
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '1');
  await page.clock.runFor(12_500);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  const badge = firstWagon(page).getByRole('img');
  await expect(badge).toHaveAttribute('data-transaction-count', '1');
  await expect(badge).toHaveAttribute('data-resource-used', '200');
  await expect(badge).toHaveAttribute('aria-label', /conservée.*hors de l’échantillon actuel/);
  await expect(badge).toHaveAttribute(
    'aria-label',
    /présence actuelle dans le mempool est inconnue/,
  );
  await expect(pane(page).locator('[data-waiting-archive-count]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-historical-reboarded.png'),
    fullPage: true,
  });

  const selector = await openHistoricalTraveler(page, retained, 'à bord du wagon illustratif');
  await expect(selector.locator('option')).toHaveCount(1);
  await expect(selector.locator(`option[value="${included.id}"]`)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(browser(page).getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
  await page.keyboard.press('Enter');
  await closeBrowser(page);
  const panel = page.getByTestId('info-panel');
  await expect(panel).toHaveAttribute('data-selection-historical', 'true');
  await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', retained.id);
  await expect(stateDetail(page, 'État des derniers détails reçus')).toHaveText(
    'En attente lors de cette observation',
  );
  await expect(stateDetail(page, 'Dernière observation').locator('time')).toHaveAttribute(
    'datetime',
    new Date(OBSERVED_AT).toISOString(),
  );
  await expect(panel).toContainText('Présence actuelle dans le mempool inconnue.');
  await expect(panel).toContainText(
    'La position de ce voyageur ne prouve pas sa présence actuelle dans le mempool.',
  );
  await page.clock.runFor(400);
  await expect(panel.locator('.info-selected')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-historical-reboarded-details.png'),
    fullPage: true,
  });
});
