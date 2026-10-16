import { expect, test, type Page } from '@playwright/test';
import {
  snapshotSchema,
  type BitcoinBlockTemplate,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../../shared/model';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const pane = (page: Page) => page.locator('section.chain-pane[data-chain="bitcoin"]');
const firstWagon = (page: Page) => pane(page).locator('.street-first-wagon');
const laterWagon = (page: Page) => pane(page).locator('[data-projection="later"]');
const templateGroup = (page: Page) => firstWagon(page).locator('[data-template-group-count]');
const firstCounter = (page: Page) => firstWagon(page).locator('.street-wagon-transaction-count');
const browser = (page: Page) =>
  page.getByRole('dialog', { name: 'Transactions observées Bitcoin' });

function transaction(index: number, feeRate = 20): Tx {
  return {
    id: index.toString(16).padStart(64, '0'),
    chain: 'bitcoin',
    status: 'pending',
    feeRate,
    size: 200,
    kind: 'transfer',
    value: '0.01 BTC',
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

function template(members: Tx[], parent: Block, observedAt: number): BitcoinBlockTemplate {
  return {
    source: 'Nœud contrôlé · getblocktemplate',
    observedAt,
    height: parent.height + 1,
    previousBlockHash: parent.hash,
    transactionCount: members.length,
    weight: members.reduce((sum, tx) => sum + tx.size * 4, 0),
    weightLimit: 4_000_000,
    selectedTransactionIds: members.map((tx) => tx.id),
  };
}

/** Explicit live data: a node's proposal and a confirmed block have separate fields. */
function liveSnapshot(
  chain: ChainId,
  stage: number,
  transactions: Tx[],
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé du candidat Bitcoin',
    observedAt: OBSERVED_AT + stage * 3_000,
    coverage: `Candidat contrôlé étape ${stage}. Échantillon limité ; le nœud propose, seule une inclusion exacte confirme.`,
    pendingCount: chain === 'bitcoin' ? 100 : null,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [block(chain)],
    inclusions: [],
    ...overrides,
  });
}

async function routeStages(page: Page, current: (stage: number) => Snapshot) {
  let stage = 0;
  const fetched = new Set<number>();
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'bitcoin' ? 'bitcoin' : 'ethereum';
    if (chain === 'bitcoin') fetched.add(stage);
    await route.fulfill({
      json: chain === 'bitcoin' ? current(stage) : liveSnapshot(chain, stage, []),
    });
  });
  return async (nextStage: number) => {
    stage = nextStage;
    for (let attempt = 0; attempt < 20 && !fetched.has(stage); attempt += 1) {
      await page.clock.runFor(200);
    }
    expect(fetched.has(stage)).toBe(true);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      new RegExp(`Candidat contrôlé étape ${stage}\\.`),
    );
  };
}

async function openTraveler(page: Page, tx: Tx) {
  await page.getByRole('button', { name: 'Parcourir les transactions Bitcoin' }).focus();
  await page.keyboard.press('Enter');
  const selector = browser(page).getByRole('combobox');
  await expect(selector).toBeFocused();
  await selector.selectOption(tx.id);
  return selector;
}

async function expectBoarded(page: Page, tx: Tx) {
  await openTraveler(page, tx);
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'à bord du wagon illustratif',
  );
  await closeBrowser(page);
}

async function closeBrowser(page: Page) {
  await browser(page).getByRole('button', { name: 'Fermer les transactions' }).focus();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toHaveCount(0);
}

async function showTravelerDetails(page: Page) {
  await page.keyboard.press('Tab');
  await expect(browser(page).getByRole('button', { name: 'Afficher les détails' })).toBeFocused();
  await page.keyboard.press('Enter');
  await closeBrowser(page);
  return page.getByTestId('info-panel');
}

async function hidePanel(page: Page) {
  const hide = page.getByRole('button', { name: 'Masquer le panneau d’informations', exact: true });
  if (await hide.count()) await hide.click();
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: OBSERVED_AT });
});

test('node membership reserves the first Bitcoin wagon and fallback restores estimates with keyboard inspection', async ({
  page,
}, testInfo) => {
  const firstMember = transaction(1, 100);
  const newMember = transaction(2, 20);
  const fallbackArrival = transaction(3, 10);
  const refresh = await routeStages(page, (stage) => {
    const members = stage === 0 ? [firstMember] : stage === 1 ? [newMember] : [];
    return liveSnapshot(
      'bitcoin',
      stage,
      stage < 2 ? members : stage === 2 ? [newMember, fallbackArrival] : [],
      {
        blockTemplate:
          stage === 2 ? null : template(members, block('bitcoin'), OBSERVED_AT + stage * 3_000),
      },
    );
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'node-template');
  await expect(firstWagon(page)).toContainText('CANDIDAT DU NŒUD');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'template');
  await expect(templateGroup(page)).toHaveCount(0);
  await expect(laterWagon(page)).toHaveAttribute('data-projection-source', 'estimate');
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'aria-label',
    /Cette proposition ne prouve aucune inclusion ni qu’un pool minier la mine/,
  );
  await expectBoarded(page, firstMember);
  await openTraveler(page, firstMember);
  const currentPanel = await showTravelerDetails(page);
  await expect(currentPanel).toHaveAttribute('data-selection-historical', 'false');
  await expect(currentPanel.getByText('En attente', { exact: true })).toBeVisible();
  await hidePanel(page);

  await refresh(1);
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'node-template');
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'aria-label',
    /hors de l’échantillon actuel/,
  );
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-node-candidate-and-historical-estimate.png'),
    fullPage: true,
  });
  const selector = await openTraveler(page, firstMember);
  await expect(selector.locator(`option[value="${firstMember.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'à bord du wagon illustratif',
  );
  const historicalPanel = await showTravelerDetails(page);
  await expect(historicalPanel).toHaveAttribute('data-selection-historical', 'true');
  await expect(historicalPanel).toContainText('Présence actuelle dans le mempool inconnue.');
  await hidePanel(page);

  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'estimate');
  await expect(firstWagon(page)).toContainText('PROCHAIN BLOC');
  await expect(firstWagon(page)).not.toContainText('CANDIDAT DU NŒUD');
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '2',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await openTraveler(page, fallbackArrival);
  await expect(browser(page).locator('.passenger-canvas-browser-description')).toContainText(
    'en attente dans la source. à bord du wagon illustratif',
  );
  await closeBrowser(page);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-fallback-estimates.png'),
    fullPage: true,
  });

  // A valid empty candidate is distinct from an unavailable candidate and its fallback.
  await refresh(3);
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'node-template');
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '0',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '3',
  );
  await expect(pane(page).locator('[data-projection-source="confirmed-block"]')).toHaveCount(0);
});

test('an actual Bitcoin block departure uses exact proof rather than the previous proposed membership', async ({
  page,
}, testInfo) => {
  const proposed = transaction(4, 100);
  const actuallyIncluded = transaction(5, 20);
  const nextMember = transaction(6, 10);
  const refresh = await routeStages(page, (stage) => {
    const parent = block('bitcoin', stage >= 2 ? 1 : 0);
    const members = stage === 0 ? [actuallyIncluded] : stage === 1 ? [proposed] : [nextMember];
    return liveSnapshot('bitcoin', stage, members, {
      blocks: [parent],
      blockTemplate: template(members, parent, OBSERVED_AT + stage * 3_000),
      inclusions: stage >= 2 ? [{ block: parent, transactionIds: [actuallyIncluded.id] }] : [],
    });
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expectBoarded(page, actuallyIncluded);
  await refresh(1);
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
  await refresh(2);
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'confirmed-block');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'block');
  await expect(templateGroup(page)).toHaveCount(0);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await page.clock.runFor(1_150);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await page.clock.runFor(2_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  await expect(templateGroup(page)).toHaveCount(0);
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  const selector = await openTraveler(page, proposed);
  await expect(selector.locator(`option[value="${proposed.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await closeBrowser(page);
  await page.clock.runFor(18_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'node-template');
  await expect(firstWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
    'data-transaction-count',
    '1',
  );
  const finalSelector = await openTraveler(page, nextMember);
  await expect(finalSelector.locator('option')).toHaveCount(2);
  await expect(finalSelector.locator(`option[value="${actuallyIncluded.id}"]`)).toHaveCount(0);
  await expect(finalSelector.locator(`option[value="${nextMember.id}"]`)).toContainText(
    'en attente dans la source',
  );
  await expect(finalSelector.locator(`option[value="${proposed.id}"]`)).toContainText(
    'dernière observation · statut actuel inconnu',
  );
  await closeBrowser(page);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-real-departure-new-node-candidate.png'),
    fullPage: true,
  });
});

test('a candidate expires during an unanswered fetch without a departure or a refreshed historical observation', async ({
  page,
}, testInfo) => {
  const historical = transaction(7, 100);
  const current = transaction(8, 20);
  let stage = 0;
  let heldRequests = 0;
  let completedBitcoinResponses = 0;
  let releaseHeld!: () => void;
  const heldResponses = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  await page.route('**/api/snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('mode')).toBe('live');
    const chain = url.searchParams.get('chain') === 'bitcoin' ? 'bitcoin' : 'ethereum';
    if (chain === 'ethereum') {
      await route.fulfill({ json: liveSnapshot(chain, 0, []) });
      return;
    }
    if (stage >= 2) {
      heldRequests += 1;
      // No response, mined block or new timestamp can drive either expiration.
      await heldResponses;
      await route.abort('failed').catch(() => {
        // The browser's existing request timeout may already have cancelled this request.
      });
      return;
    }
    const members = stage === 0 ? [historical] : [current];
    await route.fulfill({
      json: liveSnapshot('bitcoin', stage, members, {
        blockTemplate: {
          ...template(members, block('bitcoin'), OBSERVED_AT + stage * 3_000),
          ...(stage === 1
            ? { transactionCount: 5_000, weight: 3_992_000, medianFeeSats: 100 }
            : {}),
        },
      }),
    });
    completedBitcoinResponses += 1;
  });

  try {
    await page.goto('/');
    await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'node-template');
    await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
    // Reduced-motion settlement is asynchronous; establish real boarding before
    // the next sample can turn this traveller into a historical observation.
    await expectBoarded(page, historical);
    stage = 1;
    await page.clock.runFor(3_200);
    await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
      'title',
      /Candidat contrôlé étape 1\./,
    );
    await expect(firstCounter(page)).toHaveAttribute('data-transaction-count', '5000');
    await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'template');
    await expect(templateGroup(page)).toHaveAttribute('data-template-group-count', '4999');
    await expect(templateGroup(page)).toHaveAttribute('data-template-individual-count', '1');
    await expect(laterWagon(page).locator('.street-wagon-transaction-count')).toHaveAttribute(
      'data-transaction-count',
      '1',
    );
    await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
    await openTraveler(page, historical);
    const panel = await showTravelerDetails(page);
    const observedTime = panel
      .locator('.info-detail')
      .filter({ hasText: 'Dernière observation' })
      .locator('time');
    await expect(panel).toHaveAttribute('data-selection-historical', 'true');
    await expect(
      panel.getByText('En attente lors de cette observation', { exact: true }),
    ).toBeVisible();
    await expect(observedTime).toHaveAttribute('datetime', new Date(OBSERVED_AT).toISOString());

    stage = 2;
    await page.clock.runFor(3_200);
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    const completedAtHold = completedBitcoinResponses;
    // The candidate's own date is t+3 s; expire it before the held fetch's 35 s timeout.
    const candidateExpiredAt = OBSERVED_AT + 3_000 + 30_050;
    await page.clock.fastForward(
      Math.max(0, candidateExpiredAt - (await page.evaluate(() => Date.now()))),
    );
    await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'estimate');
    await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'sample');
    await expect(firstCounter(page)).toHaveAttribute('data-transaction-count', '1');
    await expect(templateGroup(page)).toHaveCount(0);
    await expect(firstWagon(page)).toContainText('PROCHAIN BLOC');
    await expect(firstWagon(page)).not.toContainText('CANDIDAT DU NŒUD');
    await expect(pane(page).locator('.chain-coverage')).toContainText('Ancien candidat du nœud');
    await expect(pane(page).locator('.chain-coverage')).toContainText('estimation');
    await expect(pane(page).locator('.chain-coverage')).not.toContainText('Top des pending');
    await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
    expect(heldRequests).toBeGreaterThan(0);
    expect(completedBitcoinResponses).toBe(completedAtHold);
    await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
    await expect(pane(page).locator('[data-projection-source="confirmed-block"]')).toHaveCount(0);
    await expect(pane(page).locator('.departure-timer')).toHaveText('—');
    await expect(panel).toHaveAttribute('data-selection-historical', 'true');
    await expect(
      panel.getByText('En attente lors de cette observation', { exact: true }),
    ).toBeVisible();
    await expect(observedTime).toHaveAttribute('datetime', new Date(OBSERVED_AT).toISOString());
    await expect(panel).toContainText('Présence actuelle dans le mempool inconnue.');
    await page.screenshot({
      path: testInfo.outputPath('bitcoin-expired-candidate-during-unanswered-fetch.png'),
      fullPage: true,
    });

    // The independent 120 s observation boundary still fires after the candidate boundary.
    const observationExpiredAt = OBSERVED_AT + 3_000 + 120_050;
    await page.clock.fastForward(
      Math.max(0, observationExpiredAt - (await page.evaluate(() => Date.now()))),
    );
    await expect(pane(page).getByRole('status')).toHaveAttribute(
      'aria-label',
      'Source indisponible',
    );
    await expect(firstWagon(page)).toHaveCount(0);
    await expect(pane(page).locator('[data-template-group-count]')).toHaveCount(0);
    await expect(pane(page).locator('.departure-timer')).toHaveText('—');
    await expect(
      pane(page).getByRole('button', { name: 'Explorer la simulation', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(completedBitcoinResponses).toBe(completedAtHold);
  } finally {
    releaseHeld();
  }
});

test('a complete Bitcoin candidate groups unrepresented members and uses complete proposed fees without inventing individual transactions', async ({
  page,
}, testInfo) => {
  // Deliberately biased top-fee details: 2,000,000 sat each, not the full median of 100 sat.
  const members = Array.from({ length: 960 }, (_, index) => transaction(10_000 + index, 10_000));
  const included = members[0]!;
  const refresh = await routeStages(page, (stage) => {
    const parent = block('bitcoin', stage >= 3 ? 1 : 0);
    const pending = stage >= 3 ? members.slice(1) : members;
    return liveSnapshot('bitcoin', stage, pending, {
      blocks: [parent],
      pendingCount: 25_000,
      blockTemplate:
        stage === 1
          ? null
          : {
              ...template(pending, parent, OBSERVED_AT + stage * 3_000),
              transactionCount: 5_000,
              weight: 3_992_000,
              medianFeeSats: 100,
            },
      inclusions: stage >= 3 ? [{ block: parent, transactionIds: [included.id] }] : [],
    });
  });
  await page.goto('/');
  await expect(pane(page).getByRole('status')).toHaveAttribute('aria-label', 'Données en direct');
  // The full count is available even before every individual has boarded.
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'template');
  await expect(firstCounter(page)).toHaveAttribute('data-transaction-count', '5000');
  await expect(firstCounter(page)).toHaveAttribute('data-resource-used', '998000');
  await expect(firstCounter(page)).toHaveAttribute('data-resource-capacity', '1000000');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-percent', '99.8');
  await expect(templateGroup(page)).toHaveAttribute('data-template-group-count', '4040');
  await expect(templateGroup(page)).toHaveAttribute('data-template-individual-count', '960');
  await expect(templateGroup(page)).toHaveAttribute('role', 'group');
  await expect(templateGroup(page)).toHaveAttribute('pointer-events', 'none');
  await expect(templateGroup(page)).not.toHaveAttribute('tabindex');
  await expect(
    templateGroup(page).locator('button, a, [tabindex], [data-transaction-id]'),
  ).toHaveCount(0);
  await expect(pane(page).locator('canvas[data-renderer="canvas-2d"]')).toHaveCount(1);
  await expect(pane(page).locator('.chain-coverage')).toHaveAttribute(
    'data-template-count',
    '5000',
  );
  await page.getByRole('button', { name: 'Réduire les mouvements', exact: true }).click();
  await expectBoarded(page, included);
  const selector = await openTraveler(page, included);
  await expect(selector.locator('option')).toHaveCount(960);
  await expect(selector.locator('option').filter({ hasText: 'groupées' })).toHaveCount(0);
  await closeBrowser(page);
  // Boarding all known people does not count them again inside the anonymous group.
  await expect(templateGroup(page)).toHaveAttribute('data-template-group-count', '4040');
  await page.getByRole('button', { name: 'Afficher frais · Bitcoin', exact: true }).click();
  const fees = pane(page).locator('.info-billboard[data-page="Frais"]');
  await expect(fees).toHaveAttribute('data-fee-scope', 'template');
  await expect(fees.locator('.info-billboard-value')).toHaveText('0,000001');
  await expect(fees.locator('.info-billboard-unit')).toHaveText('BTC');
  await expect(fees).toContainText(/Candidat complet : 5[\s\u202f\u00a0'’]?000 tx/);
  await expect(fees).toContainText('Proposition hors coinbase');
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-complete-candidate-5000-transactions.png'),
    fullPage: true,
  });

  await refresh(1);
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'estimate');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'sample');
  await expect(firstCounter(page)).toHaveAttribute('data-transaction-count', '960');
  await expect(firstCounter(page)).toHaveAttribute('data-resource-used', '192000');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-percent', '19.2');
  await expect(templateGroup(page)).toHaveCount(0);
  await expect(fees).toHaveAttribute('data-fee-scope', 'sample');
  await expect(fees).toContainText('Échantillon : 960 tx');
  await expect(fees.locator('.info-billboard-value')).toContainText('0,02');
  await expect(fees.locator('.info-billboard-estimate')).toHaveCount(1);

  await refresh(2);
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'template');
  await expect(templateGroup(page)).toHaveAttribute('data-template-group-count', '4040');
  await expect(fees).toHaveAttribute('data-fee-scope', 'template');
  await page.getByRole('button', { name: 'Activer les mouvements', exact: true }).click();
  await refresh(3);
  // A real mined block supersedes the proposal as soon as departure preparation begins.
  await expect(firstWagon(page)).toHaveAttribute('data-projection-source', 'confirmed-block');
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-kind', 'block');
  await expect(firstCounter(page)).toHaveAttribute('data-resource-used', '500000');
  await expect(firstCounter(page)).toHaveAttribute('data-occupancy-percent', '50');
  await expect(pane(page).locator('[data-template-group-count]')).toHaveCount(0);
  await page.clock.runFor(1_150);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'false');
  await page.clock.runFor(2_000);
  await expect(firstWagon(page)).toHaveAttribute('data-moving', 'true');
  await expect(firstCounter(page)).toHaveAttribute('data-transaction-count', '1');
  await expect(pane(page).locator('[data-template-group-count]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('bitcoin-complete-proposal-not-a-confirmed-cohort.png'),
    fullPage: true,
  });
});
