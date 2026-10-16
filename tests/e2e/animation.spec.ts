import { expect, test, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page, chain: ChainId = 'bitcoin') =>
  page.locator(`section.chain-pane[data-chain="${chain}"]`);
const firstWagon = (page: Page, chain: ChainId = 'bitcoin') =>
  pane(page, chain).locator('.street-first-wagon');
const browser = (page: Page, chain: ChainId = 'bitcoin') =>
  page.getByRole('dialog', {
    name: `Transactions observées ${chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
  });

function transaction(chain: ChainId, index: number, feeRate: number, size: number): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`,
    chain,
    feeRate,
    size,
    status: 'pending',
    kind: chain === 'ethereum' && size > 21_000 ? 'contract' : 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
  };
}

function block(chain: ChainId, offset = 0): Block {
  return {
    hash: `${chain === 'ethereum' ? '0x' : ''}${(100 + offset).toString(16).padStart(64, '0')}`,
    height: (chain === 'bitcoin' ? 900_000 : 23_000_000) + offset,
    timestamp: OBSERVED_AT / 1_000 - 12 + offset * 12,
    txCount: 100,
    used: chain === 'bitcoin' ? 500_000 : 30_000_000,
    capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
  };
}

/** Explicit live observations, with confirmed IDs supplied only by the relevant scenario. */
function liveSnapshot(
  chain: ChainId,
  transactions: Tx[],
  stage = 0,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Source contrôlée pour les animations',
    observedAt: OBSERVED_AT + stage * 3_000,
    coverage: `Animation contrôlée étape ${stage}. Échantillon partiel ; seul un identifiant exact prouve une inclusion.`,
    pendingCount: chain === 'ethereum' ? null : 4_200,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [block(chain)],
    inclusions: [],
    ...overrides,
  });
}

async function routeSnapshots(page: Page, current: (chain: ChainId, stage: number) => Snapshot) {
  let stage = 0;
  const fetched = new Map<ChainId, Set<number>>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const stages = fetched.get(chain) ?? new Set<number>();
    stages.add(stage);
    fetched.set(chain, stages);
    await route.fulfill({ json: current(chain, stage) });
  });
  return async (nextStage: number, chain: ChainId = 'bitcoin') => {
    stage = nextStage;
    for (let attempt = 0; attempt < 20 && !fetched.get(chain)?.has(stage); attempt += 1)
      await page.clock.runFor(200);
    expect(fetched.get(chain)?.has(stage)).toBe(true);
    await expect(pane(page, chain).locator('.chain-coverage')).toHaveAttribute(
      'title',
      new RegExp(`Animation contrôlée étape ${stage}\\.`),
    );
  };
}

async function openTraveler(page: Page, tx: Tx) {
  const dialog = browser(page, tx.chain);
  if (!(await dialog.count())) {
    await page
      .getByRole('button', {
        name: `Parcourir les transactions ${tx.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}`,
      })
      .focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox')).toBeFocused();
  }
  const selector = dialog.getByRole('combobox');
  await expect(selector.locator(`option[value="${tx.id}"]`)).toHaveCount(1);
  await selector.selectOption(tx.id);
  return dialog.locator('.passenger-canvas-browser-description');
}

async function closeBrowser(page: Page, chain: ChainId = 'bitcoin') {
  await browser(page, chain).getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page, chain)).toHaveCount(0);
}

async function showDetails(page: Page, tx: Tx) {
  await openTraveler(page, tx);
  await browser(page, tx.chain).getByRole('button', { name: 'Afficher les détails' }).focus();
  await page.keyboard.press('Enter');
  await closeBrowser(page, tx.chain);
  await expect(page.getByTestId('info-panel')).toHaveAttribute('data-page', 'transaction');
  await expect(page.getByTestId('info-panel').locator('.info-transaction-hash')).toHaveAttribute(
    'title',
    tx.id,
  );
}

/** Fingerprint the real traveler bitmap without creating an element per avatar. */
async function canvasFingerprint(page: Page, chain: ChainId = 'bitcoin') {
  return pane(page, chain)
    .locator('canvas.passenger-canvas')
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Le dessin Canvas 2D doit être disponible.');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2_166_136_261;
      let painted = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3]) painted += 1;
        for (let offset = 0; offset < 4; offset += 1)
          hash = Math.imul(hash ^ pixels[index + offset]!, 16_777_619);
      }
      return { hash: hash >>> 0, painted };
    });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: OBSERVED_AT });
  await page.clock.pauseAt(OBSERVED_AT + 100);
});

test('a Canvas traveler walks to the candidate wagon and boarding never confirms a live transaction', async ({
  page,
}) => {
  const tx = transaction('bitcoin', 1, 20, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  const description = await openTraveler(page, tx);
  await expect(description).toContainText(/sur le quai|en marche/);
  const start = await canvasFingerprint(page);
  expect(start.painted).toBeGreaterThan(0);
  await page.clock.runFor(1_000);
  await expect(description).toContainText('en marche');
  expect(await canvasFingerprint(page)).not.toEqual(start);
  await page.clock.runFor(7_000);
  await expect(description).toContainText('à bord du wagon illustratif');
  await expect(description).toContainText('en attente dans la source');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '1');
  await showDetails(page, tx);
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(pane(page).locator('[data-preparation-progress]')).toHaveCount(0);
});

test('native block-capacity competition returns a lower-fee rider to the quay without inventing rejection', async ({
  page,
}) => {
  const target = transaction('bitcoin', 1, 2, 400_000);
  const peers = [transaction('bitcoin', 2, 20, 600_000), transaction('bitcoin', 3, 25, 1_000_000)];
  const arrival = transaction('bitcoin', 50, 30, 700_000);
  const refresh = await routeSnapshots(page, (chain, stage) =>
    liveSnapshot(
      chain,
      chain === 'bitcoin' ? [target, ...peers, ...(stage ? [arrival] : [])] : [],
      stage,
    ),
  );
  await page.goto('/');
  const description = await openTraveler(page, target);
  await page.clock.runFor(9_000);
  await expect(description).toContainText('à bord du wagon illustratif');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-resource-used', '1000000');
  await closeBrowser(page);
  await refresh(1);
  const returning = await openTraveler(page, target);
  await expect(returning).toContainText(/sortie illustrée|retour en file illustré/);
  await page.clock.runFor(7_000);
  await expect(returning).toContainText('sur le quai');
  await expect(returning).toContainText('Capacité insuffisante');
  await expect(returning).toContainText('en attente dans la source');
  await showDetails(page, target);
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
});

test('an Ethereum traveler below the next-block base fee stays waiting instead of simulating rejection', async ({
  page,
}) => {
  const tx = transaction('ethereum', 1, 1, 21_000);
  await routeSnapshots(page, (chain) =>
    liveSnapshot(
      chain,
      chain === 'ethereum' ? [tx] : [],
      0,
      chain === 'ethereum'
        ? {
            feeRate: 8,
            ethereumProjection: {
              parentBlockHash: block(chain).hash,
              height: block(chain).height + 1,
              observedAt: OBSERVED_AT,
              baseFeePerGasWei: '10000000000',
              source: 'calculated',
            },
          }
        : {},
    ),
  );
  await page.goto('/');
  const description = await openTraveler(page, tx);
  await expect(description).toContainText('sur le quai');
  await expect(description).toContainText('Frais inférieurs à la base fee Ethereum de référence');
  await page.clock.runFor(12_000);
  await expect(description).toContainText('sur le quai');
  await expect(firstWagon(page, 'ethereum').getByRole('img')).toHaveAttribute(
    'data-transaction-count',
    '0',
  );
  await showDetails(page, tx);
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('info-panel')).toContainText(
    'Un déplacement animé ne prouve aucune confirmation.',
  );
});

test('Canvas head drawing scales with bounded virtual bytes or declared gas and sizes stay inspectable', async ({
  page,
}, testInfo) => {
  // Capture real local head transforms; no app state, SVG avatars or production instrumentation.
  await page.addInitScript(() => {
    const capture = window as typeof window & { renderedHeadScales: Record<string, number[]> };
    capture.renderedHeadScales = {};
    const atHead = new WeakSet<CanvasRenderingContext2D>();
    const translate = CanvasRenderingContext2D.prototype.translate;
    const scale = CanvasRenderingContext2D.prototype.scale;
    CanvasRenderingContext2D.prototype.translate = function (x, y) {
      if (x === 0 && y === -22) atHead.add(this);
      else atHead.delete(this);
      return translate.call(this, x, y);
    };
    CanvasRenderingContext2D.prototype.scale = function (x, y) {
      if (atHead.has(this) && x === y && this.canvas.classList.contains('passenger-canvas')) {
        const chain = this.canvas.closest<HTMLElement>('[data-chain]')?.dataset.chain;
        if (chain) {
          const values = capture.renderedHeadScales[chain] ?? [];
          if (!values.includes(x)) values.push(x);
          capture.renderedHeadScales[chain] = values;
        }
      }
      atHead.delete(this);
      return scale.call(this, x, y);
    };
  });
  const pairs = [
    [transaction('bitcoin', 1, 20, 140), transaction('bitcoin', 2, 10, 1_140)],
    [transaction('ethereum', 1, 20, 21_000), transaction('ethereum', 2, 10, 240_000)],
  ] as const;
  await routeSnapshots(page, (chain) =>
    liveSnapshot(chain, chain === 'bitcoin' ? [...pairs[0]] : [...pairs[1]]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  for (const [small, large] of pairs) {
    await expect
      .poll(async () =>
        page.evaluate(
          (chain) =>
            (window as typeof window & { renderedHeadScales: Record<string, number[]> })
              .renderedHeadScales[chain]?.length ?? 0,
          small.chain,
        ),
      )
      .toBe(2);
    const scales = await page.evaluate(
      (chain) =>
        (window as typeof window & { renderedHeadScales: Record<string, number[]> })
          .renderedHeadScales[chain]!,
      small.chain,
    );
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...scales)).toBeGreaterThanOrEqual(Math.min(...scales) * 2);
    expect(Math.max(...scales)).toBeLessThanOrEqual(2.5);
    expect((await canvasFingerprint(page, small.chain)).painted).toBeGreaterThan(0);
    for (const tx of [small, large]) {
      await showDetails(page, tx);
      const detail = page
        .getByTestId('info-panel')
        .locator('.info-detail')
        .filter({
          hasText: tx.chain === 'bitcoin' ? 'Taille virtuelle' : 'Limite de gas déclarée',
        });
      expect((await detail.locator('dd').innerText()).replace(/['’\s\u00a0\u202f]/g, '')).toBe(
        `${tx.size}${tx.chain === 'bitcoin' ? 'vB' : 'gas'}`,
      );
    }
  }
  await expect(page.getByTestId('info-panel')).toContainText(
    'La tête représente la limite de gas déclarée, pas les octets ni le gas consommé.',
  );
  await page.screenshot({ path: testInfo.outputPath('canvas-resource-heads.png'), fullPage: true });
});

test('pause freezes actual Canvas pixels and reduced motion settles the traveler without animation', async ({
  page,
}) => {
  const tx = transaction('bitcoin', 1, 20, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  await openTraveler(page, tx);
  await page.clock.runFor(2_000);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  const paused = await canvasFingerprint(page);
  expect(paused.painted).toBeGreaterThan(0);
  await page.clock.runFor(3_000);
  expect(await canvasFingerprint(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(500);
  expect(await canvasFingerprint(page)).not.toEqual(paused);
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'à bord du wagon illustratif',
  );
  const reduced = await canvasFingerprint(page);
  await page.clock.runFor(3_000);
  expect(await canvasFingerprint(page)).toEqual(reduced);
});

test('the information panel cycles every four seconds and respects pause and reduced motion', async ({
  page,
}) => {
  const tx = transaction('bitcoin', 1, 20, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Afficher le panneau d’informations' }).click();
  const panel = page.getByTestId('info-panel');
  await expect(panel).toHaveAttribute('data-page', 'network');
  await expect(panel).toHaveAttribute('data-auto-rotating', 'true');
  await page.clock.runFor(4_100);
  await expect(panel).toHaveAttribute('data-page', 'block');
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(8_000);
  await expect(panel).toHaveAttribute('data-page', 'block');
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(4_100);
  await expect(panel).toHaveAttribute('data-page', 'travelers');
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(8_000);
  await expect(panel).toHaveAttribute('data-page', 'travelers');
  await page.getByRole('button', { name: 'Masquer le panneau d’informations' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Afficher le panneau d’informations' }).click();
  await expect(panel).toHaveAttribute('data-page', 'network');
});

test('keyboard-selected details follow observations and information tabs support keyboard inspection', async ({
  page,
}) => {
  const refresh = await routeSnapshots(page, (chain, stage) =>
    liveSnapshot(chain, [transaction(chain, 1, stage ? 30 : 20, stage ? 800 : 200)], stage),
  );
  await page.goto('/');
  await showDetails(page, transaction('bitcoin', 1, 20, 200));
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByText('20 sat/vB', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await refresh(1);
  await expect(panel.getByText('30 sat/vB', { exact: true })).toBeVisible();
  await expect(panel.getByText('800 vB', { exact: true })).toBeVisible();
  await expect(panel.getByText('En attente', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-page', 'transaction');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Afficher le panneau d’informations', exact: true })
    .click();
  await expect(panel).toHaveAttribute('data-page', 'network');
  await panel.getByRole('tab', { name: 'Réseau', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('tab', { name: 'Bloc', exact: true })).toBeFocused();
  await expect(panel).toHaveAttribute('data-page', 'block');
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(8_000);
  await expect(panel).toHaveAttribute('data-page', 'block');
});

test('a real block departure carries only exact proved IDs and leaves unproved riders available', async ({
  page,
}, testInfo) => {
  const included = transaction('bitcoin', 1, 20, 200);
  const waiting = transaction('bitcoin', 2, 15, 200);
  const refresh = await routeSnapshots(page, (chain, stage) => {
    const latest = block(chain, chain === 'bitcoin' ? stage : 0);
    const transactions =
      chain === 'bitcoin'
        ? stage >= 2
          ? [{ ...waiting, status: 'confirmed' as const, blockHash: latest.hash }]
          : [
              {
                ...included,
                ...(stage === 1 ? { status: 'confirmed' as const, blockHash: latest.hash } : {}),
              },
              waiting,
            ]
        : [];
    return liveSnapshot(chain, transactions, stage, {
      blocks: [latest],
      inclusions:
        chain === 'bitcoin' && stage > 0
          ? [
              { block: block(chain, 1), transactionIds: [included.id] },
              ...(stage >= 2 ? [{ block: latest, transactionIds: [waiting.id] }] : []),
            ]
          : [],
    });
  });
  await page.goto('/');
  const description = await openTraveler(page, included);
  await page.clock.runFor(9_000);
  await expect(description).toContainText('à bord du wagon illustratif');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '2');
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await closeBrowser(page);
  await refresh(1);
  await expect(firstWagon(page)).toHaveAttribute('data-preparation-progress', /^[0-9.]+$/);
  await page.clock.runFor(1_150);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await page.clock.runFor(2_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '1');
  await expect(firstWagon(page, 'ethereum')).toHaveAttribute('data-moving', 'false');
  await expect(await openTraveler(page, waiting)).toContainText('en attente dans la source');
  await expect(
    browser(page).getByRole('combobox').locator(`option[value="${included.id}"]`),
  ).toHaveCount(0);
  await closeBrowser(page);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  const position = await firstWagon(page).getAttribute('transform');
  const paused = await canvasFingerprint(page);
  await page.clock.runFor(500);
  expect(await firstWagon(page).getAttribute('transform')).toBe(position);
  expect(await canvasFingerprint(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(500);
  expect(await firstWagon(page).getAttribute('transform')).not.toBe(position);
  await page.clock.runFor(6_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '1');
  await showDetails(page, waiting);
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page).getByRole('img')).toHaveAttribute('data-transaction-count', '0');
  await page.getByRole('button', { name: 'Masquer le panneau d’informations' }).click();
  await page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' }).click();
  await expect(browser(page).getByRole('combobox')).toBeDisabled();
  await expect(
    browser(page).getByRole('combobox').locator(`option[value="${waiting.id}"]`),
  ).toHaveCount(0);
  await closeBrowser(page);
  await page.screenshot({
    path: testInfo.outputPath('proved-only-departures.png'),
    fullPage: true,
  });
});
