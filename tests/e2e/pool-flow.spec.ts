import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type PoolFlow } from '../../shared/model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const CHAINS = ['bitcoin', 'ethereum'] as const;
const name = (chain: ChainId) => (chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum');
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const board = (page: Page, chain: ChainId) => pane(page, chain).locator('.info-billboard');
const cohort = (page: Page, chain: ChainId) =>
  pane(page, chain).locator('[data-provider-flow-arrivals]');

async function setup(page: Page, initialReady = false, empty = false) {
  let stage = initialReady ? 1 : 0;
  const served = new Map<ChainId, number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    const observedAt = NOW - 20_000 + stage * 3_000;
    const warming = stage === 0 || stage === 6;
    const zero = empty || stage === 2;
    const count = empty ? 0 : 100;
    const flow: PoolFlow | null =
      stage === 3
        ? null
        : {
            source: stage >= 5 ? 'Autre inventaire contrôlé' : 'Inventaire contrôlé',
            method: chain === 'bitcoin' ? 'getrawmempool' : 'txpool_content',
            observedAt,
            inventoryCount: count,
            state: warming ? 'warming' : 'ready',
            history: warming
              ? []
              : [
                  {
                    fromObservedAt: observedAt - 3_000,
                    observedAt,
                    previousCount: count,
                    currentCount: count,
                    enteredCount: zero ? 0 : 30,
                    disappearedCount: zero ? 0 : 30,
                    outsideSampleEnteredCount: stage === 2 ? null : zero ? 0 : stage === 1 ? 25 : 7,
                  },
                ],
          };
    served.set(chain, stage);
    await route.fulfill({
      json: snapshotSchema.parse({
        chain,
        mode: 'live',
        status: 'ok',
        source: 'Flux contrôlé',
        observedAt: await page.evaluate(() => Date.now()),
        coverage: `Flux contrôlé étape ${stage}. Inventaire fournisseur complet et échantillon partiel.`,
        pendingCount: chain === 'bitcoin' ? count : null,
        feeRate: 1,
        feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
        transactions: [],
        blocks: [],
        inclusions: [],
        poolFlow: flow,
      }),
    });
  });
  await page.goto('/');
  for (const chain of CHAINS) {
    await pane(page, chain)
      .getByRole('button', { name: `Afficher flux · ${name(chain)}`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(board(page, chain)).toHaveAttribute('data-page', 'Flux');
  }
  return async (next: number) => {
    stage = next;
    for (
      let attempts = 0;
      attempts < 30 && CHAINS.some((chain) => served.get(chain) !== stage);
      attempts += 1
    )
      await page.clock.runFor(200);
    for (const chain of CHAINS)
      await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
        'title',
        new RegExp(`étape ${stage}\\.`),
      );
  };
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('le flux compte les entrées brutes, date son relevé et anime une seule arrivée collective latérale', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  const heights = new Map(
    await Promise.all(
      CHAINS.map(
        async (chain) => [chain, (await board(page, chain).boundingBox())!.height] as const,
      ),
    ),
  );
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-flow-state', 'warming');
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('—');
    await expect(cohort(page, chain)).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(1);
  for (const chain of CHAINS) {
    const panel = board(page, chain);
    await expect(panel).toHaveAttribute('data-flow-state', 'ready');
    await expect(panel.locator('.info-billboard-value')).toHaveText('+30');
    await expect(panel.locator('.info-billboard-unit')).toHaveText('sur 3 s');
    await expect(panel.locator('.info-billboard-flow')).toContainText('10 tx/s');
    await expect(panel.locator('.info-billboard-source time')).toHaveAttribute(
      'datetime',
      new Date(NOW - 17_000).toISOString(),
    );
    await expect(panel.locator('[data-flow-history-count]')).toHaveAttribute(
      'data-flow-history-count',
      '1',
    );
    expect((await panel.boundingBox())!.height).toBe(heights.get(chain));
    const group = cohort(page, chain);
    if (chain === 'bitcoin') {
      await expect(group).toHaveCount(0);
      continue;
    }
    await expect(group).toHaveAttribute('data-flow-count', '25');
    await expect(group).toHaveAttribute('data-flow-origin', 'ordinary-lateral-entry');
    await expect(group).toHaveAttribute('data-flow-paused', 'true');
    await expect(group.locator('.provider-flow-arrivals-motion')).toHaveCSS(
      'animation-play-state',
      'paused',
    );
    expect(await group.locator('circle').count()).toBeLessThanOrEqual(5);
    expect(await group.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    expect(await group.locator('[data-transaction-id]').count()).toBe(0);
    expect((await group.boundingBox())!.y).toBeGreaterThan(
      (await pane(page, chain).locator('[data-network-remainder]').boundingBox())!.y,
    );
  }
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await hidden(page, true);
  for (const chain of ['ethereum'] as const) {
    await expect(cohort(page, chain)).toHaveAttribute('data-flow-paused', 'true');
    await expect(cohort(page, chain).locator('.provider-flow-arrivals-motion')).toHaveCSS(
      'animation-play-state',
      'paused',
    );
  }
  await hidden(page, false);
  for (const chain of ['ethereum'] as const) {
    await expect(cohort(page, chain)).toHaveAttribute('data-flow-paused', 'false');
    await cohort(page, chain)
      .locator('.provider-flow-arrivals-motion')
      .evaluate((node) => {
        for (const animation of node.getAnimations()) animation.currentTime = 1_300;
      });
  }
  await page.screenshot({
    path: testInfo.outputPath('provider-flow-arrivals.png'),
    fullPage: true,
  });
  for (const chain of ['ethereum'] as const)
    await cohort(page, chain)
      .locator('.provider-flow-arrivals-motion')
      .evaluate((node) => {
        for (const animation of node.getAnimations()) animation.finish();
      });
  await page.clock.runFor(100);
  for (const chain of CHAINS) await expect(cohort(page, chain)).toHaveCount(0);
  await page.clock.runFor(3_500); // A newer HTTP snapshot with the same inventory date cannot replay it.
  for (const chain of CHAINS) await expect(cohort(page, chain)).toHaveCount(0);
  await refresh(2);
  for (const chain of CHAINS) {
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('+0');
    await expect(cohort(page, chain)).toHaveCount(0);
  }
});

test('un ancien intervalle initial ne se rejoue pas, une absence temporaire garde la continuité et le réduit reste statique', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page, true);
  for (const chain of CHAINS) await expect(cohort(page, chain)).toHaveCount(0);
  await refresh(3);
  await refresh(4);
  await expect(cohort(page, 'ethereum')).toHaveAttribute('data-flow-count', '7');
  await expect(cohort(page, 'bitcoin')).toHaveCount(0);
  await refresh(5);
  for (const chain of CHAINS) await expect(cohort(page, chain)).toHaveCount(0);
  await refresh(6);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh(7);
  for (const chain of CHAINS) {
    const group = cohort(page, chain);
    if (chain === 'bitcoin') {
      await expect(group).toHaveCount(0);
      continue;
    }
    await expect(group).toHaveAttribute('data-flow-reduced', 'true');
    await expect(group).toHaveAttribute('data-flow-count', '7');
    expect(
      await group
        .locator('.provider-flow-arrivals-motion')
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe('none');
  }
  await page.screenshot({ path: testInfo.outputPath('provider-flow-reduced.png'), fullPage: true });
});

test('un inventaire vide initialise sans débit puis mesure zéro et expire malgré un nouveau head HTTP', async ({
  page,
}) => {
  const refresh = await setup(page, false, true);
  for (const chain of CHAINS)
    await expect(board(page, chain)).toHaveAttribute('data-flow-state', 'warming');
  await refresh(1);
  for (const chain of CHAINS) {
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('+0');
    await expect(cohort(page, chain)).toHaveCount(0);
  }
  await page.clock.fastForward(90_001);
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-flow-state', 'unavailable');
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('—');
    await expect(cohort(page, chain)).toHaveCount(0);
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  }
});
