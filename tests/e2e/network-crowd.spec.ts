import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId } from '../../shared/model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const COUNT = 24;
const CHAINS = ['bitcoin', 'ethereum'] as const;
const name = (chain: ChainId) => (chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum');
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const wagon = (page: Page, chain: ChainId) => pane(page, chain).locator('.street-first-wagon');
const hash = (chain: ChainId, index: number) =>
  `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`;

/** Only actual head glyph draws are recorded; invisible engine poses cannot count. */
function observePaintedHeads() {
  type PaintedCanvas = HTMLCanvasElement & { paintedHeads?: { x: number; y: number }[] };
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (
    this: CanvasRenderingContext2D,
    ...args: Parameters<CanvasRenderingContext2D['clearRect']>
  ) {
    if (this.canvas.classList.contains('passenger-canvas'))
      (this.canvas as PaintedCanvas).paintedHeads = [];
    Reflect.apply(clear, this, args);
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (
    this: CanvasRenderingContext2D,
    ...args: unknown[]
  ) {
    Reflect.apply(draw, this, args);
    const image = args[0];
    // The reusable head glyph is15×16 scene units at4× density, unlike shirts/icons/caches.
    if (
      this.canvas.classList.contains('passenger-canvas') &&
      image instanceof HTMLCanvasElement &&
      image.width === 60 &&
      image.height === 64 &&
      this.globalAlpha > 0
    ) {
      const point = this.getTransform().transformPoint({ x: 0, y: 0 });
      ((this.canvas as PaintedCanvas).paintedHeads ??= []).push({ x: point.x, y: point.y });
    }
  } as CanvasRenderingContext2D['drawImage'];
}

async function setup(page: Page) {
  let stage = 0;
  const served = new Map<ChainId, number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const chain: ChainId =
      new URL(route.request().url()).searchParams.get('chain') === 'bitcoin'
        ? 'bitcoin'
        : 'ethereum';
    const observedAt = await page.evaluate(() => Date.now());
    const block = {
      hash: hash(chain, 100 + stage),
      height: 100 + stage,
      timestamp: NOW / 1_000 - 12 + stage * 12,
      txCount: COUNT + Number(chain === 'bitcoin'),
      used: chain === 'bitcoin' ? COUNT * 240 : COUNT * 21_000,
      capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
    };
    const transactions =
      stage > 0
        ? Array.from({ length: COUNT }, (_, index) => ({
            id: hash(chain, index + 1),
            chain,
            status: 'confirmed',
            blockHash: block.hash,
            feeRate: 5,
            size: chain === 'bitcoin' ? 240 : 21_000,
            kind: 'transfer',
            value: 'Non mesurée',
          }))
        : [];
    served.set(chain, stage);
    await route.fulfill({
      json: snapshotSchema.parse({
        chain,
        mode: 'live',
        status: 'ok',
        source: 'Cohorte réseau contrôlée',
        observedAt,
        coverage: `Cohorte réseau contrôlée étape ${stage}. Échantillon partiel.`,
        pendingCount: chain === 'bitcoin' ? 0 : null,
        feeRate: 1,
        feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
        transactions,
        blocks: [block],
        inclusions: stage > 0 ? [{ block, transactionIds: transactions.map((tx) => tx.id) }] : [],
      }),
    });
  });
  await page.goto('/');
  for (const chain of CHAINS)
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  await page.clock.runFor(800);
  return async () => {
    stage = 1;
    for (
      let attempt = 0;
      attempt < 25 && CHAINS.some((chain) => served.get(chain) !== stage);
      attempt += 1
    )
      await page.clock.runFor(200);
    for (const chain of CHAINS)
      await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
        'title',
        /étape 1\./,
      );
  };
}

async function paintedState(page: Page, chain: ChainId) {
  return pane(page, chain)
    .locator('canvas.passenger-canvas')
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement & { paintedHeads?: { x: number; y: number }[] };
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const svg = canvas
        .closest('.chain-pane')!
        .querySelector('svg.street-scene-svg') as SVGSVGElement;
      const point = svg.createSVGPoint();
      point.y = 200;
      const rect = canvas.getBoundingClientRect();
      const queueTop =
        ((point.matrixTransform(svg.getScreenCTM()!).y - rect.y) * canvas.height) / rect.height;
      const opaque = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const px = Math.floor(x + dx);
            const py = Math.floor(y + dy);
            if (
              px >= 0 &&
              px < canvas.width &&
              py >= 0 &&
              py < canvas.height &&
              pixels[(py * canvas.width + px) * 4 + 3]! >= 192
            )
              return true;
          }
        return false;
      };
      const heads = (canvas.paintedHeads ?? []).filter(
        (head) => head.y < queueTop && opaque(head.x, head.y),
      );
      let hash = 2_166_136_261;
      let painted = 0;
      for (let index = 0; index < pixels.length; index += 1) {
        hash = Math.imul(hash ^ pixels[index]!, 16_777_619);
        if (index % 4 === 3 && pixels[index]) painted += 1;
      }
      return {
        hash: hash >>> 0,
        painted,
        heads: heads.length,
        distinct: new Set(heads.map((head) => `${Math.floor(head.x)},${Math.floor(head.y)}`)).size,
      };
    });
}

async function advanceUntilMoving(page: Page, chain: ChainId) {
  for (let elapsed = 0; elapsed < 3_500; elapsed += 40) {
    if ((await wagon(page, chain).getAttribute('data-moving')) === 'true') return;
    await page.clock.runFor(40);
  }
  await expect(wagon(page, chain)).toHaveAttribute('data-moving', 'true');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(observePaintedHeads);
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 100);
});

test('une cohorte réseau se distingue dans les pixels sur les deux chaînes, reste en pause et part entière', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh();
  for (const chain of CHAINS) expect((await paintedState(page, chain)).painted).toBe(0);
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.runFor(900);
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  for (const chain of CHAINS)
    await pane(page, chain).screenshot({ path: testInfo.outputPath(`network-crowd-${chain}.png`) });
  for (const chain of CHAINS) {
    const before = await paintedState(page, chain);
    expect(
      before.heads,
      `${chain}: voyageurs réellement peints dans le passage haut`,
    ).toBeGreaterThanOrEqual(COUNT / 2);
    expect(before.distinct, `${chain}: centres de tête en pixels distincts`).toBeGreaterThanOrEqual(
      6,
    );
    await page.clock.runFor(300);
    expect(await paintedState(page, chain)).toEqual(before);
    const trigger = page.getByRole('button', {
      name: `Parcourir les transactions ${name(chain)}`,
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Transactions observées ${name(chain)}` });
    const selector = dialog.getByRole('combobox');
    await expect(selector.locator('option:not([value=""])')).toHaveCount(COUNT);
    await selector.selectOption(hash(chain, 1));
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-panel').locator('.info-transaction-hash')).toHaveAttribute(
      'title',
      hash(chain, 1),
    );
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  for (const chain of ['ethereum', 'bitcoin'] as const) {
    await advanceUntilMoving(page, chain);
    await expect(wagon(page, chain).getByRole('img')).toHaveAttribute(
      'data-transaction-count',
      String(COUNT),
    );
    await expect(pane(page, chain).locator('[data-network-active]')).toHaveAttribute(
      'data-network-active',
      'false',
    );
  }
});

test('le mouvement réduit consomme toute la cohorte sans rejouer de voyageurs réseau', async ({
  page,
}) => {
  const refresh = await setup(page);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh();
  await page.clock.runFor(3_500);
  for (const chain of CHAINS) {
    expect((await paintedState(page, chain)).painted).toBe(0);
    await expect(wagon(page, chain)).toHaveAttribute('data-moving', 'false');
    await expect(wagon(page, chain)).not.toHaveAttribute('data-preparation-progress');
    await expect(pane(page, chain).locator('[data-network-active]')).toHaveAttribute(
      'data-network-active',
      'false',
    );
    await expect(pane(page, chain).locator('[data-network-door-progress]')).toHaveAttribute(
      'data-network-door-progress',
      '0',
    );
  }
});
