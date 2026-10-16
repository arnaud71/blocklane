import { expect, test, type Page } from '@playwright/test';
import {
  CONFIRMED_SAMPLE_LIMIT,
  MAX_INDIVIDUAL_HISTORY,
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const chains = ['bitcoin', 'ethereum'] as const;
const observationTime = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page, chain: ChainId) =>
  page.locator(`section.chain-pane[data-chain="${chain}"]`);
const nextWagonCount = (page: Page, chain: ChainId) =>
  pane(page, chain).locator('[data-projection="next"]').getByRole('img');

function transaction(chain: ChainId): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${'1'.padStart(64, '0')}`,
    chain,
    feeRate: 20,
    size: chain === 'bitcoin' ? 200 : 21_000,
    status: 'pending',
    kind: 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
  };
}

/** Explicit live fixture: no synthetic inclusion evidence is inherited from demo data. */
function liveSnapshot(
  chain: ChainId,
  transactions: Tx[],
  observedAt: number,
  feeRate = 1,
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour la conservation des voyageurs',
    observedAt,
    coverage: `Échantillon partiel contrôlé (${transactions.length} transactions). Tarif de référence : ${feeRate} ${chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}. Une absence ne prouve aucun retrait du mempool.`,
    pendingCount:
      chain === 'bitcoin'
        ? Math.max(100, transactions.filter((tx) => tx.status === 'pending').length)
        : null,
    feeRate,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [
      {
        height: chain === 'bitcoin' ? 900_000 : 23_000_000,
        hash: `${chain === 'ethereum' ? '0x' : ''}${'a'.repeat(64)}`,
        timestamp: observationTime / 1_000,
        txCount: 100,
        used: chain === 'bitcoin' ? 500_000 : 30_000_000,
        capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
      },
    ],
  });
}

async function routeSnapshots(page: Page, current: (chain: ChainId) => Snapshot) {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    expect(url.searchParams.get('mode')).toBe('live');
    await route.fulfill({ json: current(chain) });
  });
}

async function settleBoarding(page: Page) {
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  }
  // The public control settles positions without relying on SVG travelers or frame timing.
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Activer les mouvements', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('renders the expanded sample on both chains without dropping current pending travelers', async ({
  page,
}) => {
  await page.clock.install({ time: observationTime });
  await routeSnapshots(page, (chain) => {
    const createTransaction = (index: number): Tx => ({
      ...transaction(chain),
      id: `${chain === 'ethereum' ? '0x' : ''}${(index + 1).toString(16).padStart(64, '0')}`,
    });
    const source = liveSnapshot(
      chain,
      Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) => createTransaction(index)),
      observationTime,
    );
    return snapshotSchema.parse({
      ...source,
      transactions: [
        ...source.transactions,
        ...Array.from({ length: CONFIRMED_SAMPLE_LIMIT }, (_, index) => ({
          ...createTransaction(PENDING_SAMPLE_LIMIT + index),
          status: 'confirmed' as const,
          blockHash: source.blocks[0]!.hash,
        })),
      ],
    });
  });
  await page.goto('/');
  await settleBoarding(page);
  for (const chain of chains) {
    const badge = nextWagonCount(page, chain);
    await expect(badge).toHaveAttribute('data-transaction-count', String(PENDING_SAMPLE_LIMIT));
    await expect(badge).toHaveAttribute(
      'data-resource-used',
      String(PENDING_SAMPLE_LIMIT * transaction(chain).size),
    );
    await expect(pane(page, chain).locator('.chain-coverage')).toContainText(
      `${PENDING_SAMPLE_LIMIT} en attente échantillonnées`,
    );
  }
});

test('a Bitcoin recommendation increase keeps a pending traveler aboard when block space remains', async ({
  page,
}) => {
  const observedAt = observationTime;
  await page.clock.install({ time: observedAt });
  const tx = transaction('bitcoin');
  let raised = false;
  let updatedRequests = 0;
  await routeSnapshots(page, (chain) => {
    if (raised && chain === 'bitcoin') updatedRequests += 1;
    return liveSnapshot(
      chain,
      chain === 'bitcoin' ? [tx] : [],
      observedAt + (raised ? 3_000 : 0),
      raised && chain === 'bitcoin' ? 100 : 1,
    );
  });
  await page.goto('/');
  await settleBoarding(page);
  const badge = nextWagonCount(page, 'bitcoin');
  await expect(badge).toHaveAttribute('data-transaction-count', '1');
  await expect(badge).toHaveAttribute('data-resource-used', '200');
  await expect(badge).toHaveAttribute('data-resource-capacity', '1000000');

  raised = true;
  await page.clock.runFor(3_100);
  await expect.poll(() => updatedRequests).toBeGreaterThan(0);
  await expect(pane(page, 'bitcoin').locator('.chain-coverage')).toHaveAttribute(
    'title',
    /Tarif de référence : 100 sat\/vB/,
  );
  await expect(badge).toHaveAttribute('data-transaction-count', '1');
  await expect(badge).toHaveAttribute('data-resource-used', '200');

  const browse = page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' });
  await browse.focus();
  await page.keyboard.press('Enter');
  const browser = page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });
  await expect(browser.getByRole('combobox')).toBeFocused();
  await expect(browser.getByRole('combobox')).toHaveValue(tx.id);
  await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
    'en attente dans la source. à bord du wagon illustratif',
  );
  await expect(
    pane(page, 'bitcoin').locator('.street-first-wagon[data-moving="true"]'),
  ).toHaveCount(0);
});

test('a partial refresh preserves boarded travelers on both chains and marks their current pool status unknown', async ({
  page,
}) => {
  const observedAt = observationTime;
  await page.clock.install({ time: observedAt });
  let missing = false;
  const refreshed = new Set<ChainId>();
  await routeSnapshots(page, (chain) => {
    if (missing) refreshed.add(chain);
    return liveSnapshot(
      chain,
      missing ? [] : [transaction(chain)],
      observedAt + (missing ? 3_000 : 0),
    );
  });
  await page.goto('/');
  await settleBoarding(page);
  for (const chain of chains) {
    await expect(nextWagonCount(page, chain)).toHaveAttribute('data-transaction-count', '1');
  }

  missing = true;
  await page.clock.runFor(3_100);
  await expect.poll(() => refreshed.size).toBe(2);
  for (const chain of chains) {
    await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
      'title',
      /Échantillon partiel contrôlé \(0 transactions\)/,
    );
    const badge = nextWagonCount(page, chain);
    await expect(badge).toHaveAttribute('data-transaction-count', '1');
    await expect(badge).toHaveAttribute('aria-label', /conservée.*hors de l’échantillon actuel/);
    await expect(badge).toHaveAttribute(
      'aria-label',
      /présence actuelle dans le mempool est inconnue/,
    );
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
    await expect(pane(page, chain).locator('.street-first-wagon[data-moving="true"]')).toHaveCount(
      0,
    );

    const chainName = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';
    await page.getByRole('button', { name: `Parcourir les transactions ${chainName}` }).focus();
    await page.keyboard.press('Enter');
    const browser = page.getByRole('dialog', { name: `Transactions observées ${chainName}` });
    // Retention stays inspectable, with an explicit unknown current pool status.
    await expect(browser.getByRole('combobox')).toBeEnabled();
    await expect(browser.getByRole('combobox')).toHaveValue(transaction(chain).id);
    await expect(browser.locator(`option[value="${transaction(chain).id}"]`)).toContainText(
      'dernière observation · statut actuel inconnu',
    );
    await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
      'dernière observation conservée',
    );
    await expect(browser.locator('.passenger-canvas-browser-description')).not.toContainText(
      'en attente dans la source',
    );
    await page.keyboard.press('Escape');
    await expect(browser).toHaveCount(0);
  }
});

test('keeps the fixed historical budget inspectable before bounded grouping of older cohorts', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: observationTime });
  let cohort = 0;
  const fetched = new Set<string>();
  const snapshots = Array.from(
    { length: 4 },
    (_, index) =>
      Object.fromEntries(
        chains.map((chain) => [
          chain,
          liveSnapshot(
            chain,
            Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, position): Tx => {
              const identifier = index * PENDING_SAMPLE_LIMIT + position + 1;
              return {
                ...transaction(chain),
                id: `${chain === 'ethereum' ? '0x' : ''}${identifier.toString(16).padStart(64, '0')}`,
              };
            }),
            observationTime + index * 3_000,
          ),
        ]),
      ) as Record<ChainId, Snapshot>,
  );
  await routeSnapshots(page, (chain) => {
    fetched.add(`${chain}:${cohort}`);
    return snapshots[cohort]![chain];
  });
  await page.goto('/');
  await settleBoarding(page);

  const expectWagonBudgets = async (chain: ChainId, residentCount: number) => {
    const size = transaction(chain).size;
    const capacity = chain === 'bitcoin' ? 1_000_000 : 60_000_000;
    const nextCount = Math.min(residentCount, Math.floor(capacity / size));
    const expected = { next: nextCount, later: residentCount - nextCount };
    for (const projection of ['next', 'later'] as const) {
      const badge = pane(page, chain).locator(`[data-projection="${projection}"]`).getByRole('img');
      await expect(badge).toHaveAttribute('data-transaction-count', String(expected[projection]));
      await expect(badge).toHaveAttribute(
        'data-resource-used',
        String(expected[projection] * size),
      );
      await expect(badge).toHaveAttribute('data-resource-capacity', String(capacity));
      expect(expected[projection] * size).toBeLessThanOrEqual(capacity);
    }
    await expect(pane(page, chain).locator('.chain-coverage')).toContainText(
      `${PENDING_SAMPLE_LIMIT} en attente échantillonnées`,
    );
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  };

  const expectInspectableCohorts = async (chain: ChainId, historicalCount: number) => {
    const chainName = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';
    await page.getByRole('button', { name: `Parcourir les transactions ${chainName}` }).focus();
    await page.keyboard.press('Enter');
    const browser = page.getByRole('dialog', { name: `Transactions observées ${chainName}` });
    const selector = browser.getByRole('combobox');
    await expect(selector).toBeFocused();
    await expect(selector.locator('option')).toHaveCount(PENDING_SAMPLE_LIMIT + historicalCount);
    await expect(
      selector.locator('option').filter({ hasText: 'en attente dans la source' }),
    ).toHaveCount(PENDING_SAMPLE_LIMIT);
    const historical = selector
      .locator('option')
      .filter({ hasText: 'dernière observation · statut actuel inconnu' });
    await expect(historical).toHaveCount(historicalCount);
    if (historicalCount > 0) {
      const historicalId = await historical.first().getAttribute('value');
      expect(historicalId).not.toBeNull();
      await selector.selectOption(historicalId!);
      await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
        'dernière observation conservée',
      );
      await expect(browser.locator('.passenger-canvas-browser-description')).toContainText(
        'à bord du wagon illustratif',
      );
    }
    await page.keyboard.press('Escape');
    await expect(browser).toHaveCount(0);
  };

  for (const chain of chains) {
    await expectWagonBudgets(chain, PENDING_SAMPLE_LIMIT);
    await expectInspectableCohorts(chain, 0);
  }
  for (let nextCohort = 1; nextCohort < 4; nextCohort += 1) {
    cohort = nextCohort;
    await page.clock.runFor(3_100);
    await expect.poll(() => chains.every((chain) => fetched.has(`${chain}:${cohort}`))).toBe(true);
    const historicalCount = Math.min(cohort * PENDING_SAMPLE_LIMIT, MAX_INDIVIDUAL_HISTORY);
    const archivedCount = cohort * PENDING_SAMPLE_LIMIT - historicalCount;
    for (const chain of chains) {
      await expectWagonBudgets(chain, PENDING_SAMPLE_LIMIT + historicalCount);
      await expectInspectableCohorts(chain, historicalCount);
      const archive = pane(page, chain).locator('[data-waiting-archive-count]');
      if (archivedCount === 0) {
        await expect(archive).toHaveCount(0);
      } else {
        await expect(archive).toHaveAttribute('data-waiting-archive-count', String(archivedCount));
        // ICU grouping differs between Node and the browser (apostrophe or narrow space).
        const unknownCountPattern = String(archivedCount - 512).replace(
          /\B(?=(\d{3})+(?!\d))/g,
          "[\\s'’]?",
        );
        await expect(archive).toHaveAttribute(
          'aria-label',
          new RegExp(
            `512 identifiants conservés pour retrouver leurs inclusions, ${unknownCountPattern} observations sans suivi individuel`,
          ),
        );
      }
    }
    if (cohort >= 2) {
      await page.screenshot({
        path: testInfo.outputPath(`cohort-${cohort + 1}-bounded-history.png`),
        fullPage: true,
      });
    }
  }
});
