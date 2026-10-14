import { expect, test, type Locator, type Page } from '@playwright/test';
import { generateDemoSnapshot } from '../../server/demo';
import type { ChainId, Snapshot, Tx } from '../../shared/model';

function transaction(chain: ChainId, index: number, feeRate: number, size: number): Tx {
  return {
    id: `${chain === 'ethereum' ? '0x' : ''}${index.toString(16).padStart(64, '0')}`,
    chain,
    feeRate,
    size,
    status: 'pending',
    kind: chain === 'ethereum' && size > 21_000 ? 'contract' : 'transfer',
    value: 'Montant de test',
  };
}

function liveSnapshot(chain: ChainId, transactions: Tx[]): Snapshot {
  const demo = generateDemoSnapshot(chain, Date.now());
  return {
    ...demo,
    mode: 'live',
    source: 'Source contrôlée pour les animations',
    coverage: 'Échantillon contrôlé de test, aucune couverture globale.',
    pendingCount: chain === 'ethereum' ? null : 4_200,
    feeRate: 1,
    transactions,
    blocks: demo.blocks.map((block, index) => ({
      ...block,
      hash: `${chain === 'ethereum' ? '0x' : ''}${(index + 100).toString(16).padStart(64, '0')}`,
    })),
  };
}

async function routeSnapshots(page: Page, current: (chain: ChainId) => Snapshot) {
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get('chain') === 'ethereum' ? 'ethereum' : 'bitcoin';
    await route.fulfill({ json: current(chain) });
  });
}

function traveler(page: Page, tx: Tx) {
  return page.locator(
    `section.chain-pane[data-chain="${tx.chain}"] .street-person[data-tx-id="${tx.id}"]`,
  );
}

async function position(person: Locator) {
  await expect
    .poll(() => person.evaluate((node) => (node as SVGGraphicsElement).getCTM() !== null))
    .toBe(true);
  return person.evaluate((node) => {
    const matrix = (node as SVGGraphicsElement).getCTM();
    if (!matrix) throw new Error('Le voyageur doit être attaché à la scène SVG.');
    return { x: matrix.e, y: matrix.f };
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
});

test('a traveler walks to the candidate wagon and boarding never confirms a live transaction', async ({
  page,
}) => {
  const tx = transaction('bitcoin', 1, 20, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  const person = traveler(page, tx);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  const start = await position(person);
  await page.clock.runFor(2_000);
  const walking = await position(person);
  expect(Math.hypot(walking.x - start.x, walking.y - start.y)).toBeGreaterThan(20);
  await page.clock.runFor(7_000);
  await expect(person).toHaveAttribute('data-motion-state', 'boarded');
  await person.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.street-tram--observed-departure')).toHaveCount(0);
});

test('a higher-fee arrival displaces a boarded traveler back to the queue without inventing a rejection', async ({
  page,
}) => {
  const target = transaction('bitcoin', 1, 2, 400);
  const peers = Array.from({ length: 11 }, (_, index) =>
    transaction('bitcoin', index + 2, 20, 400),
  );
  let newcomer = false;
  await routeSnapshots(page, (chain) =>
    liveSnapshot(
      chain,
      chain === 'bitcoin'
        ? [target, ...peers, ...(newcomer ? [transaction(chain, 50, 30, 400)] : [])]
        : [],
    ),
  );
  await page.goto('/');
  const person = traveler(page, target);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  await page.clock.runFor(9_000);
  await expect(person).toHaveAttribute('data-motion-state', 'boarded');
  const seat = await position(person);
  await person.focus();
  await page.keyboard.press('Enter');
  newcomer = true;
  await page.clock.runFor(1_100);
  await expect(person).toHaveAttribute('data-motion-state', /exiting|returning/);
  await page.clock.runFor(6_000);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  const queue = await position(person);
  expect(queue).not.toEqual(seat);
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
});

test('a traveler below the illustrative fee threshold returns to the platform', async ({
  page,
}) => {
  const tx = transaction('bitcoin', 1, 0.1, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  const person = traveler(page, tx);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  const platform = await position(person);
  await page.clock.runFor(2_000);
  await expect(person).toHaveAttribute('data-motion-state', 'walking');
  await page.clock.runFor(5_000);
  await expect(person).toHaveAttribute('data-motion-state', 'returning');
  await page.clock.runFor(5_000);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  expect(await position(person)).toEqual(platform);
  await person.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();
});

test('head size reflects virtual bytes or declared gas and stays bounded', async ({ page }) => {
  const smallBtc = transaction('bitcoin', 1, 20, 140);
  const largeBtc = transaction('bitcoin', 2, 10, 1_140);
  const smallEth = transaction('ethereum', 1, 20, 21_000);
  const largeEth = transaction('ethereum', 2, 10, 240_000);
  await routeSnapshots(page, (chain) =>
    liveSnapshot(chain, chain === 'bitcoin' ? [smallBtc, largeBtc] : [smallEth, largeEth]),
  );
  await page.goto('/');
  for (const [small, large] of [
    [smallBtc, largeBtc],
    [smallEth, largeEth],
  ] as const) {
    await expect(traveler(page, small)).toHaveAttribute('data-resource-size', String(small.size));
    await expect(traveler(page, large)).toHaveAttribute('data-resource-size', String(large.size));
    const smallScale = Number(await traveler(page, small).getAttribute('data-head-scale'));
    const largeScale = Number(await traveler(page, large).getAttribute('data-head-scale'));
    expect(smallScale).toBeGreaterThan(0);
    expect(largeScale).toBeGreaterThan(smallScale);
    expect(largeScale).toBeLessThanOrEqual(2.5);
  }
  await expect(
    page
      .locator('section.chain-pane[data-chain="ethereum"] .chain-metrics div')
      .filter({ hasText: 'Mempool global' }),
  ).toContainText('Non mesuré');
});

test('pause and reduced motion freeze the actual traveler coordinates', async ({ page }) => {
  const tx = transaction('bitcoin', 1, 20, 200);
  await routeSnapshots(page, (chain) => liveSnapshot(chain, chain === 'bitcoin' ? [tx] : []));
  await page.goto('/');
  const person = traveler(page, tx);
  await expect(person).toHaveAttribute('data-motion-state', 'queue');
  await page.clock.runFor(2_000);
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  const paused = await position(person);
  await page.clock.runFor(3_000);
  expect(await position(person)).toEqual(paused);
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(500);
  expect(await position(person)).not.toEqual(paused);
  await page.getByRole('button', { name: 'Mouvements actifs' }).click();
  await expect(person).toHaveAttribute('data-motion-state', 'boarded');
  const reduced = await position(person);
  await page.clock.runFor(3_000);
  expect(await position(person)).toEqual(reduced);
});

test('the information panel cycles automatically and respects pause and reduced motion', async ({
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
  await page.clock.runFor(8_100);
  await expect(panel).toHaveAttribute('data-page', 'block');
  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(16_000);
  await expect(panel).toHaveAttribute('data-page', 'block');
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(8_100);
  await expect(panel).toHaveAttribute('data-page', 'travelers');
  await page.getByRole('button', { name: 'Mouvements actifs' }).click();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(16_000);
  await expect(panel).toHaveAttribute('data-page', 'travelers');
  await page.getByRole('button', { name: 'Masquer le panneau d’informations' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Afficher le panneau d’informations' }).click();
  await expect(panel).toHaveAttribute('data-page', 'network');
});

test('selected information follows new observations and tabs support keyboard inspection', async ({
  page,
}) => {
  let updated = false;
  await routeSnapshots(page, (chain) =>
    liveSnapshot(chain, [transaction(chain, 1, updated ? 30 : 20, updated ? 800 : 200)]),
  );
  await page.goto('/');
  await page.locator('section.chain-pane[data-chain="bitcoin"] .street-person').first().focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('info-panel');
  await expect(panel).toHaveAttribute('data-page', 'transaction');
  await expect(panel.getByText('20 sat/vB', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  updated = true;
  await page.clock.runFor(11_000);
  await expect(panel.getByText('30 sat/vB', { exact: true })).toBeVisible();
  await expect(panel.getByText('800 vB', { exact: true })).toBeVisible();
  await expect(panel.getByText('En attente', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-page', 'transaction');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-page', 'network');
  await panel.getByRole('tab', { name: 'Réseau', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('tab', { name: 'Bloc', exact: true })).toBeFocused();
  await expect(panel).toHaveAttribute('data-page', 'block');
  await expect(panel).toHaveAttribute('data-auto-rotating', 'false');
  await page.clock.runFor(16_000);
  await expect(panel).toHaveAttribute('data-page', 'block');
});

test('a candidate handoff keeps only source-confirmed travelers aboard the observed wagon', async ({
  page,
}) => {
  const included = transaction('bitcoin', 1, 20, 200);
  const waiting = transaction('bitcoin', 2, 15, 200);
  let blockIndex = 1;
  await routeSnapshots(page, (chain) => {
    const transactions =
      chain === 'bitcoin'
        ? [
            {
              ...included,
              status: blockIndex >= 2 ? ('confirmed' as const) : ('pending' as const),
            },
            { ...waiting, status: blockIndex >= 3 ? ('confirmed' as const) : ('pending' as const) },
          ]
        : [];
    const snapshot = liveSnapshot(chain, transactions);
    const first = snapshot.blocks[0];
    if (!first) throw new Error('Bloc requis par le scénario de transfert');
    const observedIndex = chain === 'bitcoin' ? blockIndex : 1;
    return {
      ...snapshot,
      blocks: [
        {
          ...first,
          height: first.height + observedIndex,
          hash: `${chain === 'ethereum' ? '0x' : ''}${observedIndex.toString(16).padStart(64, '0')}`,
        },
      ],
    };
  });
  await page.goto('/');
  const bitcoin = page.locator('section.chain-pane[data-chain="bitcoin"]');
  const handoff = bitcoin.locator('.street-candidate--handoff');
  const observed = bitcoin.locator('.street-observed-wagon');
  const candidate = bitcoin.locator('.street-candidate-wagon:not(.street-candidate--handoff)');
  const includedPerson = traveler(page, included);
  const waitingPerson = traveler(page, waiting);
  await expect(includedPerson).toHaveAttribute('data-motion-state', 'queue');
  await expect(handoff).toHaveCount(0);
  await page.clock.runFor(9_000);
  await expect(includedPerson).toHaveAttribute('data-motion-state', 'boarded');
  await expect(waitingPerson).toHaveAttribute('data-motion-state', 'boarded');
  await page.clock.fastForward(11_000);
  await expect(handoff).toHaveCount(0);

  blockIndex = 2;
  await page.clock.fastForward(11_000);
  await expect(handoff).toHaveCount(1);
  await expect(handoff.locator(`.street-person[data-tx-id="${included.id}"]`)).toHaveAttribute(
    'data-source-status',
    'confirmed',
  );
  await expect(handoff.locator(`.street-person[data-tx-id="${waiting.id}"]`)).toHaveCount(0);
  await expect(waitingPerson).toHaveAttribute('data-motion-state', /exiting|returning/);
  await expect(waitingPerson).toHaveAttribute('data-source-status', 'pending');
  await expect(observed.locator(`.street-person[data-tx-id="${waiting.id}"]`)).toHaveCount(0);
  await expect(
    page.locator('section.chain-pane[data-chain="ethereum"] .street-candidate--handoff'),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Mettre l’animation en pause' }).click();
  const progress = await handoff.getAttribute('data-handoff-progress');
  const pausedPosition = await position(includedPerson);
  await page.clock.runFor(500);
  expect(await handoff.getAttribute('data-handoff-progress')).toBe(progress);
  expect(await position(includedPerson)).toEqual(pausedPosition);
  await page.getByRole('button', { name: 'Reprendre l’animation' }).click();
  await page.clock.runFor(1_000);
  expect(await position(includedPerson)).not.toEqual(pausedPosition);
  await page.clock.runFor(4_000);
  await expect(handoff).toHaveCount(0);
  await expect(observed.locator(`.street-person[data-tx-id="${included.id}"]`)).toHaveAttribute(
    'data-source-status',
    'confirmed',
  );
  await expect(observed.locator(`.street-person[data-tx-id="${waiting.id}"]`)).toHaveCount(0);
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toBeVisible();
  await expect(waitingPerson).toHaveAttribute('data-source-status', 'pending');
  await page.clock.runFor(18_000);
  await expect(candidate.locator(`.street-person[data-tx-id="${waiting.id}"]`)).toHaveAttribute(
    'data-motion-state',
    'boarded',
  );
  await waitingPerson.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('info-panel').getByText('En attente', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Mouvements actifs' }).click();
  blockIndex = 3;
  await page.clock.fastForward(11_000);
  await expect(
    bitcoin.locator('.chain-metrics').getByText('#900 003', { exact: false }),
  ).toBeVisible();
  await expect(handoff).toHaveCount(0);
  await expect(observed.locator(`.street-person[data-tx-id="${waiting.id}"]`)).toHaveAttribute(
    'data-source-status',
    'confirmed',
  );
  const reducedPosition = await position(waitingPerson);
  await page.clock.runFor(1_000);
  expect(await position(waitingPerson)).toEqual(reducedPosition);
});
