import { expect, test, type Page } from '@playwright/test';
import { snapshotSchema, type ChainId, type Snapshot } from '../../shared/model';

const observedAt = Date.now();
const chains = ['bitcoin', 'ethereum'] as const;
const name = (chain: ChainId) => (chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum');
const panel = (page: Page) => page.getByTestId('info-panel');
const information = (page: Page) =>
  page.getByRole('button', { name: 'Afficher le panneau d’informations', exact: true });

function snapshot(chain: ChainId, unavailable = false): Snapshot {
  const hash = (index: number) =>
    `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`;
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: unavailable ? 'unavailable' : 'ok',
    source: 'Source contrôlée pour la fermeture des panneaux',
    observedAt,
    coverage: 'Échantillon contrôlé ; aucune requête fournisseur.',
    pendingCount: unavailable || chain === 'ethereum' ? null : 100,
    feeRate: unavailable ? null : 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions: unavailable
      ? []
      : [
          {
            id: hash(1),
            chain,
            feeRate: 10,
            size: chain === 'bitcoin' ? 200 : 21_000,
            status: 'pending',
            kind: 'transfer',
            value: 'Valeur non fournie',
          },
        ],
    blocks: unavailable
      ? []
      : [
          {
            hash: hash(100),
            height: 100,
            timestamp: Math.floor(observedAt / 1_000),
            txCount: 100,
            used: 500_000,
            capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
          },
        ],
    ...(unavailable ? { message: 'Source temporairement indisponible.' } : {}),
  });
}

async function setup(page: Page, unavailable = false) {
  await page.clock.install({ time: observedAt });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/snapshot?*', async (route) => {
    const chain =
      new URL(route.request().url()).searchParams.get('chain') === 'ethereum'
        ? 'ethereum'
        : 'bitcoin';
    await route.fulfill({ json: snapshot(chain, unavailable) });
  });
  await page.goto('/');
  for (const chain of chains)
    await expect(
      page.locator(`.chain-pane[data-chain="${chain}"]`).getByRole('status'),
    ).toHaveAttribute('aria-label', unavailable ? 'Source indisponible' : 'Données en direct');
}

async function expectClosed(page: Page) {
  await expect(panel(page)).toHaveCount(0);
  await expect(information(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(information(page)).toBeFocused();
}

test('the close button stays visible after scrolling and closes either chain panel', async ({
  page,
}, testInfo) => {
  await setup(page);
  for (const chain of chains) {
    await page
      .locator('.chain-tabs')
      .getByRole('button', { name: new RegExp(name(chain)) })
      .click();
    await information(page).click();
    const close = panel(page).getByRole('button', {
      name: 'Fermer le panneau d’informations',
      exact: true,
    });
    await expect(close).toBeVisible();
    await panel(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const box = await close.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expect(close).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`information-close-${chain}.png`) });
    await close.click();
    await expectClosed(page);
    await page.clock.runFor(3_100);
    await expect(panel(page)).toHaveCount(0);
  }
});

test('closing transaction details clears the selection and reopening shows network information', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: 'Parcourir les transactions Bitcoin', exact: true })
    .click();
  const browser = page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });
  await browser.getByRole('button', { name: 'Afficher les détails', exact: true }).click();
  await browser.getByRole('button', { name: 'Fermer les transactions', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-page', 'transaction');
  await panel(page)
    .getByRole('button', { name: 'Fermer le panneau d’informations', exact: true })
    .click();
  await expectClosed(page);
  await page.clock.runFor(3_100);
  await expect(panel(page)).toHaveCount(0);
  await information(page).click();
  await expect(panel(page)).toHaveAttribute('data-page', 'network');
  await expect(panel(page).locator('.info-transaction-hash')).toHaveCount(0);
});

test('Escape closes the transaction browser first then the information panel and returns focus', async ({
  page,
}) => {
  await setup(page);
  await information(page).click();
  const browse = page.getByRole('button', {
    name: 'Parcourir les transactions Bitcoin',
    exact: true,
  });
  await browse.focus();
  await page.keyboard.press('Enter');
  const browser = page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });
  await expect(browser.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await expect(browse).toBeFocused();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expectClosed(page);
});

test('information panels also close by pointer and Escape when the source is unavailable', async ({
  page,
}) => {
  await setup(page, true);
  for (const chain of chains) {
    await page
      .locator('.chain-tabs')
      .getByRole('button', { name: new RegExp(name(chain)) })
      .click();
    await information(page).click();
    await expect(panel(page)).toBeVisible();
    await panel(page)
      .getByRole('button', { name: 'Fermer le panneau d’informations', exact: true })
      .click();
    await expectClosed(page);
    await information(page).click();
    await page.keyboard.press('Escape');
    await expectClosed(page);
  }
});
