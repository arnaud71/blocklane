import { expect, test, type Page } from '@playwright/test';
import { generateDemoSnapshot } from '../../server/demo';
import { snapshotSchema, type ChainId } from '../../shared/model';

async function openCity(page: Page) {
  let requests = 0;
  await page.route('**/api/snapshot?*', async (route) => {
    requests += 1;
    const query = new URL(route.request().url()).searchParams;
    const chain: ChainId = query.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    const demo = generateDemoSnapshot(chain, await page.evaluate(() => Date.now()));
    const prefix = chain === 'ethereum' ? '0x' : '';
    await route.fulfill({
      json: snapshotSchema.parse({
        ...demo,
        mode: query.get('mode') === 'demo' ? 'demo' : 'live',
        source: 'Controlled provider',
        coverage: 'Échantillon contrôlé ; aucune preuve de confirmation.',
        transactions: demo.transactions
          .filter((tx) => tx.status === 'pending')
          .slice(0, 4)
          .map((tx, index) => ({
            ...tx,
            id: prefix + (index + 1).toString(16).padStart(64, '0'),
            blockHash: undefined,
          })),
        blocks: demo.blocks.map((block, index) => ({
          ...block,
          hash: prefix + (index + 100).toString(16).padStart(64, '0'),
        })),
      }),
    });
  });
  await page.goto('/');
  await expect(page.locator('.chain-pane')).toHaveCount(2);
  await expect(page.locator('canvas.passenger-canvas')).toHaveCount(2);
  return () => requests;
}

test.describe('English browser preference', () => {
  test.use({ locale: 'en-US' });

  test('uses browser English, translates help and keeps active controls and scenes when switched', async ({
    page,
  }, info) => {
    await page.clock.install();
    const requestCount = await openCity(page);
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
    await page.getByRole('combobox', { name: 'Animation speed', exact: true }).selectOption('10');
    const canvas = page.locator('canvas.passenger-canvas').first();
    await canvas.evaluate((node) => node.setAttribute('data-language-continuity', 'retained'));
    const before = requestCount();
    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(
      page.getByRole('button', { name: 'Reprendre l’animation', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Vitesse d’animation', exact: true }),
    ).toHaveValue('10');
    await expect(canvas).toHaveAttribute('data-language-continuity', 'retained');
    expect(requestCount()).toBe(before);
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Why two carriages?', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.learning-grid')).toContainText('Departure is not finality');
    await page.getByRole('button', { name: 'Back to the city', exact: true }).click();
    const bitcoinBoard = page.locator('.info-billboard--bitcoin');
    await page.getByRole('button', { name: 'Show flow · Bitcoin', exact: true }).click();
    await expect(bitcoinBoard).toContainText('Flow not measured');
    await page.getByRole('button', { name: 'Show comparison · Bitcoin', exact: true }).click();
    await expect(bitcoinBoard).toContainText('Waiting for comparison');
    await expect(bitcoinBoard.locator('.info-billboard-screen')).toHaveAttribute(
      'title',
      /A previously observed complete candidate/,
    );
    await page.getByRole('button', { name: 'Data sources', exact: true }).click();
    await expect(page.locator('.source-details')).toContainText(
      'Only verified block evidence proves inclusion',
    );
    await expect(page.locator('.source-details')).toContainText('Privacy');
    await page.getByRole('button', { name: 'Back to the city', exact: true }).click();
    await page.getByRole('button', { name: 'Browse Bitcoin transactions', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Observed Bitcoin transactions', exact: true });
    await expect(dialog.locator('.passenger-canvas-browser-description')).not.toContainText(
      'en attente',
    );
    await dialog.getByRole('button', { name: 'View details', exact: true }).click();
    await page.keyboard.press('Escape');
    const selectedHash = await page
      .getByTestId('info-panel')
      .locator('.info-transaction-hash')
      .getAttribute('title');
    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.getByTestId('info-panel').locator('.info-transaction-hash')).toHaveAttribute(
      'title',
      selectedHash!,
    );
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const headerBox = await page.locator('.immersion-topbar').boundingBox();
    const panelBox = await page.getByTestId('info-panel').boundingBox();
    expect(headerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    await page.screenshot({ path: info.outputPath('english-city.png'), fullPage: true });
    if ((page.viewportSize()?.width ?? 1280) < 700) {
      await page.setViewportSize({ width: 320, height: 640 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      const compactHeader = await page.locator('.immersion-topbar').boundingBox();
      const compactPanel = await page.getByTestId('info-panel').boundingBox();
      expect(compactPanel!.y).toBeGreaterThanOrEqual(compactHeader!.y + compactHeader!.height);
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.locator('.chain-tabs').getByRole('button', { name: 'Ethereum' }).click();
      await expect(page.getByTestId('info-panel')).toHaveClass(/info-ethereum/);
      await page.screenshot({ path: info.outputPath('english-compact.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Demo', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Data sources', exact: true }).click();
    await expect(page.locator('.source-details')).toContainText(
      'Educational demo · fictional data',
    );
  });

  test('persists a manual French choice across reload and handles blocked storage', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCity(page);
    await expect(page.locator('.street-scene').first()).toHaveClass(/reduced-motion/);
    await page.getByRole('button', { name: 'Français', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('button', { name: 'Comprendre', exact: true })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        value() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible();
    await expect(page.locator('.street-scene').first()).toHaveClass(/reduced-motion/);
  });
});

test.describe('Unavailable local storage', () => {
  test.use({ locale: 'en-GB' });
  test('uses the browser language when reading local storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'getItem', {
        configurable: true,
        value() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });
    await openCity(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('button', { name: 'Comprendre', exact: true })).toBeVisible();
  });
});

test.describe('French browser preference', () => {
  test.use({ locale: 'fr-FR' });
  test('starts in browser French without creating a saved preference', async ({ page }) => {
    await openCity(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('button', { name: 'Français', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await page.evaluate(() => localStorage.getItem('blocklane.language'))).toBeNull();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('Unsupported browser language', () => {
  test.use({ locale: 'de-DE' });
  test('falls back to English and ignores an invalid saved locale', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('blocklane.language', 'unsupported'));
    await openCity(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible();
  });
});
