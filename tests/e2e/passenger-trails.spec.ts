import { expect, test } from '@playwright/test';
import type {
  CanvasPassenger,
  CanvasPassengerFrame,
  CanvasViewport,
} from '../../src/lib/passengerCanvas';

/** A real Canvas pixel fixture; no blockchain API or DOM element per passenger. */
async function trailScenario() {
  const modulePath = '/src/lib/passengerCanvas.ts';
  const { createPassengerCanvasRenderer, hitTestCanvasPassenger } = (await import(
    modulePath
  )) as typeof import('../../src/lib/passengerCanvas');
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 360;
  document.body.append(canvas);
  const context = canvas.getContext('2d')!;
  const renderer = createPassengerCanvasRenderer();
  const viewport: CanvasViewport = { width: 500, height: 360, ratio: 1 };
  const trail = [
    { x: 300, y: 140 },
    { x: 300, y: 240 },
    { x: 370, y: 240 },
  ];
  const traveler: CanvasPassenger = {
    pose: {
      tx: {
        id: 'a'.repeat(64),
        chain: 'bitcoin',
        feeRate: 5,
        size: 200,
        status: 'confirmed',
        blockHash: 'b'.repeat(64),
        kind: 'transfer',
        value: 'Non mesurée',
      },
      x: 370,
      y: 240,
      queueX: 370,
      queueY: 240,
      phase: 'preparing',
      arrivalKind: 'late-inclusion',
      destination: 'queue',
      reason: 'observed',
      selectedForCandidate: false,
      inWagon: false,
      wagon: null,
      inHandoff: false,
      sourceObserved: true,
      headScale: 1,
      resourceUnits: 200,
      opacity: 1,
      progress: 0.5,
      facing: 1,
      walkPhase: 1.4,
      trail,
    },
    color: '#ef9a42',
    interactive: true,
  };
  let strokeCount = 0;
  const stroke = context.stroke;
  context.stroke = (() => {
    strokeCount += 1;
    Reflect.apply(stroke, context, []);
  }) as CanvasRenderingContext2D['stroke'];
  let gradients = 0;
  const gradient = context.createLinearGradient;
  context.createLinearGradient = ((...args) => {
    gradients += 1;
    return Reflect.apply(gradient, context, args);
  }) as CanvasRenderingContext2D['createLinearGradient'];
  const frame = (passenger: CanvasPassenger, mirrored = false): CanvasPassengerFrame => ({
    passengers: [passenger],
    view: { startX: 0, width: 500, height: 360, mirrored },
  });
  const paint = (passenger: CanvasPassenger, mirrored = false) => {
    strokeCount = 0;
    renderer.draw(context, frame(passenger, mirrored), viewport);
    return {
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      strokes: strokeCount,
    };
  };
  const noTrail = (passenger: CanvasPassenger) => ({
    ...passenger,
    pose: { ...passenger.pose, trail: undefined },
  });
  const extra = (actual: Uint8ClampedArray, baseline: Uint8ClampedArray, x: number, y: number) =>
    Math.max(
      0,
      actual[(y * canvas.width + x) * 4 + 3]! - baseline[(y * canvas.width + x) * 4 + 3]!,
    );
  const equals = (left: Uint8ClampedArray, right: Uint8ClampedArray) =>
    left.every((value, index) => value === right[index]);
  const plain = paint(noTrail(traveler));
  const moving = paint(traveler);
  const repeated = paint(traveler);
  const samples = {
    horizontal: extra(moving.pixels, plain.pixels, 335, 241),
    vertical: extra(moving.pixels, plain.pixels, 300, 220),
    diagonalShortcut: extra(moving.pixels, plain.pixels, 335, 220),
    beyond110: extra(moving.pixels, plain.pixels, 300, 185),
  };
  const parked: CanvasPassenger = {
    ...traveler,
    pose: { ...traveler.pose, phase: 'parked', progress: 1, walkPhase: 0 },
  };
  const waitingHasNoTrail = equals(paint(parked).pixels, paint(noTrail(parked)).pixels);
  const ordinary: CanvasPassenger = {
    ...traveler,
    pose: {
      ...traveler.pose,
      phase: 'walking',
      arrivalKind: 'new-observation',
      tx: { ...traveler.pose.tx, status: 'pending', blockHash: undefined },
    },
  };
  const ordinaryHasNoTrail = equals(paint(ordinary).pixels, paint(noTrail(ordinary)).pixels);
  const ordinaryConfirmed: CanvasPassenger = {
    ...traveler,
    pose: { ...traveler.pose, arrivalKind: 'new-observation' },
  };
  const ordinaryPreparationHasNoTrail = equals(
    paint(ordinaryConfirmed).pixels,
    paint(noTrail(ordinaryConfirmed)).pixels,
  );
  const notStarted: CanvasPassenger = {
    ...traveler,
    pose: { ...traveler.pose, progress: 0 },
  };
  const preparingHasNoTrail = equals(paint(notStarted).pixels, paint(noTrail(notStarted)).pixels);
  const reduced: CanvasPassenger = {
    ...traveler,
    pose: { ...traveler.pose, progress: 1 },
  };
  const settledHasNoTrail = equals(paint(reduced).pixels, paint(noTrail(reduced)).pixels);
  const boarded: CanvasPassenger = {
    ...traveler,
    pose: { ...traveler.pose, inWagon: true, wagon: 'next' },
  };
  const boardedHasNoTrail = equals(paint(boarded).pixels, paint(noTrail(boarded)).pixels);
  const mirrorPlain = paint(noTrail(traveler), true);
  const mirrored = paint(traveler, true);
  const mirrorSamples = {
    horizontal: extra(mirrored.pixels, mirrorPlain.pixels, 165, 241),
    vertical: extra(mirrored.pixels, mirrorPlain.pixels, 200, 220),
    diagonalShortcut: extra(mirrored.pixels, mirrorPlain.pixels, 165, 220),
    beyond110: extra(mirrored.pixels, mirrorPlain.pixels, 200, 185),
  };
  const clipped: CanvasPassenger = {
    ...traveler,
    clips: [{ x: 295, y: 225, width: 90, height: 35 }],
  };
  const clipPlain = paint(noTrail(clipped));
  const clipTrail = paint(clipped);
  const clipSamples = {
    inside: extra(clipTrail.pixels, clipPlain.pixels, 335, 241),
    outside: extra(clipTrail.pixels, clipPlain.pixels, 300, 220),
  };
  const hits = {
    traveler:
      hitTestCanvasPassenger(frame(traveler), viewport, 370, 220)?.pose.tx.id ===
      traveler.pose.tx.id,
    trail: hitTestCanvasPassenger(frame(traveler), viewport, 335, 241) === undefined,
    mirroredTraveler:
      hitTestCanvasPassenger(frame(traveler, true), viewport, 130, 220)?.pose.tx.id ===
      traveler.pose.tx.id,
    mirroredTrail: hitTestCanvasPassenger(frame(traveler, true), viewport, 165, 241) === undefined,
  };
  renderer.dispose();
  return {
    samples,
    mirrorSamples,
    clipSamples,
    hits,
    waitingHasNoTrail,
    ordinaryHasNoTrail,
    ordinaryPreparationHasNoTrail,
    preparingHasNoTrail,
    settledHasNoTrail,
    boardedHasNoTrail,
    pausedPixelsIdentical: equals(moving.pixels, repeated.pixels),
    additionalStrokes: moving.strokes - plain.strokes,
    gradients,
    visibleCanvases: document.querySelectorAll('canvas').length,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.route('**/passenger-trails-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Traînées contrôlées</title>',
    }),
  );
  await page.goto('/passenger-trails-test');
});

test('seule une inclusion réseau en préparation laisse une traînée longue et bornée qui suit les virages', async ({
  page,
}) => {
  const result = await page.evaluate(trailScenario);
  expect(result.samples.horizontal).toBeGreaterThan(0);
  expect(result.samples.vertical).toBeGreaterThan(0);
  expect(result.samples.diagonalShortcut).toBe(0);
  expect(result.samples.beyond110).toBe(0);
  expect(result.waitingHasNoTrail).toBe(true);
  expect(result.ordinaryHasNoTrail).toBe(true);
  expect(result.ordinaryPreparationHasNoTrail).toBe(true);
  expect(result.preparingHasNoTrail).toBe(true);
  expect(result.settledHasNoTrail).toBe(true);
  expect(result.boardedHasNoTrail).toBe(true);
  expect(result.pausedPixelsIdentical).toBe(true);
  expect(result.additionalStrokes).toBe(1);
  expect(result.gradients).toBe(0);
  expect(result.visibleCanvases).toBe(1);
});

test('miroir et découpes conservent le tracé sans agrandir la zone cliquable du voyageur', async ({
  page,
}) => {
  const result = await page.evaluate(trailScenario);
  expect(result.mirrorSamples.horizontal).toBeGreaterThan(0);
  expect(result.mirrorSamples.vertical).toBeGreaterThan(0);
  expect(result.mirrorSamples.diagonalShortcut).toBe(0);
  expect(result.mirrorSamples.beyond110).toBe(0);
  expect(result.clipSamples.inside).toBeGreaterThan(0);
  expect(result.clipSamples.outside).toBe(0);
  expect(Object.values(result.hits).every(Boolean)).toBe(true);
});
