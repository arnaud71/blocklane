import { expect, test, type Page } from '@playwright/test';
import { generateDemoSnapshot } from '../../server/demo';
import type { ChainId, Snapshot } from '../../shared/model';

const chains = ['bitcoin', 'ethereum'] as const;
const pane = (page: Page, chain: ChainId) =>
  page.locator(`section.chain-pane[data-chain="${chain}"]`);

function liveSnapshot(chain: ChainId, observedAt = Date.now()): Snapshot {
  const demo = generateDemoSnapshot(chain, observedAt);
  return {
    ...demo,
    mode: 'live',
    source: 'Fournisseur de test',
    pendingCount: chain === 'ethereum' ? null : 4_320,
    coverage: 'Échantillon de test, couverture partielle.',
    transactions: demo.transactions.map((tx, index) => ({
      ...tx,
      id: `${chain === 'ethereum' ? '0x' : ''}${(index + 1).toString(16).padStart(64, '0')}`,
    })),
    blocks: demo.blocks.map((block, index) => ({
      ...block,
      hash: `${chain === 'ethereum' ? '0x' : ''}${(index + 100).toString(16).padStart(64, '0')}`,
    })),
  };
}

async function routeSnapshots(
  page: Page,
  current: (chain: ChainId, mode: 'live' | 'demo') => unknown,
) {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    await route.fulfill({ json: current(chain, mode) });
  });
}

async function inspectFirstTraveler(page: Page, chain: ChainId = 'bitcoin') {
  await pane(page, chain).locator('.street-person').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('info-panel')).toHaveAttribute('data-page', 'transaction');
}

test.beforeEach(async ({ page }) => {
  await routeSnapshots(page, (chain, mode) =>
    mode === 'demo' ? generateDemoSnapshot(chain, Date.now()) : liveSnapshot(chain),
  );
});

test('both bounded live scenes share the viewport and chain focus never hides a scene', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveText('Données en direct');
    await expect(
      pane(page, chain).getByRole('heading', {
        name: chain === 'bitcoin' ? 'Bitcoin Avenue' : 'Ethereum Avenue',
      }),
    ).toBeVisible();
    await expect(pane(page, chain).locator('.street-person')).toHaveCount(80);
  }
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  const ethereumFocus = page.locator('.chain-tabs').getByRole('button', { name: /Ethereum/ });
  await ethereumFocus.click();
  await expect(ethereumFocus).toHaveAttribute('aria-pressed', 'true');
  await expect(pane(page, 'bitcoin').locator('.street-scene')).toBeVisible();
  await expect(
    pane(page, 'ethereum').locator('.chain-metrics div').filter({ hasText: 'Mempool global' }),
  ).toContainText('Non mesuré');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport nécessaire pour vérifier le mode immersif.');
  const boxes = await Promise.all(
    chains.map((chain) => pane(page, chain).locator('.street-scene').boundingBox()),
  );
  let animatedArea = 0;
  for (const box of boxes) {
    if (!box) throw new Error('Les deux scènes doivent être visibles dans la fenêtre.');
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.height).toBeGreaterThanOrEqual(100);
    animatedArea += box.width * box.height;
  }
  if (viewport.width > 700) {
    expect(animatedArea).toBeGreaterThan(viewport.width * viewport.height * 0.5);
  }
  const appBox = await page.locator('.immersive-app').boundingBox();
  const streetsBox = await page.locator('.twin-streets').boundingBox();
  if (!appBox || !streetsBox) throw new Error('La vue immersive doit être attachée au viewport.');
  expect(appBox.x).toBe(0);
  expect(appBox.y).toBe(0);
  expect(appBox.width).toBeCloseTo(viewport.width, 0);
  expect(appBox.height).toBeCloseTo(viewport.height, 0);
  expect(streetsBox.width * streetsBox.height).toBeGreaterThan(
    viewport.width * viewport.height * 0.65,
  );
  for (const chain of chains) {
    const scene = await pane(page, chain).locator('.street-scene').boundingBox();
    const stage = await pane(page, chain).locator('.scene-stage').boundingBox();
    if (!scene || !stage) throw new Error('Chaque animation doit remplir son quai.');
    expect(scene.width).toBeCloseTo(stage.width, 0);
    expect(scene.height).toBeCloseTo(stage.height, 0);
  }
  const [bitcoin, ethereum] = boxes;
  if (!bitcoin || !ethereum) throw new Error('Deux scènes attendues.');
  expect(
    bitcoin.x + bitcoin.width <= ethereum.x + 1 || bitcoin.y + bitcoin.height <= ethereum.y + 1,
  ).toBe(true);
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
    vertical: document.documentElement.scrollHeight > window.innerHeight + 1,
  }));
  expect(overflow).toEqual({ horizontal: false, vertical: false });
  expect(errors).toEqual([]);
});

test('keyboard traveler inspection opens the shared panel with real-mode explorer links', async ({
  page,
}) => {
  await page.goto('/');
  await inspectFirstTraveler(page);
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByRole('link', { name: /Explorer cette transaction/ })).toHaveAttribute(
    'href',
    /^https:\/\/mempool.space\/tx\/[0-9a-f]{64}$/,
  );
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-page', 'network');
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  for (const chain of chains)
    await expect(pane(page, chain).getByRole('status')).toHaveText('Simulation pédagogique');
  await inspectFirstTraveler(page);
  await expect(panel.getByText('Données fictives : aucun lien réseau.')).toBeVisible();
  await expect(panel.getByRole('link', { name: /Explorer cette transaction/ })).toHaveCount(0);
});

test('pause, reduced motion, speed, learning and branding apply to both scenes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  for (const chain of chains)
    await expect(pane(page, chain).locator('.street-scene')).toHaveClass(/reduced-motion/);
  await page.getByRole('button', { name: 'Mouvements réduits' }).click();
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await page.getByRole('combobox', { name: 'Vitesse de simulation' }).selectOption('2');
  for (const chain of chains) {
    const scene = pane(page, chain).locator('.street-scene');
    await expect(scene).not.toHaveClass(/reduced-motion/);
    await expect(scene).toHaveClass(/paused/);
    await expect(scene).toHaveAttribute('style', /9s/);
  }
  await page.getByRole('button', { name: 'Identité : HEG' }).click();
  await expect(page.locator('.app')).toHaveClass(/theme-neutral/);
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await page.getByRole('button', { name: 'Plein écran', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement))
      .toBe(true);
    await expect(pane(page, 'bitcoin').locator('.street-scene')).toBeVisible();
    await expect(pane(page, 'ethereum').locator('.street-scene')).toBeVisible();
    await page.getByRole('button', { name: 'Quitter le plein écran' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  }
  const learnButton = page.getByRole('button', { name: 'Comprendre', exact: true });
  await learnButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Retourner dans la ville/ })).toBeFocused();
  await expect(page.locator('.twin-streets')).toHaveAttribute('inert', '');
  await expect(page.getByRole('heading', { name: 'Un mempool est une vue locale' })).toBeVisible();
  await page
    .getByRole('button', { name: /Retourner dans la ville/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Bitcoin Avenue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ethereum Avenue' })).toBeVisible();
  await page.getByRole('button', { name: 'Les données', exact: true }).click();
  await expect(page.getByText('Fournisseur de test', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Simulation pédagogique · données fictives', { exact: true }),
  ).toBeVisible();
});

test('invalid upstream payload never silently becomes simulated data', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  await routeSnapshots(page, (chain) => ({ chain, mode: 'live', transactions: 'invalid' }));
  await page.goto('/');
  for (const chain of chains) {
    await expect(
      pane(page, chain).getByRole('heading', { name: 'Le réseau se fait attendre.' }),
    ).toBeVisible();
    await expect(pane(page, chain).locator('.street-person')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('one unavailable chain leaves the other live and offers an explicit demo choice', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  await routeSnapshots(page, (chain, mode) => {
    if (mode === 'demo') return generateDemoSnapshot(chain, Date.now());
    const snapshot = liveSnapshot(chain);
    return chain === 'ethereum'
      ? {
          ...snapshot,
          status: 'unavailable',
          transactions: [],
          blocks: [],
          pendingCount: null,
          feeRate: null,
          coverage: 'Aucune donnée validée disponible.',
          message: 'Le fournisseur est indisponible.',
        }
      : snapshot;
  });
  await page.goto('/');
  await expect(pane(page, 'ethereum').getByRole('status')).toHaveText('Source indisponible');
  await expect(pane(page, 'ethereum').locator('.street-person')).toHaveCount(0);
  await expect(pane(page, 'bitcoin').getByRole('status')).toHaveText('Données en direct');
  await expect(pane(page, 'bitcoin').locator('.street-person')).toHaveCount(80);
  await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await pane(page, 'ethereum').getByRole('button', { name: 'Explorer la simulation' }).click();
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveText('Simulation pédagogique');
    await expect(pane(page, chain).locator('.street-scene')).toBeVisible();
  }
});

test('old offline data is retired separately in each network pane', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  await routeSnapshots(page, (chain) => ({
    ...liveSnapshot(chain, Date.now() - 130_000),
    transactions: [],
    blocks: [],
  }));
  await page.goto('/');
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveText('Source indisponible');
    await expect(pane(page, chain).locator('.street-person')).toHaveCount(0);
    await expect(
      pane(page, chain).getByText(
        'Dernières données trop anciennes. Affichage suspendu en attendant la source.',
      ),
    ).toBeVisible();
  }
});

test('selected transaction follows observations and disappears when its source expires', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  let phase: 'pending' | 'confirmed' | 'unavailable' = 'pending';
  await routeSnapshots(page, (chain) => {
    const snapshot = liveSnapshot(chain);
    if (chain === 'ethereum') return snapshot;
    return {
      ...snapshot,
      status: phase === 'unavailable' ? 'unavailable' : 'ok',
      blocks: [],
      transactions:
        phase === 'unavailable'
          ? []
          : [{ ...snapshot.transactions[0], id: 'a'.repeat(64), status: phase }],
      pendingCount: phase === 'unavailable' ? null : 100,
      feeRate: phase === 'unavailable' ? null : 4,
    };
  });
  await page.clock.install();
  await page.goto('/');
  await inspectFirstTraveler(page);
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByText('En attente', { exact: true })).toBeVisible();
  phase = 'confirmed';
  await page.clock.fastForward(11_000);
  await expect(panel.getByText('Incluse dans un bloc observé', { exact: true })).toBeVisible();
  phase = 'unavailable';
  await page.clock.fastForward(11_000);
  await expect(pane(page, 'bitcoin').getByRole('status')).toHaveText('Source indisponible');
  await expect(page.getByRole('link', { name: /Explorer cette transaction/ })).toHaveCount(0);
  await expect(pane(page, 'ethereum').getByRole('status')).toHaveText('Données en direct');
});

test('live departure requires a newly observed block independently on each chain', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  let blockIndex = 1;
  await routeSnapshots(page, (chain) => {
    const snapshot = liveSnapshot(chain);
    return {
      ...snapshot,
      transactions: [],
      blocks: [
        {
          ...snapshot.blocks[0],
          hash: `${chain === 'ethereum' ? '0x' : ''}${(chain === 'bitcoin' ? blockIndex : 1).toString(16).padStart(64, '0')}`,
        },
      ],
    };
  });
  await page.clock.install();
  await page.goto('/');
  for (const chain of chains)
    await expect(pane(page, chain).getByRole('status')).toHaveText('Données en direct');
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
  await page.clock.fastForward(11_000);
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
  blockIndex = 2;
  await page.clock.fastForward(11_000);
  const departing = pane(page, 'bitcoin').locator('.street-tram--observed-departure');
  await expect(departing).toHaveCount(1);
  await expect(pane(page, 'ethereum').locator('.street-tram--observed-departure')).toHaveCount(0);
  expect(await departing.evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe('1');
  await page.getByRole('button', { name: 'Mouvements actifs' }).click();
  await expect(departing).toHaveCount(0);
});

test('the browser retires old data while both refresh requests are still pending', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  let holdRequests = false;
  await page.route('**/api/snapshot?*', async (route) => {
    if (holdRequests) return;
    const chain =
      new URL(route.request().url()).searchParams.get('chain') === 'ethereum'
        ? 'ethereum'
        : 'bitcoin';
    const snapshot = liveSnapshot(chain, Date.now() - 115_000);
    await route.fulfill({
      json: {
        ...snapshot,
        blocks: [],
        transactions: [{ ...snapshot.transactions[0], id: 'a'.repeat(64) }],
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  for (const chain of chains)
    await expect(pane(page, chain).getByRole('status')).toHaveText('Données en direct');
  holdRequests = true;
  await page.clock.fastForward(11_000);
  for (const chain of chains) {
    await expect(pane(page, chain).getByRole('status')).toHaveText('Source indisponible');
    await expect(pane(page, chain).locator('.street-person')).toHaveCount(0);
  }
});

test('equal transaction identifiers on two chains cannot leak the selected traveler', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  const sharedId = 'b'.repeat(64);
  await routeSnapshots(page, (chain) => {
    const snapshot = liveSnapshot(chain);
    return {
      ...snapshot,
      transactions: [
        {
          ...snapshot.transactions[0],
          id: sharedId,
          status: 'pending',
          feeRate: chain === 'bitcoin' ? 20 : 3,
          size: chain === 'bitcoin' ? 200 : 21_000,
          value: chain === 'bitcoin' ? 'Voyageur Bitcoin' : 'Voyageur Ethereum',
        },
      ],
    };
  });
  await page.goto('/');
  await inspectFirstTraveler(page, 'bitcoin');
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByText('Voyageur Bitcoin', { exact: true })).toBeVisible();
  await expect(pane(page, 'ethereum').locator('.street-person--selected')).toHaveCount(0);
  await page
    .locator('.chain-tabs')
    .getByRole('button', { name: /Ethereum/ })
    .click();
  await expect(panel).toHaveAttribute('data-page', 'network');
  await expect(panel.getByText('Voyageur Bitcoin', { exact: true })).toHaveCount(0);
  await expect(page.locator('.street-person--selected')).toHaveCount(0);
  await inspectFirstTraveler(page, 'ethereum');
  await expect(panel.getByText('Voyageur Ethereum', { exact: true })).toBeVisible();
  await expect(panel.getByText('3 Gwei', { exact: true })).toBeVisible();
  await expect(pane(page, 'bitcoin').locator('.street-person--selected')).toHaveCount(0);
});
