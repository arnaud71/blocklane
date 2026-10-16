/**
 * Local, deterministic browser benchmark. Build first, then serve dist with Vite preview.
 * node --import tsx scripts/benchmark-scene.ts --url http://127.0.0.1:4173 --label baseline
 * Compare sample sizes on the same production build with --sample-size 960 or 1920.
 * Optional attribution pass: --repetitions 1 --profiles desktop --profile
 * No source, dependency, browser timing or API limit is changed by this script.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { chromium, devices, expect, type CDPSession, type Page } from '@playwright/test';
import {
  MAX_INDIVIDUAL_HISTORY,
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type Block,
  type ChainId,
  type Snapshot,
  type Tx,
} from '../shared/model';

const args = process.argv.slice(2);
const argument = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
const url = new URL(argument('url', 'http://127.0.0.1:4173'));
if (
  !['http:', 'https:'].includes(url.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error('The benchmark accepts a local production preview only.');
const label = argument('label', 'baseline').replace(/[^a-zA-Z0-9_-]/g, '-');
const repetitions = Number(argument('repetitions', '3'));
const steadyMs = Number(argument('steady-ms', '8000'));
const departureMs = Number(argument('departure-ms', '6000'));
const interactionMs = Number(argument('interaction-ms', '2000'));
const sampleSize = Number(argument('sample-size', String(PENDING_SAMPLE_LIMIT)));
if (
  !Number.isInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 5 ||
  !Number.isInteger(sampleSize) ||
  sampleSize < 1 ||
  sampleSize > PENDING_SAMPLE_LIMIT ||
  ![steadyMs, departureMs, interactionMs].every(
    (duration) => Number.isFinite(duration) && duration >= 500 && duration <= 30_000,
  )
)
  throw new Error('Invalid bounded benchmark durations, repetitions or sample size.');
const profiles = argument('profiles', 'desktop,mobile').split(',');
if (profiles.some((profile) => !['desktop', 'mobile'].includes(profile)))
  throw new Error('Supported profiles: desktop,mobile.');
const profiling = args.includes('--profile');
const output = resolve(argument('output', `.local/performance/${label}`));
const scenarioVersion = 'variable-sample-nonce0-4096-gbt-fixed-history-bounded-inclusions-v3';
const historicalPerChain = Math.min(sampleSize * 2, MAX_INDIVIDUAL_HISTORY);
const chains: ChainId[] = ['bitcoin', 'ethereum'];
const SOURCE = 'Fixture locale de mesure de BlockLane';
const startTime = Date.now();
const hash = (chain: ChainId, value: number) =>
  `${chain === 'ethereum' ? '0x' : ''}${value.toString(16).padStart(64, '0')}`;

function transaction(chain: ChainId, cohort: number, index: number): Tx {
  const feeRate = 2 + ((sampleSize - index) % 80) / 4;
  return {
    id: hash(chain, 1 + cohort * sampleSize + index),
    chain,
    status: 'pending',
    feeRate,
    size: chain === 'bitcoin' ? 240 + (index % 7) * 110 : 40_000 + (index % 9) * 20_000,
    kind: index % 4 === 0 ? 'contract' : 'transfer',
    value: chain === 'bitcoin' ? '0.01 BTC' : '0.01 ETH',
    ...(chain === 'ethereum'
      ? {
          ethereum: {
            from: `0x${(cohort * sampleSize + index + 1).toString(16).padStart(40, '0')}`,
            nonce: '0',
            gasPriceWei: String(feeRate * 1_000_000_000),
          },
        }
      : {}),
  };
}

const cohorts = Object.fromEntries(
  chains.map((chain) => [
    chain,
    Array.from({ length: 4 }, (_, cohort) =>
      Array.from({ length: sampleSize }, (_, index) => transaction(chain, cohort, index)),
    ),
  ]),
) as Record<ChainId, Tx[][]>;

const bitcoinCoinbaseVbytes = 200;
const bitcoinDepartureVbytesBudget = 900_000;
let bitcoinConfirmedVbytes = 0;
const bitcoinConfirmed: Tx[] = [];
for (const tx of cohorts.bitcoin[2]!) {
  if (bitcoinConfirmedVbytes + tx.size + bitcoinCoinbaseVbytes > bitcoinDepartureVbytesBudget)
    break;
  bitcoinConfirmed.push(tx);
  bitcoinConfirmedVbytes += tx.size;
}
const departureTransactions: Record<ChainId, Tx[]> = {
  bitcoin: bitcoinConfirmed,
  // Declared gas limits need not be fully consumed. At this fixture's maximum
  // sample, 45M actual gas still exceeds the intrinsic 21K gas per transaction.
  ethereum: cohorts.ethereum[2]!,
};

function block(chain: ChainId, stage: number): Block {
  return {
    hash: hash(chain, 10_000 + (stage >= 3 ? 1 : 0)),
    height: (chain === 'bitcoin' ? 900_000 : 23_000_000) + (stage >= 3 ? 1 : 0),
    timestamp: Math.floor(startTime / 1_000) - (stage >= 3 ? 0 : 12),
    txCount:
      stage >= 3 ? departureTransactions[chain].length + (chain === 'bitcoin' ? 1 : 0) : 2_000,
    used:
      chain === 'bitcoin'
        ? stage >= 3
          ? bitcoinConfirmedVbytes + bitcoinCoinbaseVbytes
          : 900_000
        : 45_000_000,
    capacity: chain === 'bitcoin' ? 1_000_000 : 60_000_000,
  };
}

function snapshot(chain: ChainId, stage: number, observedAt = Date.now()): Snapshot {
  const transactions = cohorts[chain][stage]!;
  const latest = block(chain, stage);
  const present = transactions.map((tx) => tx.id);
  let selectedWeight = 0;
  // Reserve part of the candidate weight for its unrepresented transactions.
  const selectedBitcoinIds = transactions
    .filter((tx) => {
      if (chain !== 'bitcoin' || selectedWeight + tx.size * 4 > 2_800_000) return false;
      selectedWeight += tx.size * 4;
      return true;
    })
    .map((tx) => tx.id);
  const absent = cohorts[chain]
    .slice(0, Math.min(stage, 2))
    .flatMap((cohort) => cohort.map((tx) => tx.id))
    .slice(-MAX_INDIVIDUAL_HISTORY);
  return snapshotSchema.parse({
    chain,
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt,
    coverage: `Mesure locale déterministe étape ${stage}. Échantillon partiel de ${sampleSize} transactions ; confirmations exactes uniquement à l’étape 3.`,
    pendingCount: chain === 'bitcoin' ? 12_000 : null,
    feeRate: 1,
    feeUnit: chain === 'bitcoin' ? 'sat/vB' : 'Gwei',
    transactions,
    blocks: [latest],
    inclusions:
      stage >= 3
        ? [{ block: latest, transactionIds: departureTransactions[chain].map((tx) => tx.id) }]
        : [],
    sampling: {
      source: SOURCE,
      method: chain === 'bitcoin' ? 'getrawmempool' : 'txpool_content',
      observedAt,
      pendingCount: 12_000,
      ...(chain === 'bitcoin' ? { update: stage === 0 ? 'full' : 'incremental' } : {}),
      ...(chain === 'ethereum' ? { queuedCount: 0 } : {}),
    },
    poolObservation: {
      source: SOURCE,
      method: chain === 'bitcoin' ? 'getrawmempool' : 'txpool_content',
      observedAt,
      presentTransactionIds: present,
      queuedTransactionIds: [],
      absentTransactionIds: absent,
    },
    ...(chain === 'bitcoin'
      ? {
          blockTemplate: {
            source: SOURCE,
            observedAt,
            previousBlockHash: latest.hash,
            height: latest.height + 1,
            transactionCount: 4_096,
            weight: 3_800_000,
            weightLimit: 4_000_000,
            selectedTransactionIds: [
              ...selectedBitcoinIds,
              ...Array.from({ length: 4_096 - selectedBitcoinIds.length }, (_, index) =>
                hash(chain, 20_000 + index),
              ),
            ],
          },
        }
      : {}),
    ...(chain === 'ethereum'
      ? {
          ethereumProjection: {
            parentBlockHash: latest.hash,
            height: latest.height + 1,
            baseFeePerGasWei: '1000000000',
            source: 'calculated',
            observedAt,
          },
          ethereumDependencies: {
            source: SOURCE,
            observedAt,
            parentBlockHash: latest.hash,
            height: latest.height + 1,
            entries: transactions.map((tx) => ({
              transactionId: tx.id,
              from: tx.ethereum!.from,
              nonce: '0',
              predecessor: { state: 'root' },
            })),
          },
        }
      : {}),
  });
}

// Validate every synthetic response before a browser can request it.
for (const chain of chains) for (let stage = 0; stage <= 3; stage += 1) snapshot(chain, stage);
if (args.includes('--validate-only')) {
  console.log('All eight controlled snapshots satisfy the shared contract.');
  process.exit(0);
}
const assets = await Promise.all(
  (await readdir(resolve('dist/assets'))).map(async (name) => ({
    name,
    sha256: createHash('sha256')
      .update(await readFile(resolve('dist/assets', name)))
      .digest('hex'),
  })),
);

interface Measurement {
  durationMs: number;
  rafIntervalsMs: number[];
  callbackDurationsMs: number[];
  longTasks: { startTime: number; duration: number }[];
  interactions: { domReadyMs: number; nextRafMs: number }[];
}

/** Instrumentation is injected into this controlled browser only, never into the application. */
function installMeasurement() {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let recording = false;
  let startedAt = 0;
  let previousRaf = 0;
  let rafIntervalsMs: number[] = [];
  let callbackDurationsMs: number[] = [];
  let longTasks: { startTime: number; duration: number }[] = [];
  let interactions: { domReadyMs: number; nextRafMs: number }[] = [];
  window.requestAnimationFrame = (callback) =>
    nativeRaf((time) => {
      if (!recording) return callback(time);
      const start = performance.now();
      try {
        callback(time);
      } finally {
        callbackDurationsMs.push(performance.now() - start);
      }
    });
  const sample = (time: number) => {
    if (recording) {
      if (previousRaf) rafIntervalsMs.push(time - previousRaf);
      previousRaf = time;
    }
    nativeRaf(sample);
  };
  nativeRaf(sample);
  if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
    new PerformanceObserver((list) => {
      if (!recording) return;
      for (const entry of list.getEntries())
        if (entry.startTime >= startedAt)
          longTasks.push({ startTime: entry.startTime - startedAt, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: false });
  document.addEventListener(
    'click',
    (event) => {
      if (
        !recording ||
        !(event.target instanceof Element) ||
        !event.target.closest('button[aria-label^="Parcourir les transactions"]')
      )
        return;
      const clickAt = performance.now();
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.passenger-canvas-browser')) return;
        observer.disconnect();
        const domReadyMs = performance.now() - clickAt;
        nativeRaf(() => interactions.push({ domReadyMs, nextRafMs: performance.now() - clickAt }));
      });
      observer.observe(document.documentElement, { subtree: true, childList: true });
      setTimeout(() => observer.disconnect(), 5_000);
    },
    true,
  );
  Object.assign(window, {
    __blocklaneBenchmark: {
      start() {
        rafIntervalsMs = [];
        callbackDurationsMs = [];
        longTasks = [];
        interactions = [];
        previousRaf = 0;
        startedAt = performance.now();
        recording = true;
      },
      stop(): Measurement {
        recording = false;
        return {
          durationMs: performance.now() - startedAt,
          rafIntervalsMs,
          callbackDurationsMs,
          longTasks,
          interactions,
        };
      },
    },
  });
}

declare global {
  interface Window {
    __blocklaneBenchmark: { start(): void; stop(): Measurement };
  }
}

function distribution(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) => sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
  return {
    count: samples.length,
    mean: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
}

async function chromeMetrics(session: CDPSession) {
  const response = await session.send('Performance.getMetrics');
  return Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]));
}

async function measure(
  page: Page,
  session: CDPSession,
  phase: string,
  duration: number,
  stem: string,
  action?: () => Promise<void>,
) {
  const before = await chromeMetrics(session);
  if (profiling) await session.send('Profiler.start');
  await page.evaluate(() => window.__blocklaneBenchmark.start());
  await action?.();
  await page.waitForTimeout(duration);
  const samples = await page.evaluate(() => window.__blocklaneBenchmark.stop());
  const after = await chromeMetrics(session);
  if (profiling) {
    const { profile } = await session.send('Profiler.stop');
    await writeFile(resolve(output, `${stem}-${phase}.cpuprofile`), JSON.stringify(profile));
  }
  const cpu = Object.fromEntries(
    ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'].map(
      (name) => [name, (after[name] ?? 0) - (before[name] ?? 0)],
    ),
  );
  const cpuMsPerSecond = Object.fromEntries(
    ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => [
      name,
      (cpu[name]! * 1_000_000) / samples.durationMs,
    ]),
  );
  return {
    phase,
    durationMs: samples.durationMs,
    rafIntervalsMs: distribution(samples.rafIntervalsMs),
    appRafCallbackMs: distribution(samples.callbackDurationsMs),
    longTasks: {
      count: samples.longTasks.length,
      totalMs: samples.longTasks.reduce((sum, item) => sum + item.duration, 0),
      maxMs: Math.max(0, ...samples.longTasks.map((item) => item.duration)),
    },
    cpu,
    cpuMsPerSecond,
    jsHeapUsedBytes: after.JSHeapUsedSize,
    domNodes: after.Nodes,
    interaction: samples.interactions,
    samples,
  };
}

async function representedCount(page: Page, chain: ChainId, expected: number) {
  const name = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';
  await page
    .getByRole('button', { name: `Parcourir les transactions ${name}`, exact: true })
    .click();
  const browser = page.getByRole('dialog', { name: `Transactions observées ${name}` });
  await expect(browser.getByRole('combobox').locator('option')).toHaveCount(expected, {
    timeout: 15_000,
  });
  const count = await browser.getByRole('combobox').locator('option').count();
  await browser.getByRole('button', { name: 'Fermer les transactions', exact: true }).click();
  return count;
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const runs: {
  profile: string;
  repetition: number;
  viewport: { width: number; height: number } | null;
  deviceScaleFactor: number;
  loadedBundle: string;
  counts: Record<string, number[]>;
  phases: Awaited<ReturnType<typeof measure>>[];
  errors: string[];
  unexpectedRequests: string[];
}[] = [];
try {
  for (const profile of profiles) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const stem = `${profile}-${repetition}`;
      const context = await browser.newContext({
        ...(profile === 'mobile'
          ? devices['iPhone 13']
          : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
        reducedMotion: 'no-preference',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const unexpectedRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // tsx preserves function names using a tiny helper when serializing this function.
      // Keep the helper local to the injected script, without changing application globals.
      await page.addInitScript({
        content: `{ const __name = (value) => value; (${installMeasurement.toString()})(); }`,
      });
      let stage = 0;
      // Nothing from the browser can contact an upstream provider, even accidentally.
      await page.route('**/*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== url.origin) {
          unexpectedRequests.push(requestUrl.origin);
          return route.abort('blockedbyclient');
        }
        if (requestUrl.pathname === '/api/snapshot') {
          const chain = requestUrl.searchParams.get('chain');
          if (!chains.includes(chain as ChainId)) throw new Error('Unknown fixture chain.');
          return route.fulfill({ json: snapshot(chain as ChainId, stage) });
        }
        if (requestUrl.pathname.startsWith('/api/')) {
          unexpectedRequests.push(requestUrl.pathname);
          return route.fulfill({ status: 404, body: 'No benchmark fixture for this API.' });
        }
        return route.continue();
      });
      await page.goto(url.href);
      for (const chain of chains)
        await expect(
          page.locator(`.chain-pane[data-chain="${chain}"] .data-status`),
        ).toHaveAttribute('aria-label', 'Données en direct');
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      if (profiling) await session.send('Profiler.enable');
      const counts: Record<string, number[]> = {};
      counts.initial = [];
      for (const chain of chains)
        counts.initial.push(await representedCount(page, chain, sampleSize));
      if (repetition === 1)
        await page.screenshot({ path: resolve(output, `${profile}-initial.png`) });
      await page.waitForTimeout(1_500);
      const phases = [await measure(page, session, `current-${sampleSize}`, steadyMs, stem)];
      for (const nextStage of [1, 2]) {
        stage = nextStage;
        for (const chain of chains)
          await expect(
            page.locator(`.chain-pane[data-chain="${chain}"] .chain-coverage`),
          ).toHaveAttribute('title', new RegExp(`Mesure locale déterministe étape ${stage}\\.`), {
            timeout: 10_000,
          });
      }
      counts.withHistory = [];
      for (const chain of chains)
        counts.withHistory.push(
          await representedCount(page, chain, sampleSize + historicalPerChain),
        );
      if (repetition === 1)
        await page.screenshot({ path: resolve(output, `${profile}-history.png`) });
      await page.waitForTimeout(1_000);
      phases.push(
        await measure(
          page,
          session,
          `history-${historicalPerChain}-current-${sampleSize}`,
          steadyMs,
          stem,
        ),
      );
      phases.push(
        await measure(page, session, 'history-browser-open', interactionMs, stem, async () => {
          await page
            .getByRole('button', { name: 'Parcourir les transactions Bitcoin', exact: true })
            .click();
          await expect(
            page.getByRole('dialog', { name: 'Transactions observées Bitcoin' }),
          ).toBeVisible();
        }),
      );
      await page
        .getByRole('dialog', { name: 'Transactions observées Bitcoin' })
        .getByRole('button', {
          name: 'Fermer les transactions',
          exact: true,
        })
        .click();
      phases.push(
        await measure(page, session, 'verified-departure', departureMs, stem, async () => {
          stage = 3;
          for (const chain of chains)
            await expect(
              page.locator(`.chain-pane[data-chain="${chain}"] .chain-coverage`),
            ).toHaveAttribute('title', /Mesure locale déterministe étape 3\./, { timeout: 10_000 });
        }),
      );
      const loadedBundle = await page.locator('script[type="module"][src]').getAttribute('src');
      if (!loadedBundle || !assets.some((asset) => loadedBundle.endsWith(`/${asset.name}`)))
        throw new Error('This page is not running the recorded production bundle.');
      const run = {
        profile,
        repetition,
        viewport: page.viewportSize(),
        deviceScaleFactor: await page.evaluate(() => window.devicePixelRatio),
        loadedBundle,
        counts,
        phases,
        errors,
        unexpectedRequests,
      };
      runs.push(run);
      await writeFile(resolve(output, `${stem}.json`), JSON.stringify(run, null, 2));
      console.log(
        JSON.stringify({
          profile,
          repetition,
          counts,
          phases: phases.map(({ phase, cpu, longTasks, rafIntervalsMs }) => ({
            phase,
            cpu,
            longTasks,
            rafIntervalsMs,
          })),
        }),
      );
      if (errors.length || unexpectedRequests.length)
        throw new Error('Browser errors or unmocked requests invalidate this run.');
      await context.close();
    }
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        label,
        measuredAt: new Date().toISOString(),
        environment: {
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          node: process.version,
          browser: browser.version(),
        },
        assets,
        scenarioVersion,
        parameters: {
          repetitions,
          profiles,
          steadyMs,
          departureMs,
          interactionMs,
          profiling,
          pendingPerChain: sampleSize,
          pendingLimit: PENDING_SAMPLE_LIMIT,
          historicalPerChain,
          historicalLimit: MAX_INDIVIDUAL_HISTORY,
          historicalCohortsSupplied: 2,
          fullHistoricalCohortsRetained: Math.floor(historicalPerChain / sampleSize),
          evictedHistoricalPerChain: sampleSize * 2 - historicalPerChain,
          bitcoinDeparture: {
            confirmedTransactionCount: bitcoinConfirmed.length,
            confirmedVbytes: bitcoinConfirmedVbytes,
            coinbaseTransactionCount: 1,
            coinbaseVbytes: bitcoinCoinbaseVbytes,
            blockTransactionCount: block('bitcoin', 3).txCount,
            blockUsedVbytes: block('bitcoin', 3).used,
            blockCapacityVbytes: block('bitcoin', 3).capacity,
            budgetVbytes: bitcoinDepartureVbytesBudget,
          },
          ethereumDeparture: {
            confirmedTransactionCount: departureTransactions.ethereum.length,
            declaredGasLimitSum: departureTransactions.ethereum.reduce(
              (sum, tx) => sum + tx.size,
              0,
            ),
            blockGasUsed: block('ethereum', 3).used,
            blockGasLimit: block('ethereum', 3).capacity,
          },
        },
        interpretation:
          'rAF intervals measure main-thread opportunity, not physical display FPS. The application deliberately publishes at a bounded cadence. CDP CPU values are seconds; profile mode adds profiling overhead. Fixtures are synthetic and all API requests are intercepted. Two complete prior cohorts are supplied; individual history and absence evidence retain only the configured historical budget, so larger samples evict an older cohort instead of enlarging history. Browser-open interaction reports DOM-ready and next-rAF latency, not photon-to-screen latency.',
        runs,
        summary: profiles.flatMap((profile) =>
          (runs.find((run) => run.profile === profile)?.phases ?? []).map(({ phase }) => {
            const measurements = runs
              .filter((run) => run.profile === profile)
              .flatMap((run) => run.phases.filter((measurement) => measurement.phase === phase));
            return {
              profile,
              phase,
              repetitions: measurements.length,
              medianScriptMsPerSecond: distribution(
                measurements.map((measurement) => measurement.cpuMsPerSecond.ScriptDuration!),
              ).p50,
              medianTaskMsPerSecond: distribution(
                measurements.map((measurement) => measurement.cpuMsPerSecond.TaskDuration!),
              ).p50,
              medianRafP95Ms: distribution(
                measurements.map((measurement) => measurement.rafIntervalsMs.p95),
              ).p50,
              medianLongTaskCount: distribution(
                measurements.map((measurement) => measurement.longTasks.count),
              ).p50,
              medianLongTaskMsPerSecond: distribution(
                measurements.map(
                  (measurement) => (measurement.longTasks.totalMs * 1_000) / measurement.durationMs,
                ),
              ).p50,
              interactionDomReadyMs: distribution(
                measurements.flatMap((measurement) =>
                  measurement.interaction.map((interaction) => interaction.domReadyMs),
                ),
              ),
            };
          }),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`Benchmark saved to ${resolve(output, 'report.json')}`);
} finally {
  await browser.close();
}
