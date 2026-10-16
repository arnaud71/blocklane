import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Tx } from '../../shared/model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const id = (index: number) => index.toString(16).padStart(64, '0');
const MEMBER: Tx = {
  id: id(1),
  chain: 'bitcoin',
  status: 'pending',
  feeRate: 4,
  size: 500,
  kind: 'transfer',
  value: '0.01 BTC',
};
const OTHER: Tx = { ...MEMBER, id: id(2), feeRate: 8, size: 1_000 };
const pane = (page: Page) => page.locator('.chain-pane[data-chain="bitcoin"]');
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });

async function setup(page: Page, { candidate = true } = {}) {
  let stage = 0;
  const served = new Map<ChainId, number>();
  const servedAt = new Map<ChainId, number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const current = stage;
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    const bitcoin = chain === 'bitcoin';
    const observedAt = await page.evaluate(() => Date.now());
    const parent = {
      hash: bitcoin ? id(100 + Number(current >= 2)) : `0x${id(200)}`,
      height: bitcoin ? 100 + Number(current >= 2) : 200,
      timestamp: NOW / 1_000,
      txCount: 2,
      used: 500_000,
      capacity: bitcoin ? 1_000_000 : 60_000_000,
    };
    const transactions =
      !bitcoin || current === 0
        ? []
        : current >= 2
          ? [{ ...MEMBER, status: 'confirmed', blockHash: parent.hash }, OTHER]
          : [MEMBER, OTHER];
    const arrivals = current >= 2 ? [OTHER] : current === 1 ? [MEMBER, OTHER] : [];
    served.set(chain, current);
    servedAt.set(chain, observedAt);
    await route.fulfill({
      json: snapshotSchema.parse({
        chain,
        mode: 'live',
        status: 'ok',
        source: 'Nœud RPC contrôlé',
        observedAt,
        coverage: `Arrivées réelles contrôlées étape ${current}. Vue RPC distincte du flux.`,
        pendingCount: bitcoin ? 0 : null,
        feeRate: 100,
        feeUnit: bitcoin ? 'sat/vB' : 'Gwei',
        transactions,
        blocks: [parent],
        inclusions: bitcoin && current >= 2 ? [{ block: parent, transactionIds: [MEMBER.id] }] : [],
        ...(bitcoin
          ? {
              bitcoinArrivals: {
                source: 'mempool.space contrôlé',
                method: 'mempool-transactions',
                observedAt: current === 0 ? NOW : NOW + 3_000,
                transactionIds: arrivals.map((tx) => tx.id),
              },
              sampling: {
                source: 'Autre nœud RPC',
                method: 'getrawmempool',
                observedAt: candidate ? observedAt : NOW,
                pendingCount: 0,
                update: 'full',
              },
              poolObservation: {
                source: 'Autre nœud RPC',
                method: 'getrawmempool',
                observedAt: candidate ? observedAt : NOW,
                presentTransactionIds: [],
                queuedTransactionIds: [],
                absentTransactionIds: arrivals.map((tx) => tx.id),
              },
              blockTemplate: candidate
                ? {
                    source: 'Candidat public du nœud',
                    observedAt,
                    previousBlockHash: parent.hash,
                    height: parent.height + 1,
                    transactionCount: current === 1 ? 1 : 0,
                    weight: current === 1 ? MEMBER.size * 4 : 0,
                    weightLimit: 4_000_000,
                    selectedTransactionIds: current === 1 ? [MEMBER.id] : [],
                  }
                : null,
            }
          : {
              eventFlow: {
                source: 'Notifications Ethereum contrôlées',
                method: 'newPendingTransactions',
                state: current === 0 ? 'warming' : 'live',
                epoch: 1,
                startedAt: NOW,
                observedAt: current === 0 ? NOW : NOW + 3_000,
                lastMessageAt: current === 0 ? NOW : NOW + 3_000,
                history:
                  current === 0
                    ? []
                    : [
                        {
                          fromObservedAt: NOW,
                          observedAt: NOW + 3_000,
                          enteredCount: 20,
                          outsideSampleEnteredCount: 20,
                        },
                      ],
              },
            }),
      }),
    });
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  return async (next: number) => {
    stage = next;
    for (
      let attempts = 0;
      attempts < 30 &&
      ['bitcoin', 'ethereum'].some((chain) => served.get(chain as ChainId) !== stage);
      attempts += 1
    )
      await page.clock.runFor(200);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      `Arrivées réelles contrôlées étape ${stage}. Vue RPC distincte du flux.`,
    );
    return servedAt.get('bitcoin')!;
  };
}

async function openTraveler(page: Page, tx: Tx) {
  await page
    .getByRole('button', { name: 'Parcourir les transactions Bitcoin', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const selector = browser(page).getByRole('combobox');
  await expect(selector.locator('option')).toHaveCount(2);
  await selector.selectOption(tx.id);
  return browser(page).locator('.passenger-canvas-browser-description');
}
async function closeBrowser(page: Page) {
  await page.keyboard.press('Escape');
  await expect(browser(page)).toHaveCount(0);
}
async function pixels(page: Page) {
  return pane(page)
    .locator('canvas.passenger-canvas')
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2_166_136_261;
      let point: { x: number; y: number } | null = null;
      for (let y = 0; y < canvas.height; y += 1)
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1)
            hash = Math.imul(hash ^ data[offset + channel]!, 16_777_619);
          if (!point && data[offset + 3]! > 220) point = { x: x + 0.5, y: y + 0.5 };
        }
      const rect = canvas.getBoundingClientRect();
      return {
        hash: hash >>> 0,
        point: point
          ? {
              x: rect.x + (point.x * rect.width) / canvas.width,
              y: rect.y + (point.y * rect.height) / canvas.height,
            }
          : null,
      };
    });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('les vrais détails Bitcoin arrivent sur le quai, restent cliquables et seule une preuve exacte les fait partir', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(1);
  await expect(pane(page).locator('[data-provider-flow-arrivals]')).toHaveCount(0);
  await expect(page.locator('[data-provider-flow-arrivals="ethereum"]')).toHaveAttribute(
    'data-flow-count',
    '20',
  );
  for (const tx of [MEMBER, OTHER]) {
    const description = await openTraveler(page, tx);
    await expect(description).toContainText('mempool.space contrôlé');
    await expect(description).toContainText('arrivée depuis le bord extérieur du quai');
    await expect(description).not.toContainText('absente du dernier relevé');
    await expect(description).not.toContainText('incluse dans un bloc observé');
    await closeBrowser(page);
  }
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.runFor(800);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  const before = await pixels(page);
  expect(before.point).not.toBeNull();
  await page.clock.runFor(500);
  expect(await pixels(page)).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-real-lateral-arrivals.png'),
    fullPage: true,
  });
  await page.mouse.click(before.point!.x, before.point!.y);
  const panel = page.getByTestId('info-panel');
  const selected = await panel.locator('.info-transaction-hash').getAttribute('title');
  expect([MEMBER.id, OTHER.id]).toContain(selected);
  await expect(panel).toContainText('mempool.space contrôlé');
  await page
    .getByRole('button', { name: 'Masquer le panneau d’informations', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.runFor(12_000);
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
  for (const tx of [MEMBER, OTHER]) {
    await expect(await openTraveler(page, tx)).toContainText('à bord du wagon illustratif');
    await closeBrowser(page);
  }
  await refresh(2);
  await page.clock.runFor(3_100);
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'true');
  await expect(pane(page).locator('.street-first-wagon').getByRole('img')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
});

test('les voyageurs Bitcoin en mouvement réduit restent de vrais pending et remplacent entièrement le collectif Bitcoin', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh(1);
  await expect(pane(page).locator('[data-provider-flow-arrivals]')).toHaveCount(0);
  await expect(page.locator('[data-provider-flow-arrivals="ethereum"]')).toHaveAttribute(
    'data-flow-reduced',
    'true',
  );
  for (const tx of [MEMBER, OTHER]) {
    const description = await openTraveler(page, tx);
    await expect(description).toContainText('mempool.space contrôlé');
    await expect(description).not.toContainText('incluse dans un bloc observé');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-panel')).toContainText(
      tx.size === 1_000 ? /1[’\u202f\u00a0 ]000 vB/ : '500 vB',
    );
    await closeBrowser(page);
  }
  await page
    .getByRole('button', { name: 'Masquer le panneau d’informations', exact: true })
    .click();
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-real-arrivals-reduced.png'),
    fullPage: true,
  });
});

test('le repli Bitcoin sans candidat présente un échantillon mixte daté et les détails des vraies arrivées malgré un inventaire RPC vide', async ({
  page,
}) => {
  const refresh = await setup(page, { candidate: false });
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  const assembledAt = await refresh(1);
  const footer = pane(page).locator('.chain-coverage');
  await expect(footer).toContainText('Échantillon mixte · arrivées réelles');
  await expect(footer).toContainText('2 en attente échantillonnées');
  await expect(footer).toContainText('dont 2 arrivées récentes');
  await expect(footer).not.toContainText('Top des pending');
  await expect(footer).not.toHaveAttribute('data-template-count');
  const assembledTime = await page.evaluate(
    (at) => new Date(at).toLocaleTimeString('fr-CH'),
    assembledAt,
  );
  await expect(footer).toContainText(`relevé ${assembledTime}`);
  const rpcTime = await page.evaluate((at) => new Date(at).toLocaleTimeString('fr-CH'), NOW);
  await expect(footer).not.toContainText(`relevé ${rpcTime}`);
  await expect(pane(page).locator('[data-provider-flow-arrivals]')).toHaveCount(0);

  for (const tx of [MEMBER, OTHER]) {
    const description = await openTraveler(page, tx);
    await expect(description).toContainText('en attente observée par mempool.space contrôlé');
    await expect(description).not.toContainText('absente du dernier relevé');
    await expect(description).not.toContainText('incluse dans un bloc observé');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('info-panel');
    await expect(panel.locator('.info-transaction-hash')).toHaveAttribute('title', tx.id);
    await expect(panel).toContainText('mempool.space contrôlé');
    await expect(panel).toContainText(`${tx.feeRate} sat/vB`);
    await closeBrowser(page);
  }
  await expect(pane(page).locator('.street-first-wagon')).toHaveAttribute('data-moving', 'false');
});
