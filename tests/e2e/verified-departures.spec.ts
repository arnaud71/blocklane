import { expect, test, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page) => page.locator('section.chain-pane[data-chain="ethereum"]');
const firstWagon = (page: Page) => pane(page).locator('.street-first-wagon');
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Ethereum' });

function transaction(index: number, feeRate: number): Tx {
  return {
    id: `0x${index.toString(16).padStart(64, '0')}`,
    chain: 'ethereum',
    status: 'pending',
    feeRate,
    size: 21_000,
    kind: 'transfer',
    value: '0.01 ETH',
  };
}

function block(chain: ChainId, offset = 0): Block {
  return {
    hash: `${chain === 'ethereum' ? '0x' : ''}${(100 + offset).toString(16).padStart(64, '0')}`,
    height: (chain === 'ethereum' ? 23_000_000 : 900_000) + offset,
    timestamp: OBSERVED_AT / 1_000 - 24 + offset * 12,
    txCount: 100,
    used: chain === 'ethereum' ? 30_000_000 : 500_000,
    capacity: chain === 'ethereum' ? 60_000_000 : 1_000_000,
  };
}

/** Exact inclusion evidence is independent of a partial pending sample and the displayed tip. */
function liveSnapshot(
  chain: ChainId,
  transactions: Tx[],
  stage: number,
  includedId: string,
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour les départs vérifiés',
    observedAt: OBSERVED_AT + stage * 3_000,
    coverage: `Scénario vérifié étape ${stage}. Échantillon partiel ; une absence seule ne prouve aucune inclusion.`,
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: 1,
    feeUnit: chain === 'ethereum' ? 'Gwei' : 'sat/vB',
    transactions,
    blocks: [block(chain, chain === 'ethereum' && stage >= 2 ? 2 : 0)],
    inclusions:
      chain === 'ethereum' && stage >= 2
        ? [{ block: block(chain, 1), transactionIds: [includedId] }]
        : [],
  });
}

async function setupScenario(page: Page, reducedMotion: boolean) {
  // Both red travelers are initially ineligible under the observed base fee.
  // Only one later receives a real inclusion proof; its neighbor remains unknown.
  const included = transaction(1, 0.5);
  const unproved = transaction(2, 0.4);
  const cheap = Array.from({ length: 10 }, (_, index) => transaction(index + 3, 0.01));
  let stage = 0;
  const fetched = new Set<number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    if (chain === 'ethereum') fetched.add(stage);
    await route.fulfill({
      json: liveSnapshot(
        chain,
        chain === 'bitcoin'
          ? []
          : stage === 0
            ? [included, unproved, ...cheap]
            : stage >= 3
              ? [included, ...cheap]
              : cheap,
        stage,
        included.id,
      ),
    });
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  if (reducedMotion) {
    await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Activer les mouvements', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  } else {
    await page.clock.runFor(2_500);
  }
  const mean = Number(
    await pane(page).locator('.street-scene-svg').getAttribute('data-average-fee-rate'),
  );
  expect(included.feeRate).toBeGreaterThan(mean * 2);
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '0');

  const refresh = async (nextStage: number) => {
    stage = nextStage;
    // Step only until the next mocked poll so the normal test can observe preparation.
    for (let attempt = 0; attempt < 20 && !fetched.has(stage); attempt += 1) {
      await page.clock.runFor(200);
    }
    expect(fetched.has(stage)).toBe(true);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      new RegExp(`Scénario vérifié étape ${stage}\\.`),
    );
  };
  return { included, unproved, cheap, refresh };
}

async function openBrowser(page: Page) {
  await page.getByRole('button', { name: 'Parcourir les transactions Ethereum' }).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page).getByRole('combobox')).toBeFocused();
  return browser(page).getByRole('combobox');
}

async function assertHistoricalWaiters(page: Page, included: Tx, unproved: Tx) {
  const selector = await openBrowser(page);
  for (const tx of [included, unproved]) {
    const option = selector.locator(`option[value="${tx.id}"]`);
    await expect(option).toHaveCount(1);
    await expect(option).toContainText('dernière observation · statut actuel inconnu');
  }
  await selector.selectOption(included.id);
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'dernière observation conservée',
  );
  await page.keyboard.press('Escape');
  await expect(browser(page)).toHaveCount(0);
}

async function assertOnlyUnprovedHistoryRemains(
  page: Page,
  included: Tx,
  unproved: Tx,
  cheap: Tx[],
) {
  const selector = await openBrowser(page);
  await expect(selector.locator(`option[value="${included.id}"]`)).toHaveCount(0);
  await expect(selector.locator(`option[value="${unproved.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await expect(selector.locator('option')).toHaveCount(cheap.length + 1);
  await selector.selectOption(unproved.id);
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'statut actuel inconnu',
  );
  await expect(browser(page).getByRole('button', { name: 'Afficher les détails' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(browser(page)).toHaveCount(0);
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '0');
  await expect(pane(page).locator('[data-projection="later"]').getByRole('img')).toHaveAttribute(
    'data-transaction-count',
    '0',
  );
  await expect(pane(page).locator('[data-waiting-archive-count]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: OBSERVED_AT });
});

test('a late exact Ethereum inclusion boards its historical traveler before departure and prevents replay', async ({
  page,
}, testInfo) => {
  const { included, unproved, cheap, refresh } = await setupScenario(page, false);
  await refresh(1);
  await assertHistoricalWaiters(page, included, unproved);

  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page)).toHaveAttribute('data-preparation-progress', /^[0-9.]+$/);
  await expect(firstWagon(page)).toContainText('INCLUSIONS RETROUVÉES');
  await page.clock.runFor(1_650);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '1');
  await page.clock.runFor(2_500);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await page.screenshot({
    path: testInfo.outputPath('ethereum-verified-departure.png'),
    fullPage: true,
  });
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);

  // A lagging cached pool response can still carry the old pending row.
  // Consumed exact evidence must win while its canonical journal remains valid.
  await refresh(3);
  await page.clock.runFor(3_100);
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);
  await refresh(4);
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);
});

test('reduced motion consumes a late exact Ethereum inclusion without parking its traveler on the quay', async ({
  page,
}, testInfo) => {
  const { included, unproved, cheap, refresh } = await setupScenario(page, true);
  await refresh(1);
  await assertHistoricalWaiters(page, included, unproved);
  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(pane(page).locator('[data-preparation-progress]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('ethereum-reduced-verified-departure.png'),
    fullPage: true,
  });
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);

  await refresh(3);
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);
  await refresh(4);
  await assertOnlyUnprovedHistoryRemains(page, included, unproved, cheap);
});
