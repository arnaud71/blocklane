import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type EventFlow, type PoolFlow } from '../../shared/model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const CHAINS = ['bitcoin', 'ethereum'] as const;
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const board = (page: Page, chain: ChainId) => pane(page, chain).locator('.info-billboard');
const group = (page: Page, chain: ChainId) =>
  pane(page, chain).locator('[data-provider-flow-arrivals]');

/** The browser only receives HTTP fixtures; no blockchain WebSocket or API is contacted. */
async function setup(page: Page, initialLive = false, noInventory = false) {
  let stage = initialLive ? 1 : 0;
  const base = NOW - (initialLive ? 5_000 : 1_000);
  const served = new Map<ChainId, number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const current = stage;
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    const pointStage =
      current === 9
        ? 2
        : current === 2 || current === 3
          ? 1
          : current === 7 || current === 8
            ? 6
            : current;
    const at = base + pointStage * 3_000;
    const warming = current === 0 || current === 5;
    const events: EventFlow = {
      source: 'Flux contrôlé par événements',
      method: chain === 'bitcoin' ? 'mempool-txids' : 'newPendingTransactions',
      state: warming
        ? 'warming'
        : current === 2 || current === 8
          ? 'interrupted'
          : current === 3
            ? 'limited'
            : 'live',
      epoch: current === 9 ? 1 : current >= 5 ? 3 : current >= 4 ? 2 : 1,
      startedAt:
        current === 9 ? base : current >= 5 ? base + 15_000 : current >= 4 ? base + 9_000 : base,
      observedAt: at,
      lastMessageAt: current === 7 ? base + 21_000 : at,
      history: warming
        ? []
        : [
            {
              fromObservedAt: at - 3_000,
              observedAt: at,
              enteredCount: 18,
              outsideSampleEnteredCount: 7,
            },
          ],
    };
    const inventory: PoolFlow | null =
      noInventory || current >= 3
        ? null
        : {
            source: 'Inventaire périodique contrôlé',
            method: chain === 'bitcoin' ? 'getrawmempool' : 'txpool_content',
            state: 'ready',
            observedAt: base,
            inventoryCount: 100,
            history: [
              {
                fromObservedAt: base - 10_000,
                observedAt: base,
                previousCount: 100,
                currentCount: 100,
                enteredCount: 30,
                disappearedCount: 30,
                outsideSampleEnteredCount: 25,
              },
            ],
          };
    const snapshot = snapshotSchema.parse({
      chain,
      mode: 'live',
      status: current === 9 ? 'stale' : 'ok',
      source: 'Source HTTP contrôlée',
      observedAt: await page.evaluate(() => Date.now()),
      coverage: `Événements contrôlés étape ${current}. Sources distinctes.`,
      pendingCount: chain === 'bitcoin' ? 100 : null,
      feeRate: 1,
      feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
      transactions: [],
      blocks: [],
      inclusions: [],
      poolFlow: inventory,
      eventFlow: events,
    });
    served.set(chain, current);
    await route.fulfill({ json: snapshot });
  });
  await page.goto('/');
  for (const chain of CHAINS) {
    await pane(page, chain)
      .getByRole('button', {
        name: `Afficher flux · ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
        exact: true,
      })
      .focus();
    await page.keyboard.press('Enter');
    await expect(board(page, chain)).toHaveAttribute('data-page', 'Flux');
  }
  return {
    base,
    refresh: async (next: number) => {
      stage = next;
      for (
        let attempt = 0;
        attempt < 30 && CHAINS.some((chain) => served.get(chain) !== stage);
        attempt += 1
      )
        await page.clock.runFor(200);
      for (const chain of CHAINS)
        await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
          'title',
          new RegExp(`étape ${stage}\\.`),
        );
    },
  };
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('les événements datés prennent la priorité sans changer le sens des notifications Ethereum ni rejouer un batch', async ({
  page,
}, testInfo) => {
  const { base, refresh } = await setup(page);
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-flow-kind', 'inventory');
    await expect(board(page, chain)).toContainText('Relevé périodique');
  }
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(1);
  for (const chain of CHAINS) {
    const panel = board(page, chain);
    await expect(panel).toHaveAttribute('data-flow-kind', 'events');
    await expect(panel.locator('.info-billboard-value')).toHaveText('+18');
    await expect(panel.locator('.info-billboard-label')).toHaveText(
      chain === 'bitcoin' ? 'Ajouts observés' : 'Notifications pending',
    );
    await expect(panel).toContainText('Flux suivi · événements');
    await expect(panel.locator('.info-billboard-source time')).toHaveAttribute(
      'datetime',
      new Date(base + 3_000).toISOString(),
    );
    if (chain === 'bitcoin') await expect(group(page, chain)).toHaveCount(0);
    else {
      await expect(group(page, chain)).toHaveAttribute('data-flow-kind', 'events');
      await expect(group(page, chain)).toHaveAttribute('data-flow-count', '7');
      await expect(group(page, chain).locator('.provider-flow-arrivals-motion')).toHaveCSS(
        'animation-play-state',
        'paused',
      );
      expect(
        await group(page, chain).evaluate((node) => getComputedStyle(node).pointerEvents),
      ).toBe('none');
    }
    const bounds = (await panel.boundingBox())!;
    for (const selector of [
      '.info-billboard-flow',
      '.info-billboard-source',
      '.info-billboard-footer',
    ]) {
      const child = (await panel.locator(selector).boundingBox())!;
      expect(child.y).toBeGreaterThanOrEqual(bounds.y);
      expect(child.y + child.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }
  await expect(board(page, 'ethereum').locator('.info-billboard-screen')).toHaveAttribute(
    'title',
    /promotion depuis queued.*réémission/,
  );
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await setHidden(page, true);
  for (const chain of ['ethereum'] as const)
    await expect(group(page, chain).locator('.provider-flow-arrivals-motion')).toHaveCSS(
      'animation-play-state',
      'paused',
    );
  await setHidden(page, false);
  for (const chain of ['ethereum'] as const)
    await group(page, chain)
      .locator('.provider-flow-arrivals-motion')
      .evaluate((node) => {
        for (const animation of node.getAnimations()) animation.currentTime = 1_300;
      });
  await page.screenshot({ path: testInfo.outputPath('event-flow-live.png'), fullPage: true });
  for (const chain of ['ethereum'] as const)
    await group(page, chain)
      .locator('.provider-flow-arrivals-motion')
      .evaluate((node) => {
        for (const animation of node.getAnimations()) animation.finish();
      });
  await page.clock.runFor(100);
  await page.clock.runFor(3_500);
  for (const chain of CHAINS) await expect(group(page, chain)).toHaveCount(0);
});

test('interruption, limite et reconnexion conservent des baselines distinctes, avec une arrivée statique en réduit', async ({
  page,
}, testInfo) => {
  const { refresh } = await setup(page, true);
  for (const chain of CHAINS) await expect(group(page, chain)).toHaveCount(0);
  await refresh(2);
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-flow-kind', 'inventory');
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('+30');
    await expect(board(page, chain).locator('.info-billboard-flow-kind')).toHaveText(
      'Relevé périodique · flux interrompu',
    );
    await expect(board(page, chain).locator('.info-billboard-screen')).toHaveAttribute(
      'title',
      /Flux interrompu.*Secours par relevé périodique/,
    );
    await expect(group(page, chain)).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('event-flow-periodic-fallback.png'),
    fullPage: true,
  });
  await refresh(3);
  for (const chain of CHAINS) {
    await expect(board(page, chain).locator('.info-billboard-label')).toHaveText(
      'Limite du flux atteinte',
    );
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('—');
  }
  await refresh(4); // A newly discovered live epoch is a baseline, not a replay.
  for (const chain of CHAINS) await expect(group(page, chain)).toHaveCount(0);
  await refresh(5);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh(6);
  for (const chain of CHAINS) {
    if (chain === 'bitcoin') {
      await expect(group(page, chain)).toHaveCount(0);
      continue;
    }
    await expect(group(page, chain)).toHaveAttribute('data-flow-kind', 'events');
    await expect(group(page, chain)).toHaveAttribute('data-flow-count', '7');
    await expect(group(page, chain).locator('.provider-flow-arrivals-motion')).toHaveCSS(
      'animation-name',
      'none',
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('event-flow-reconnected-reduced.png'),
    fullPage: true,
  });
  await refresh(7); // A fresh heartbeat leaves the batch date and its frozen partition unchanged.
  for (const chain of CHAINS)
    await expect(group(page, chain)).toHaveCount(chain === 'ethereum' ? 1 : 0);
  await refresh(8);
  for (const chain of CHAINS) await expect(group(page, chain)).toHaveCount(0);
});

test('un head HTTP frais ne rafraîchit pas un ancien batch et ne fabrique pas de débit nul', async ({
  page,
}) => {
  const { refresh } = await setup(page, true, true);
  for (const chain of CHAINS)
    await expect(board(page, chain)).toHaveAttribute('data-flow-kind', 'events');
  await refresh(9);
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-status', 'stale');
    await expect(board(page, chain)).toHaveAttribute('data-flow-kind', 'events');
    await expect(board(page, chain).locator('.info-billboard-screen')).toHaveAttribute(
      'title',
      /Relevé des blocs ancien ; notifications datées indépendamment/,
    );
    if (chain === 'ethereum')
      await expect(group(page, chain)).toHaveAttribute('data-flow-paused', 'true');
    else await expect(group(page, chain)).toHaveCount(0);
  }
  await page.clock.fastForward(16_001);
  await refresh(1);
  for (const chain of CHAINS) {
    await expect(board(page, chain)).toHaveAttribute('data-flow-kind', 'none');
    await expect(board(page, chain).locator('.info-billboard-value')).toHaveText('—');
    await expect(board(page, chain).locator('[data-flow-history-count]')).toHaveCount(0);
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
    await expect(group(page, chain)).toHaveCount(0);
  }
});
