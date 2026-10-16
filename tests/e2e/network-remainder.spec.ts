import { expect, test, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const CHAINS: ChainId[] = ['bitcoin', 'ethereum'];
const name = (chain: ChainId) => (chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum');
const pane = (page: Page, chain: ChainId) => page.locator(`.chain-pane[data-chain="${chain}"]`);
const networkBox = (page: Page, chain: ChainId) =>
  pane(page, chain).locator(`[data-network-remainder="${chain}"]`);
const networkDoor = (page: Page, chain: ChainId) =>
  networkBox(page, chain).locator('[data-network-door="true"]');
const firstWagon = (page: Page, chain: ChainId) => pane(page, chain).locator('.street-first-wagon');
const browser = (page: Page, chain: ChainId) =>
  page.getByRole('dialog', { name: `Transactions observées ${name(chain)}` });
const hash = (chain: ChainId, index: number) =>
  `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`;

function block(chain: ChainId, next = false): Block {
  return {
    hash: hash(chain, next ? 101 : 100),
    height: 100 + Number(next),
    timestamp: NOW / 1_000 - 12 + Number(next) * 12,
    txCount: 3,
    used: chain === 'bitcoin' ? 500_000 : 30_000_000,
    capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
  };
}

function includedTransaction(chain: ChainId, identifier = 1): Tx {
  return {
    id: hash(chain, identifier),
    chain,
    status: 'confirmed',
    blockHash: block(chain, true).hash,
    feeRate: 5,
    size: chain === 'bitcoin' ? 240 : 21_000,
    kind: 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
  };
}

/** An ID alone never supplies a drawable traveler; its detail arrives one poll later. */
function snapshot(chain: ChainId, stage: number, observedAt: number, dense = false): Snapshot {
  const latest = block(chain, stage > 0);
  const waiters: Tx[] = Array.from({ length: 12 }, (_, index) => ({
    ...includedTransaction(chain, 1_000 + index),
    status: 'pending',
    blockHash: undefined,
  }));
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée pour le reste du réseau',
    observedAt,
    coverage: `Reste du réseau contrôlé étape ${stage}. L’échantillon reste partiel.`,
    pendingCount: chain === 'bitcoin' ? 12_345 : null,
    feeRate: dense && chain === 'ethereum' ? 100 : 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions: dense
      ? waiters
      : stage >= 4
        ? [includedTransaction(chain), includedTransaction(chain, 2)]
        : stage >= 2
          ? [includedTransaction(chain)]
          : [],
    blocks: [latest],
    inclusions:
      stage > 0
        ? [
            {
              block: latest,
              transactionIds:
                stage >= 4
                  ? [includedTransaction(chain).id, includedTransaction(chain, 2).id]
                  : [includedTransaction(chain).id],
            },
          ]
        : [],
    ...(dense && chain === 'bitcoin'
      ? {
          sampling: {
            source: 'Source contrôlée pour le reste du réseau',
            observedAt,
            method: 'getrawmempool',
            pendingCount: 12_345,
            update: 'full',
          },
          poolObservation: {
            source: 'Source contrôlée pour le reste du réseau',
            observedAt,
            method: 'getrawmempool',
            presentTransactionIds: waiters.map((tx) => tx.id),
            queuedTransactionIds: [],
            absentTransactionIds: [],
          },
          blockTemplate: {
            source: 'Source contrôlée pour le reste du réseau',
            observedAt,
            previousBlockHash: latest.hash,
            height: latest.height + 1,
            transactionCount: 0,
            weight: 0,
            weightLimit: 4_000_000,
            selectedTransactionIds: [],
          },
        }
      : {}),
  });
}

async function setup(page: Page, dense = false) {
  let stage = 0;
  const served = new Map<ChainId, number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain: ChainId = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    served.set(chain, stage);
    await route.fulfill({
      json: snapshot(chain, stage, await page.evaluate(() => Date.now()), dense),
    });
  });
  await page.goto('/');
  for (const chain of CHAINS)
    await expect(pane(page, chain).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Données en direct',
    );
  await page.clock.runFor(800);
  return async (nextStage: number) => {
    stage = nextStage;
    for (
      let attempt = 0;
      attempt < 25 && CHAINS.some((chain) => served.get(chain) !== stage);
      attempt += 1
    )
      await page.clock.runFor(200);
    for (const chain of CHAINS) {
      expect(served.get(chain)).toBe(stage);
      await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
        'title',
        new RegExp(`Reste du réseau contrôlé étape ${stage}\\.`),
      );
    }
  };
}

async function openBrowser(page: Page, chain: ChainId) {
  await page
    .getByRole('button', { name: `Parcourir les transactions ${name(chain)}`, exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(browser(page, chain)).toBeVisible();
  return browser(page, chain).getByRole('combobox');
}

async function expectNoIndividual(page: Page, chain: ChainId) {
  const selector = await openBrowser(page, chain);
  await expect(selector.locator(`option[value="${includedTransaction(chain).id}"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');
}

async function doorProgress(page: Page, chain: ChainId) {
  return Number(await networkDoor(page, chain).getAttribute('data-network-door-progress'));
}

async function doorLeaves(page: Page, chain: ChainId) {
  return networkDoor(page, chain)
    .locator('.network-remainder-door-leaf')
    .evaluateAll((leaves) => leaves.map((leaf) => leaf.getAttribute('transform')));
}

async function networkAppearance(page: Page, chain: ChainId) {
  return networkBox(page, chain)
    .locator('.network-remainder-body')
    .evaluate((body) => {
      const style = getComputedStyle(body);
      return { fill: style.fill, stroke: style.stroke };
    });
}

async function advanceUntil(
  page: Page,
  condition: () => Promise<boolean>,
  description: string,
  budgetMs = 4_000,
) {
  for (let elapsed = 0; elapsed <= budgetMs; elapsed += 20) {
    if (await condition()) return;
    await page.clock.runFor(20);
  }
  expect(await condition(), description).toBe(true);
}

async function allVehiclesStopped(page: Page) {
  return (
    await Promise.all(
      CHAINS.map(
        async (chain) =>
          (await pane(page, chain)
            .locator('[data-preparation-progress], [data-moving="true"], [data-arrival-progress]')
            .count()) === 0,
      ),
    )
  ).every(Boolean);
}

async function moving(page: Page, chain: ChainId) {
  return (await firstWagon(page, chain).getAttribute('data-moving')) === 'true';
}

/** A controlled visibility event tests the same public browser lifecycle as changing tabs. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function queueTopOnScreen(page: Page, chain: ChainId) {
  return pane(page, chain)
    .locator('svg.street-scene-svg')
    .evaluate((node) => {
      const svg = node as SVGSVGElement;
      const point = svg.createSVGPoint();
      // The dedicated incoming corridor must stay above the waiting area, whose top is y=200.
      point.y = 200;
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error('La scène SVG doit être attachée.');
      return point.matrixTransform(matrix).y;
    });
}

/** Observe real Canvas output without adding a production DOM element per traveler. */
async function canvasState(page: Page, chain: ChainId) {
  return pane(page, chain)
    .locator('canvas.passenger-canvas')
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Le rendu Canvas 2D est nécessaire.');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rect = canvas.getBoundingClientRect();
      let hash = 2_166_136_261;
      let painted = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;
      let solidPixels = 0;
      let solidMinX = canvas.width;
      let solidMinY = canvas.height;
      let solidMaxX = 0;
      let solidMaxY = 0;
      for (let y = 0; y < canvas.height; y += 1)
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels[offset + 3]) {
            painted += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          // Opaque body pixels locate the traveler independently of its translucent trail.
          if (pixels[offset + 3]! >= 192) {
            solidPixels += 1;
            solidMinX = Math.min(solidMinX, x);
            solidMinY = Math.min(solidMinY, y);
            solidMaxX = Math.max(solidMaxX, x);
            solidMaxY = Math.max(solidMaxY, y);
          }
          for (let channel = 0; channel < 4; channel += 1)
            hash = Math.imul(hash ^ pixels[offset + channel]!, 16_777_619);
        }
      return {
        hash: hash >>> 0,
        painted,
        solidBounds:
          solidPixels > 0
            ? {
                x: rect.x + (solidMinX / canvas.width) * rect.width,
                y: rect.y + (solidMinY / canvas.height) * rect.height,
                width: ((solidMaxX - solidMinX + 1) / canvas.width) * rect.width,
                height: ((solidMaxY - solidMinY + 1) / canvas.height) * rect.height,
              }
            : null,
        bounds:
          painted > 0
            ? {
                x: rect.x + (minX / canvas.width) * rect.width,
                y: rect.y + (minY / canvas.height) * rect.height,
                width: ((maxX - minX + 1) / canvas.width) * rect.width,
                height: ((maxY - minY + 1) / canvas.height) * rect.height,
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

test('the network remainder stays above the outer quay on both mirrored chains without claiming a pool total', async ({
  page,
}, testInfo) => {
  await setup(page, true);
  for (const chain of CHAINS) {
    const box = networkBox(page, chain);
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('role', 'group');
    await expect(box).toHaveAttribute(
      'aria-label',
      `Reste du réseau — hors échantillon · ${name(chain)}`,
    );
    await expect(box).toHaveAccessibleName(`Reste du réseau — hors échantillon · ${name(chain)}`);
    await expect(box).toHaveAttribute('data-network-active', 'false');
    await expect(box).not.toContainText(/12[\s’']?345|mempool mondial/i);
    const nodes = box.locator('[data-network-nodes="true"]');
    await expect(nodes).toBeVisible();
    expect(await nodes.locator('circle').count()).toBeGreaterThan(1);
    expect(await nodes.locator('path, line, polyline').count()).toBeGreaterThan(0);
    expect(Number(await box.getAttribute('data-network-box-width'))).toBeLessThanOrEqual(110);
    await expect(networkDoor(page, chain)).toHaveAttribute('data-network-door-open', 'false');
    expect(await doorProgress(page, chain)).toBe(0);
    expect(
      await box
        .locator('.network-remainder-body')
        .evaluate((body) => getComputedStyle(body).animationName),
    ).toBe('none');
    const boxBounds = await box.boundingBox();
    // The whole SVG wagon also includes its invisible headlight beams above the body.
    const wagonBounds = await firstWagon(page, chain)
      .locator('rect[width="85"][height="217"]')
      .boundingBox();
    expect(boxBounds).not.toBeNull();
    expect(wagonBounds).not.toBeNull();
    const paneBounds = await pane(page, chain).boundingBox();
    expect(paneBounds).not.toBeNull();
    expect(boxBounds!.width).toBeLessThan(paneBounds!.width * 0.4);
    const outerEdgeDistance =
      chain === 'bitcoin'
        ? boxBounds!.x - paneBounds!.x
        : paneBounds!.x + paneBounds!.width - boxBounds!.x - boxBounds!.width;
    expect(outerEdgeDistance).toBeGreaterThanOrEqual(-3);
    expect(outerEdgeDistance).toBeLessThan(paneBounds!.width * 0.1);
    const browseButton = pane(page, chain).getByRole('button', {
      name: `Parcourir les transactions ${name(chain)}`,
      exact: true,
    });
    await browseButton.click({ trial: true });
    const browseBounds = await browseButton.boundingBox();
    expect(browseBounds).not.toBeNull();
    const overlapWidth =
      Math.min(boxBounds!.x + boxBounds!.width, browseBounds!.x + browseBounds!.width) -
      Math.max(boxBounds!.x, browseBounds!.x);
    const overlapHeight =
      Math.min(boxBounds!.y + boxBounds!.height, browseBounds!.y + browseBounds!.height) -
      Math.max(boxBounds!.y, browseBounds!.y);
    if (overlapWidth > 0 && overlapHeight > 0)
      await page.screenshot({
        path: testInfo.outputPath('network-portal-control-overlap.png'),
        fullPage: true,
      });
    expect(
      overlapWidth <= 0 || overlapHeight <= 0,
      JSON.stringify({ chain, boxBounds, browseBounds, overlapWidth, overlapHeight }),
    ).toBe(true);
    expect(browseBounds!.width).toBeGreaterThanOrEqual(24);
    expect(browseBounds!.height).toBeGreaterThanOrEqual(24);
    for (const other of [
      pane(page, chain).locator('.info-billboard'),
      pane(page, chain).locator('.departure-timer'),
    ]) {
      const bounds = await other.boundingBox();
      expect(bounds).not.toBeNull();
      const width =
        Math.min(bounds!.x + bounds!.width, browseBounds!.x + browseBounds!.width) -
        Math.max(bounds!.x, browseBounds!.x);
      const height =
        Math.min(bounds!.y + bounds!.height, browseBounds!.y + browseBounds!.height) -
        Math.max(bounds!.y, browseBounds!.y);
      expect(width <= 0 || height <= 0).toBe(true);
    }
    expect(boxBounds!.y + boxBounds!.height).toBeLessThan(wagonBounds!.y);
    expect(boxBounds!.y + boxBounds!.height).toBeLessThan(await queueTopOnScreen(page, chain));
    const boxCenter = boxBounds!.x + boxBounds!.width / 2;
    const wagonCenter = wagonBounds!.x + wagonBounds!.width / 2;
    if (chain === 'bitcoin') expect(boxCenter).toBeLessThan(wagonCenter);
    else expect(boxCenter).toBeGreaterThan(wagonCenter);
    await expectNoIndividual(page, chain);
    const selector = await openBrowser(page, chain);
    await expect(selector.locator('option:not([value=""])')).toHaveCount(12);
    await page.keyboard.press('Escape');
    expect((await canvasState(page, chain)).painted).toBeGreaterThan(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('network-remainder-boxes.png'),
    fullPage: true,
  });
});

test('a newly received block counts a known traveler from the network box before boarding without double counting', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  const inactive = new Map(
    await Promise.all(
      CHAINS.map(async (chain) => [chain, await networkAppearance(page, chain)] as const),
    ),
  );
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(2);
  for (const chain of CHAINS) {
    await expect(firstWagon(page, chain)).toHaveAttribute('data-preparation-progress', '0');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    expect(await networkAppearance(page, chain)).not.toEqual(inactive.get(chain));
    const collective = pane(page, chain).locator('.street-block-group');
    await expect(collective).toHaveAttribute(
      'data-block-group-count',
      chain === 'bitcoin' ? '1' : '2',
    );
    await expect(collective).toHaveAttribute('data-block-individual-count', '1');
    await expect(collective).toHaveAttribute(
      'data-block-transaction-count',
      chain === 'bitcoin' ? '2' : '3',
    );
    await expect(firstWagon(page, chain).getByRole('img')).toHaveAttribute(
      'data-transaction-count',
      '0',
    );
    expect((await canvasState(page, chain)).painted).toBe(0);
    const selector = await openBrowser(page, chain);
    await expect(selector.locator(`option[value="${includedTransaction(chain).id}"]`)).toHaveCount(
      1,
    );
    await page.keyboard.press('Escape');
  }
  await page.screenshot({
    path: testInfo.outputPath('network-remainder-counted-before-boarding.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  await page.clock.runFor(350);
  for (const chain of CHAINS) {
    const collective = pane(page, chain).locator('.street-block-group');
    await expect(collective).toHaveAttribute(
      'data-block-group-count',
      chain === 'bitcoin' ? '1' : '2',
    );
    await expect(collective).toHaveAttribute('data-block-individual-count', '1');
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
  }
  await advanceUntil(
    page,
    () => moving(page, 'ethereum'),
    'Ethereum doit partir après sa préparation.',
  );
  await expect(firstWagon(page, 'bitcoin')).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page, 'bitcoin')).toHaveAttribute(
    'data-preparation-progress',
    /^[0-9.]+$/,
  );
  expect(
    Number(await firstWagon(page, 'bitcoin').getAttribute('data-preparation-progress')),
  ).toBeLessThan(1);
  for (const chain of ['ethereum', 'bitcoin'] as const) {
    await advanceUntil(
      page,
      () => moving(page, chain),
      `${name(chain)} doit terminer sa préparation.`,
    );
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'true');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'false');
    expect(await networkAppearance(page, chain)).toEqual(inactive.get(chain));
    await expect(firstWagon(page, chain).getByRole('img')).toHaveAttribute(
      'data-transaction-count',
      '1',
    );
    await expect(pane(page, chain).locator('.street-block-group')).toHaveAttribute(
      'data-block-group-count',
      chain === 'bitcoin' ? '1' : '2',
    );
  }
});

test('late detailed inclusions emerge from the remainder and board once without replaying the complete collective block', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  const inactive = new Map(
    await Promise.all(
      CHAINS.map(async (chain) => [chain, await networkAppearance(page, chain)] as const),
    ),
  );
  await refresh(1);
  for (const chain of CHAINS) {
    await expectNoIndividual(page, chain);
    expect((await canvasState(page, chain)).painted).toBe(0);
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'false');
    expect(await networkAppearance(page, chain)).toEqual(inactive.get(chain));
    await expect(pane(page, chain).locator('.street-block-group')).toHaveAttribute(
      'data-block-group-count',
      chain === 'bitcoin' ? '2' : '3',
    );
  }
  await advanceUntil(
    page,
    () => allVehiclesStopped(page),
    'Les départs sans détails doivent finir.',
    6_500,
  );
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(2);
  const starts = new Map<ChainId, Awaited<ReturnType<typeof canvasState>>>();
  const closedLeaves = new Map<ChainId, Awaited<ReturnType<typeof doorLeaves>>>();
  const activeAppearance = new Map<ChainId, Awaited<ReturnType<typeof networkAppearance>>>();
  for (const chain of CHAINS) {
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
    await expect(firstWagon(page, chain)).toHaveAttribute('data-preparation-progress', '0');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    expect(await networkAppearance(page, chain)).not.toEqual(inactive.get(chain));
    const selector = await openBrowser(page, chain);
    await expect(selector.locator('option:not([value=""])')).toHaveCount(1);
    await selector.selectOption(includedTransaction(chain).id);
    const description = browser(page, chain).locator('.passenger-canvas-browser-description');
    await expect(description).toContainText('Inclusion découverte hors de l’échantillon');
    await expect(description).toContainText('reste du réseau');
    await expect(description).not.toContainText('stock initial observé');
    await page.keyboard.press('Escape');
    const start = await canvasState(page, chain);
    starts.set(chain, start);
    closedLeaves.set(chain, await doorLeaves(page, chain));
    activeAppearance.set(chain, await networkAppearance(page, chain));
    expect(
      await networkBox(page, chain)
        .locator('.network-remainder-body')
        .evaluate((body) => getComputedStyle(body).animationName),
    ).toBe('none');
    expect(start.painted).toBe(0);
    expect(start.solidBounds).toBeNull();
    await expect(pane(page, chain).locator('.street-block-group')).toHaveCount(0);
    await expect(firstWagon(page, chain)).toContainText('INCLUSIONS RETROUVÉES');
  }
  await page.clock.runFor(500);
  for (const chain of CHAINS) {
    expect(await canvasState(page, chain)).toEqual(starts.get(chain));
    expect(await doorProgress(page, chain)).toBe(0);
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    expect(await networkAppearance(page, chain)).toEqual(activeAppearance.get(chain));
  }
  await page.screenshot({
    path: testInfo.outputPath('network-remainder-paused-origin.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  // Light is already on while the door and the unseen traveler still wait.
  await page.clock.runFor(100);
  for (const chain of CHAINS) {
    expect(await doorProgress(page, chain)).toBe(0);
    expect((await canvasState(page, chain)).painted).toBe(0);
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
  }
  await page.screenshot({
    path: testInfo.outputPath('network-prelude-light-before-door.png'),
    fullPage: true,
  });
  for (let step = 0; step < 8; step += 1) {
    if ((await Promise.all(CHAINS.map((chain) => doorProgress(page, chain)))).every((p) => p > 0))
      break;
    await page.clock.runFor(20);
  }
  const openingProgress = new Map<ChainId, number>();
  for (const chain of CHAINS) {
    const progress = await doorProgress(page, chain);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    openingProgress.set(chain, progress);
    expect(await doorLeaves(page, chain)).not.toEqual(closedLeaves.get(chain));
    await expect(networkDoor(page, chain)).toHaveAttribute('data-network-door-open', 'true');
    expect(await canvasState(page, chain)).toEqual(starts.get(chain));
  }
  await page.screenshot({
    path: testInfo.outputPath('network-portal-partial-opening.png'),
    fullPage: true,
  });
  await setHidden(page, true);
  await page.clock.runFor(300);
  for (const chain of CHAINS) {
    expect(await canvasState(page, chain)).toEqual(starts.get(chain));
    expect(await doorProgress(page, chain)).toBe(openingProgress.get(chain));
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    expect(await networkAppearance(page, chain)).toEqual(activeAppearance.get(chain));
  }
  await setHidden(page, false);
  for (let step = 0; step < 8; step += 1) {
    if ((await Promise.all(CHAINS.map((chain) => doorProgress(page, chain)))).every((p) => p === 1))
      break;
    await page.clock.runFor(20);
  }
  for (const chain of CHAINS) {
    expect(await doorProgress(page, chain)).toBe(1);
    expect((await canvasState(page, chain)).painted).toBe(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('network-portal-open.png'),
    fullPage: true,
  });
  await page.clock.runFor(80);
  for (const chain of CHAINS) {
    expect(await doorProgress(page, chain)).toBe(1);
    expect((await canvasState(page, chain)).painted).toBe(0);
  }
  await advanceUntil(
    page,
    async () =>
      (await Promise.all(CHAINS.map((chain) => canvasState(page, chain)))).every(
        (state) => state.solidBounds !== null,
      ),
    'Les voyageurs doivent apparaître après le prélude porte ouverte.',
    400,
  );
  const births = new Map<ChainId, Awaited<ReturnType<typeof canvasState>>>();
  for (const chain of CHAINS) {
    const birth = await canvasState(page, chain);
    births.set(chain, birth);
    const box = await networkBox(page, chain).boundingBox();
    expect(birth.solidBounds!.x + birth.solidBounds!.width / 2).toBeGreaterThan(box!.x - 5);
    expect(birth.solidBounds!.x + birth.solidBounds!.width / 2).toBeLessThan(
      box!.x + box!.width + 5,
    );
    expect(await doorProgress(page, chain)).toBe(1);
  }
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await page.clock.runFor(300);
  for (const chain of CHAINS) expect(await canvasState(page, chain)).toEqual(births.get(chain));
  await page.screenshot({
    path: testInfo.outputPath('network-portal-first-travelers.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();

  // The two chains have different preparation windows, so observe each passage separately.
  for (const chain of ['ethereum', 'bitcoin'] as const) {
    const box = await networkBox(page, chain).locator('.network-remainder-body').boundingBox();
    await advanceUntil(
      page,
      async () => {
        const solid = (await canvasState(page, chain)).solidBounds;
        return Boolean(
          solid &&
          (chain === 'bitcoin' ? solid.x > box!.x + box!.width : solid.x + solid.width < box!.x),
        );
      },
      `${name(chain)} doit dégager entièrement sa porte réseau.`,
      1_800,
    );
    expect(await doorProgress(page, chain)).toBe(1);
    await page.clock.runFor(80);
    expect(await doorProgress(page, chain)).toBe(1);
    const walking = await canvasState(page, chain);
    expect(walking.bounds!.y + walking.bounds!.height).toBeLessThan(
      await queueTopOnScreen(page, chain),
    );
    const body = await firstWagon(page, chain)
      .locator('rect[width="85"][height="217"]')
      .boundingBox();
    if (chain === 'bitcoin')
      expect(walking.bounds!.x + walking.bounds!.width).toBeLessThan(body!.x);
    else expect(walking.bounds!.x).toBeGreaterThan(body!.x + body!.width);
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    expect(await networkAppearance(page, chain)).toEqual(activeAppearance.get(chain));
    await page.screenshot({
      path: testInfo.outputPath(`network-portal-${chain}-open-after-passage.png`),
      fullPage: true,
    });
  }
  await advanceUntil(
    page,
    async () =>
      (await Promise.all(CHAINS.map((chain) => doorProgress(page, chain)))).every((p) => p === 0),
    'Les portes réseau doivent se refermer après leur maintien.',
    1_000,
  );
  for (const chain of CHAINS) {
    expect(await doorLeaves(page, chain)).toEqual(closedLeaves.get(chain));
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
  }
  await page.screenshot({
    path: testInfo.outputPath('network-remainder-platform-route.png'),
    fullPage: true,
  });
  await advanceUntil(
    page,
    () => moving(page, 'ethereum'),
    'Ethereum doit partir après 1,5 seconde.',
  );
  await expect(firstWagon(page, 'bitcoin')).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page, 'bitcoin')).toHaveAttribute(
    'data-preparation-progress',
    /^[0-9.]+$/,
  );
  for (const chain of ['ethereum', 'bitcoin'] as const) {
    await advanceUntil(
      page,
      () => moving(page, chain),
      `${name(chain)} doit partir après sa préparation.`,
    );
    expect(await doorProgress(page, chain)).toBe(0);
    await expect(networkDoor(page, chain)).toHaveAttribute('data-network-door-open', 'false');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'false');
    expect(await networkAppearance(page, chain)).toEqual(inactive.get(chain));
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'true');
    await expect(firstWagon(page, chain).getByRole('img')).toHaveAttribute(
      'data-transaction-count',
      '1',
    );
  }
  await advanceUntil(
    page,
    () => allVehiclesStopped(page),
    'Les deux chaînes doivent retrouver des wagons arrêtés.',
    3_000,
  );
  await refresh(3);
  await page.clock.runFor(3_500);
  for (const chain of CHAINS) {
    await expectNoIndividual(page, chain);
    await expect(pane(page, chain).locator('[data-preparation-progress]')).toHaveCount(0);
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
  }
  // A second newly detailed hash of the same block also recovers only its own individual.
  await page.getByRole('button', { name: 'Mettre l’animation en pause', exact: true }).click();
  await refresh(4);
  for (const chain of CHAINS) {
    await expect(firstWagon(page, chain)).toHaveAttribute('data-preparation-progress', '0');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'true');
    await expect(firstWagon(page, chain)).toContainText('INCLUSIONS RETROUVÉES');
    await expect(pane(page, chain).locator('.street-block-group')).toHaveCount(0);
    const selector = await openBrowser(page, chain);
    await expect(selector.locator('option:not([value=""])')).toHaveCount(1);
    await expect(
      selector.locator(`option[value="${includedTransaction(chain, 2).id}"]`),
    ).toHaveCount(1);
    await expect(selector.locator(`option[value="${includedTransaction(chain).id}"]`)).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Reprendre l’animation', exact: true }).click();
  for (const chain of ['ethereum', 'bitcoin'] as const) {
    await advanceUntil(
      page,
      () => moving(page, chain),
      `${name(chain)} doit terminer son rattrapage.`,
    );
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'true');
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'false');
    await expect(pane(page, chain).locator('.street-block-group')).toHaveCount(0);
  }
});

test('reduced motion consumes late detailed inclusions without replaying a traveler or a collective departure', async ({
  page,
}, testInfo) => {
  const refresh = await setup(page);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh(1);
  await refresh(2);
  for (const chain of CHAINS) {
    await expectNoIndividual(page, chain);
    await expect(pane(page, chain).locator('[data-preparation-progress]')).toHaveCount(0);
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
    await expect(pane(page, chain).locator('.street-block-group')).toHaveCount(0);
    await expect(networkDoor(page, chain)).toHaveAttribute('data-network-door-open', 'false');
    expect(await doorProgress(page, chain)).toBe(0);
    await expect(networkBox(page, chain)).toHaveAttribute('data-network-active', 'false');
  }
  await refresh(3);
  await page.clock.runFor(3_500);
  for (const chain of CHAINS) {
    await expectNoIndividual(page, chain);
    await expect(firstWagon(page, chain)).toHaveAttribute('data-moving', 'false');
    await expect(networkBox(page, chain)).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath('network-remainder-reduced.png'),
    fullPage: true,
  });
});
