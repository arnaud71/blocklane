import { expect, test } from '@playwright/test';
import type {
  CanvasPassenger,
  CanvasPassengerFrame,
  CanvasViewport,
} from '../../src/lib/passengerCanvas';

async function rendererScenario(mode: string) {
  const modulePath = '/src/lib/passengerCanvas.ts';
  const { createPassengerCanvasRenderer, canvasPassengerAnchor, hitTestCanvasPassenger } =
    (await import(modulePath)) as typeof import('../../src/lib/passengerCanvas');
  const makePassenger = (index: number, x = 80, y = 80): CanvasPassenger => ({
    pose: {
      tx: {
        id: index.toString(16).padStart(64, '0'),
        chain: 'bitcoin',
        feeRate: index + 1,
        size: 200,
        status: 'pending',
        kind: index % 3 === 0 ? 'contract' : 'transfer',
        value: '0.01 BTC',
      },
      x,
      y,
      queueX: x,
      queueY: y,
      phase: 'parked',
      destination: 'queue',
      reason: 'observed',
      selectedForCandidate: false,
      inWagon: false,
      wagon: null,
      inHandoff: false,
      sourceObserved: index % 2 === 0,
      headScale: index % 2 === 0 ? 2.5 : 0.8,
      resourceUnits: 200,
      opacity: 1,
      progress: 1,
      facing: index % 2 === 0 ? 1 : -1,
      walkPhase: 0,
    },
    color: index % 2 === 0 ? '#ef9a42' : '#db4e47',
    interactive: true,
  });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const renderer = createPassengerCanvasRenderer();
  const created: HTMLCanvasElement[] = [];
  const createElement = document.createElement.bind(document);
  document.createElement = ((...args: Parameters<Document['createElement']>) => {
    const element = createElement(...args);
    if (element instanceof HTMLCanvasElement) created.push(element);
    return element;
  }) as Document['createElement'];
  let strokes = 0;
  const originalStroke = context.stroke;
  context.stroke = (() => {
    strokes += 1;
    Reflect.apply(originalStroke, context, []);
  }) as CanvasRenderingContext2D['stroke'];
  const draw = (
    frame: CanvasPassengerFrame,
    viewport: CanvasViewport,
    selected?: string,
    highlighted?: string,
  ) => {
    const width = Math.ceil(viewport.width * viewport.ratio);
    const height = Math.ceil(viewport.height * viewport.ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    strokes = 0;
    renderer.draw(context, frame, viewport, selected, highlighted);
    return strokes;
  };
  const result = {
    comparisons: [] as { label: string; meanDifference: number; changedFraction: number }[],
    warmStrokes: 0,
    coldStrokes: 0,
    hitPreserved: true,
    maxPixels: 0,
    maxSurfaces: 0,
    maxDimension: 0,
    releasedOnResize: false,
    releasedOnRemoval: false,
    releasedOnDispose: false,
    attempts: 0,
    repeatedAttempts: 0,
  };
  if (mode === 'fidelity') {
    const clips = [{ x: 58, y: 34, width: 64, height: 66, radius: 8 }];
    const passengers = Array.from({ length: 16 }, (_, index) => ({
      ...makePassenger(index + 1, 60 + (index % 4) * 12, 65 + Math.floor(index / 4) * 8),
      clips,
    }));
    const walking = makePassenger(100, 78, 83);
    walking.pose = { ...walking.pose, phase: 'walking', walkPhase: 1.4 };
    passengers.splice(8, 0, { ...walking, clips });
    let frame: CanvasPassengerFrame = {
      passengers,
      view: { startX: 0, width: 180, height: 160, mirrored: false },
    };
    let viewport = { width: 180, height: 160, ratio: 1.5 };
    let selected = passengers[0]!.pose.tx.id;
    let highlighted = passengers.at(-1)!.pose.tx.id;
    const compare = (label: string) => {
      const reference = createElement('canvas');
      reference.width = canvas.width;
      reference.height = canvas.height;
      const referenceContext = reference.getContext('2d')!;
      const cold = createPassengerCanvasRenderer();
      cold.draw(referenceContext, frame, viewport, selected, highlighted);
      const expected = referenceContext.getImageData(0, 0, canvas.width, canvas.height).data;
      const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let difference = 0;
      let changedPixels = 0;
      for (let index = 0; index < actual.length; index += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const error = Math.abs(actual[index + channel]! - expected[index + channel]!);
          difference += error;
          changed ||= error > 3;
        }
        if (changed) changedPixels += 1;
      }
      result.comparisons.push({
        label,
        meanDifference: difference / actual.length,
        changedFraction: changedPixels / (actual.length / 4),
      });
      cold.dispose();
    };
    const variants = [
      'initial',
      'selection',
      'color',
      'pose',
      'clip',
      'offset',
      'mirror',
      'fractional-density',
      'moving-interleave',
    ];
    for (const label of variants) {
      if (label === 'selection') {
        selected = passengers.at(-1)!.pose.tx.id;
        highlighted = passengers[1]!.pose.tx.id;
      } else if (label === 'color') {
        frame = {
          ...frame,
          passengers: frame.passengers.map((passenger, index) =>
            index === 0 ? { ...passenger, color: '#f2d35d' } : passenger,
          ),
        };
      } else if (label === 'pose') {
        frame = {
          ...frame,
          passengers: frame.passengers.map((passenger, index) =>
            index === 1 ? { ...passenger, pose: { ...passenger.pose, x: 90 } } : passenger,
          ),
        };
      } else if (label === 'clip') {
        const nextClips = [{ x: 65, y: 40, width: 46, height: 60, radius: 4 }];
        frame = {
          ...frame,
          passengers: frame.passengers.map((passenger) => ({ ...passenger, clips: nextClips })),
        };
      } else if (label === 'offset') {
        frame = {
          ...frame,
          passengers: frame.passengers.map((passenger) => ({ ...passenger, offsetY: 11.25 })),
        };
      } else if (label === 'mirror') frame = { ...frame, view: { ...frame.view, mirrored: true } };
      else if (label === 'fractional-density') viewport = { width: 231, height: 173, ratio: 1.25 };
      else if (label === 'moving-interleave') {
        const actors = [...frame.passengers];
        const [mover] = actors.splice(8, 1);
        actors.splice(10, 0, mover!);
        frame = { ...frame, passengers: actors };
      }
      result.coldStrokes = draw(frame, viewport, selected, highlighted);
      compare(`${label}-invalidated`);
      draw(frame, viewport, selected, highlighted);
      result.warmStrokes = draw(frame, viewport, selected, highlighted);
      compare(`${label}-warm`);
      const target = frame.passengers.at(-1)!;
      const anchor = canvasPassengerAnchor(frame, viewport, target);
      const hit = hitTestCanvasPassenger(frame, viewport, anchor.x, anchor.y - 10);
      result.hitPreserved &&= hit?.pose.tx.id === target.pose.tx.id;
    }
  } else if (mode === 'limits') {
    const frameFor = (groups: number, spread: number): CanvasPassengerFrame => ({
      view: { startX: 0, width: 600, height: 1_600, mirrored: false },
      passengers: Array.from({ length: groups }, (_, group) => {
        const actors = Array.from({ length: 8 }, (_, index) =>
          makePassenger(group * 20 + index + 1, 30 + index * spread, 90 + group * 50),
        );
        const moving = makePassenger(group * 20 + 15, 570, 90 + group * 50);
        moving.pose = { ...moving.pose, phase: 'walking' };
        return [...actors, moving];
      }).flat(),
    });
    const viewport = { width: 1_200, height: 3_200, ratio: 1 };
    const frame = frameFor(24, 65);
    draw(frame, viewport);
    draw(frame, viewport);
    draw(frame, viewport);
    const surfaces = created.filter((surface) => surface.width > 64 || surface.height > 64);
    result.maxPixels = surfaces.reduce((sum, surface) => sum + surface.width * surface.height, 0);
    result.maxSurfaces = surfaces.length;
    result.maxDimension = Math.max(
      ...surfaces.flatMap((surface) => [surface.width, surface.height]),
    );
    draw(frame, { ...viewport, width: 1_201 });
    result.releasedOnResize = surfaces.every(
      (surface) => surface.width === 0 && surface.height === 0,
    );
    const smallFrame = frameFor(24, 6);
    for (let index = 0; index < 3; index += 1) draw(smallFrame, viewport);
    const retained = created.filter((surface) => surface.width > 64 || surface.height > 64);
    result.maxSurfaces = Math.max(result.maxSurfaces, retained.length);
    draw({ ...smallFrame, passengers: [] }, viewport);
    result.releasedOnRemoval = retained.every(
      (surface) => surface.width === 0 && surface.height === 0,
    );
    for (let index = 0; index < 2; index += 1) draw(smallFrame, viewport);
    const last = created.filter((surface) => surface.width > 64 || surface.height > 64);
    renderer.dispose();
    result.releasedOnDispose = last.every((surface) => surface.width === 0 && surface.height === 0);
  } else {
    const frame: CanvasPassengerFrame = {
      view: { startX: 0, width: 180, height: 160, mirrored: false },
      passengers: Array.from({ length: 8 }, (_, index) =>
        makePassenger(index + 1, 30 + index * 12),
      ),
    };
    const viewport = { width: 180, height: 160, ratio: 1.5 };
    draw(frame, viewport); // Reusable glyphs are warmed before refusing the larger surface.
    document.createElement = ((...args: Parameters<Document['createElement']>) => {
      const element = createElement(...args);
      if (element instanceof HTMLCanvasElement) {
        result.attempts += 1;
        element.getContext = (() => null) as HTMLCanvasElement['getContext'];
      }
      return element;
    }) as Document['createElement'];
    result.coldStrokes = draw(frame, viewport);
    const attempts = result.attempts;
    for (let index = 0; index < 3; index += 1) result.warmStrokes = draw(frame, viewport);
    result.repeatedAttempts = result.attempts - attempts;
  }
  renderer.dispose();
  document.createElement = createElement;
  return result;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/canvas-static-cache-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Canvas contrôlé</title>',
    }),
  );
  await page.goto('/canvas-static-cache-test');
});

test('le cache conserve les recouvrements, les clips, les sélections et les coordonnées fractionnaires', async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(rendererScenario, 'fidelity');
  await testInfo.attach('canvas-static-comparisons', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  for (const comparison of result.comparisons) {
    // Twice the measured worst-case antialiasing delta, including mirrored fractional pixels.
    expect(comparison.meanDifference, comparison.label).toBeLessThan(0.3);
    expect(comparison.changedFraction, comparison.label).toBeLessThan(0.025);
  }
  expect(result.warmStrokes).toBeLessThan(result.coldStrokes);
  expect(result.hitPreserved).toBe(true);
});

test('les surfaces collectives restent bornées et libèrent leur mémoire', async ({ page }) => {
  const result = await page.evaluate(rendererScenario, 'limits');
  expect(result.maxPixels).toBeGreaterThan(500_000);
  expect(result.maxPixels).toBeLessThanOrEqual(1_000_000);
  expect(result.maxSurfaces).toBe(16);
  expect(result.maxDimension).toBeLessThanOrEqual(2_048);
  expect(result.releasedOnResize).toBe(true);
  expect(result.releasedOnRemoval).toBe(true);
  expect(result.releasedOnDispose).toBe(true);
});

test('un refus de surface conserve le dessin individuel sans réessayer à chaque frame', async ({
  page,
}) => {
  const result = await page.evaluate(rendererScenario, 'allocation');
  expect(result.attempts).toBe(1);
  expect(result.repeatedAttempts).toBe(0);
  expect(result.coldStrokes).toBeGreaterThan(0);
  expect(result.warmStrokes).toBe(result.coldStrokes);
});
