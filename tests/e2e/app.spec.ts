import { expect, test } from '@playwright/test';
import { generateDemoSnapshot } from '../../server/demo';
import type { Snapshot } from '../../shared/model';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const demo = generateDemoSnapshot(chain, Date.now());
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    const snapshot: Snapshot =
      mode === 'demo'
        ? demo
        : {
            ...demo,
            mode,
            source: 'Fournisseur de test',
            pendingCount: chain === 'ethereum' ? null : 4320,
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
    await route.fulfill({ json: snapshot });
  });
});

test('direct by default, functional network switch, bounded scene and responsive page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Données en direct');
  await expect(page.getByRole('heading', { name: 'Bitcoin Avenue' })).toBeVisible();
  expect(await page.locator('.street-person').count()).toBe(80);
  await page
    .locator('.chain-tabs')
    .getByRole('button', { name: /Ethereum/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Ethereum Avenue' })).toBeVisible();
  await expect(page.getByText('Non mesuré par cette source')).toBeVisible();
  await expect(page.locator('.metric-value').first()).toContainText('—');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('keyboard traveler inspection and explorer links stay specific to real mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.street-person').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Votre voyageur' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Voir dans l’explorateur/ })).toHaveAttribute(
    'href',
    /^https:\/\/mempool.space\/tx\/[0-9a-f]{64}$/,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Dans la ville' })).toBeVisible();
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Simulation pédagogique');
  await page.locator('.tx-row').first().click();
  await expect(page.getByText('Transaction synthétique · aucun lien vers le réseau')).toBeVisible();
  await expect(page.getByRole('link', { name: /Voir dans l’explorateur/ })).toHaveCount(0);
});

test('pause, reduced motion, speed, learning and branding are functional', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(page.locator('.street-scene')).toHaveClass(/reduced-motion/);
  await page.getByRole('button', { name: 'Mouvements réduits' }).click();
  await expect(page.locator('.street-scene')).not.toHaveClass(/reduced-motion/);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await expect(page.locator('.street-scene')).toHaveClass(/paused/);
  await page.getByRole('combobox', { name: 'Vitesse de simulation' }).selectOption('2');
  await expect(page.locator('.street-scene')).toHaveAttribute('style', /9s/);
  await page.getByRole('button', { name: 'Identité : HEG' }).click();
  await expect(page.locator('.app')).toHaveClass(/theme-neutral/);
  await page.locator('.sidebar').getByRole('button', { name: 'Comprendre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Un mempool est une vue locale' })).toBeVisible();
  await page.getByRole('button', { name: /Retourner dans la ville/ }).click();
  await expect(page.getByRole('heading', { name: 'Bitcoin Avenue' })).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Les données', exact: true }).click();
  await expect(page.getByText('Fournisseur de test', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Simulation pédagogique · données fictives', { exact: true }),
  ).toBeVisible();
});

test('invalid upstream payload never silently becomes simulated data', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  await page.route('**/api/snapshot?*', (route) =>
    route.fulfill({ json: { chain: 'bitcoin', mode: 'live', transactions: 'invalid' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Le réseau se fait attendre.' })).toBeVisible();
  await expect(page.locator('.street-person')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('unavailable source gives explicit retry or demo choice', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const demo = generateDemoSnapshot('bitcoin', Date.now());
    await route.fulfill({
      json:
        url.searchParams.get('mode') === 'demo'
          ? demo
          : {
              ...demo,
              mode: 'live',
              status: 'unavailable',
              transactions: [],
              blocks: [],
              pendingCount: null,
              feeRate: null,
              coverage: 'Aucune donnée validée disponible.',
              message: 'Le fournisseur est indisponible.',
            },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Source indisponible');
  await expect(page.locator('.street-person')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explorer la simulation' }).click();
  await expect(page.getByRole('status')).toHaveText('Simulation pédagogique');
  await expect(page.locator('.street-scene')).toBeVisible();
});

test('old offline data is retired in the browser', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  await page.route('**/api/snapshot?*', async (route) => {
    await route.fulfill({
      json: {
        ...generateDemoSnapshot('bitcoin', Date.now() - 130_000),
        mode: 'live',
        transactions: [],
        blocks: [],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Source indisponible');
  await expect(page.locator('.street-person')).toHaveCount(0);
  await expect(
    page.getByText('Dernières données trop anciennes. Affichage suspendu en attendant la source.'),
  ).toBeVisible();
});

test('selected transaction follows new observations and disappears when data expires', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  let phase: 'pending' | 'confirmed' | 'unavailable' = 'pending';
  await page.route('**/api/snapshot?*', async (route) => {
    const demo = generateDemoSnapshot('bitcoin', Date.now());
    await route.fulfill({
      json: {
        ...demo,
        mode: 'live',
        status: phase === 'unavailable' ? 'unavailable' : 'ok',
        blocks: [],
        transactions:
          phase === 'unavailable'
            ? []
            : [{ ...demo.transactions[0], id: 'a'.repeat(64), status: phase }],
        pendingCount: phase === 'unavailable' ? null : 100,
        feeRate: phase === 'unavailable' ? null : 4,
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  await page.locator('.tx-row').first().click();
  await expect(page.getByText('En attente dans la source', { exact: true })).toBeVisible();
  phase = 'confirmed';
  await page.clock.fastForward(11_000);
  await expect(
    page.locator('.transaction-card').getByText('Incluse dans un bloc observé', { exact: true }),
  ).toBeVisible();
  phase = 'unavailable';
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('status')).toHaveText('Source indisponible');
  await expect(page.getByRole('heading', { name: 'Votre voyageur' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Voir dans l’explorateur/ })).toHaveCount(0);
});

test('live departure requires a new observed block and never loops on a timer', async ({
  page,
}) => {
  await page.unroute('**/api/snapshot?*');
  let blockIndex = 1;
  await page.route('**/api/snapshot?*', async (route) => {
    const demo = generateDemoSnapshot('bitcoin', Date.now());
    await route.fulfill({
      json: {
        ...demo,
        mode: 'live',
        transactions: [],
        blocks: [{ ...demo.blocks[0], hash: blockIndex.toString(16).padStart(64, '0') }],
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Données en direct');
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
  await page.clock.fastForward(11_000);
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
  blockIndex = 2;
  await page.clock.fastForward(11_000);
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(1);
  const iterations = await page
    .locator('.street-tram--observed-departure')
    .evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(iterations).toBe('1');
  await page.getByRole('button', { name: 'Mouvements actifs' }).click();
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
});

test('the browser retires old data even while a refresh is still pending', async ({ page }) => {
  await page.unroute('**/api/snapshot?*');
  let holdRequests = false;
  await page.route('**/api/snapshot?*', async (route) => {
    if (holdRequests) return;
    const demo = generateDemoSnapshot('bitcoin', Date.now() - 115_000);
    await route.fulfill({
      json: {
        ...demo,
        mode: 'live',
        blocks: [],
        transactions: [{ ...demo.transactions[0], id: 'a'.repeat(64) }],
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Données en direct');
  holdRequests = true;
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('status')).toHaveText('Source indisponible');
  await expect(page.locator('.street-person')).toHaveCount(0);
});
