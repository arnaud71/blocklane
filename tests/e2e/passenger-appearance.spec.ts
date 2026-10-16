import { expect, test } from '@playwright/test';
import type {
  CanvasPassenger,
  CanvasPassengerFrame,
  CanvasViewport,
} from '../../src/lib/passengerCanvas';

/** Real pixels and picking share the same renderer, including its warmed raster caches. */
async function appearanceScenario() {
  const modulePath = '/src/lib/passengerCanvas.ts';
  const { createPassengerCanvasRenderer, canvasPassengerAnchor, hitTestCanvasPassenger } =
    (await import(modulePath)) as typeof import('../../src/lib/passengerCanvas');
  const canvas = document.createElement('canvas');
  canvas.width = 1_000;
  canvas.height = 440;
  document.body.append(canvas);
  const context = canvas.getContext('2d')!;
  const viewport: CanvasViewport = { width: 500, height: 220, ratio: 2 };
  const renderer = createPassengerCanvasRenderer();
  const target: CanvasPassenger = {
    pose: {
      tx: {
        id: '0'.repeat(64),
        chain: 'ethereum',
        feeRate: 1,
        size: 168_000,
        status: 'pending',
        kind: 'contract',
        value: 'Non mesurée',
      },
      x: 40,
      y: 95,
      queueX: 40,
      queueY: 95,
      phase: 'parked',
      destination: 'queue',
      reason: 'observed',
      selectedForCandidate: false,
      inWagon: false,
      wagon: null,
      inHandoff: false,
      sourceObserved: true,
      headScale: 1,
      resourceUnits: 168_000,
      opacity: 1,
      progress: 1,
      facing: 1,
      walkPhase: 0,
    },
    color: '#f2d35d',
    interactive: true,
  };
  const frameFor = (
    passengers: readonly CanvasPassenger[],
    mirrored: boolean,
  ): CanvasPassengerFrame => ({
    passengers,
    view: { startX: 0, width: 500, height: 220, mirrored },
  });
  const paint = (frame: CanvasPassengerFrame, selected?: string) => {
    renderer.draw(context, frame, viewport, selected);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const pixel = (pixels: Uint8ClampedArray, x: number, y: number) => {
    const index =
      (Math.floor(y * viewport.ratio) * canvas.width + Math.floor(x * viewport.ratio)) * 4;
    return Array.from(pixels.slice(index, index + 4));
  };
  const count = (
    pixels: Uint8ClampedArray,
    anchor: { x: number; y: number },
    rect: { x: number; y: number; width: number; height: number },
    matches: (color: number[]) => boolean,
  ) => {
    let result = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += 0.5)
      for (let x = rect.x; x < rect.x + rect.width; x += 0.5)
        if (matches(pixel(pixels, anchor.x + x, anchor.y + y))) result += 1;
    return result;
  };
  const difference = (left: Uint8ClampedArray, right: Uint8ClampedArray) =>
    left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / left.length;
  const variants = [];
  for (const mirrored of [false, true]) {
    const frame = frameFor([target], mirrored);
    const anchor = canvasPassengerAnchor(frame, viewport, target);
    const contract = paint(frame);
    const transfer = paint(
      frameFor(
        [{ ...target, pose: { ...target.pose, tx: { ...target.pose.tx, kind: 'transfer' } } }],
        mirrored,
      ),
    );
    const cyan = count(
      contract,
      anchor,
      { x: 5, y: -12, width: 5, height: 7 },
      ([r = 0, g = 0, b = 0, a = 0]) => a > 220 && b > r + 80 && g > r + 70,
    );
    const darkMarks = [-9.7, -7.4].map((y) =>
      count(
        contract,
        anchor,
        { x: 6.5, y: y - 0.3, width: 1.5, height: 0.7 },
        ([r = 0, g = 0, b = 0, a = 0]) => a > 220 && r < 70 && g < 130 && b < 160,
      ),
    );
    const shirtRect = { x: -3, y: -14, width: 6, height: 5 };
    const yellow = count(
      contract,
      anchor,
      shirtRect,
      ([r = 0, g = 0, b = 0, a = 0]) => a > 220 && r > 220 && g > 180 && b < 120,
    );
    let shirtUnchanged = true;
    for (let y = shirtRect.y; y < shirtRect.y + shirtRect.height; y += 0.5)
      for (let x = shirtRect.x; x < shirtRect.x + shirtRect.width; x += 0.5)
        shirtUnchanged &&= pixel(contract, anchor.x + x, anchor.y + y).every(
          (channel, index) => channel === pixel(transfer, anchor.x + x, anchor.y + y)[index],
        );
    const passengers = Array.from({ length: 8 }, (_, index) => ({
      ...target,
      pose: {
        ...target.pose,
        headScale: 2.5,
        tx: { ...target.pose.tx, id: index.toString(16).padStart(64, '0') },
        x: 40 + index * 55,
      },
    }));
    const group = frameFor(passengers, mirrored);
    const cold = paint(group, target.pose.tx.id);
    paint(group, target.pose.tx.id);
    const warm = paint(group, target.pose.tx.id);
    let top: { x: number; y: number } | undefined;
    let side: { x: number; y: number } | undefined;
    for (let y = anchor.y - 44; y < anchor.y - 32; y += 0.5) {
      for (let x = anchor.x - 16; x < anchor.x + 17; x += 0.5) {
        if ((pixel(cold, x, y)[3] ?? 0) > 220) {
          top ??= { x: x + 0.25, y: y + 0.25 };
          if (x > anchor.x + 13) side ??= { x: x + 0.25, y: y + 0.25 };
        }
      }
    }
    // Hair can extend sideways lower than the very top of the head.
    for (let y = anchor.y - 32; !side && y < anchor.y - 18; y += 0.5)
      for (let x = anchor.x + 13; x < anchor.x + 17; x += 0.5)
        if ((pixel(cold, x, y)[3] ?? 0) > 220) side = { x: x + 0.25, y: y + 0.25 };
    const clicked = (point: { x: number; y: number } | undefined, current = group) =>
      !!point &&
      hitTestCanvasPassenger(current, viewport, point.x, point.y)?.pose.tx.id === target.pose.tx.id;
    const small = paint(
      frameFor([{ ...target, pose: { ...target.pose, headScale: 0.8 } }], mirrored),
    );
    const headRect = { x: -18, y: -44, width: 37, height: 26 };
    const visible = ([, , , a = 0]: number[]) => a > 220;
    const headAreaRatio =
      count(cold, anchor, headRect, visible) / count(small, anchor, headRect, visible);
    const clips = [{ x: 20, y: 65, width: 445, height: 45 }];
    const clipped = frameFor(
      passengers.map((passenger) => ({ ...passenger, clips })),
      mirrored,
    );
    const clippedPixels = paint(clipped);
    const clipHidesTop = !!top && pixel(clippedPixels, top.x, top.y)[3] === 0;
    const clipRejectsTop =
      !!top && hitTestCanvasPassenger(clipped, viewport, top.x, top.y) === undefined;
    const departure: CanvasPassengerFrame = {
      ...group,
      passengers: [],
      departure: { passengers, clips: [{ x: 20, y: 45, width: 445, height: 65 }], offsetY: 20 },
    };
    const leaving = paint(departure);
    const leavingAgain = paint(departure);
    const departureRetainsTop = !!top && (pixel(leaving, top.x, top.y + 20)[3] ?? 0) > 220;
    variants.push({
      mirrored,
      cyan,
      darkMarks,
      yellow,
      shirtUnchanged,
      headAreaRatio,
      topClickable: clicked(top),
      sideClickable: clicked(side),
      warmRetainsTop: !!top && (pixel(warm, top.x, top.y)[3] ?? 0) > 220,
      warmDifference: difference(cold, warm),
      clipHidesTop,
      clipRejectsTop,
      departureRetainsTop,
      departureStable: difference(leaving, leavingAgain) === 0,
    });
  }
  renderer.dispose();
  return { variants, visibleCanvases: document.querySelectorAll('canvas').length };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.route('**/passenger-appearance-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Apparence contrôlée</title>',
    }),
  );
  await page.goto('/passenger-appearance-test');
});

test('le contrat cyan possède deux marques distinctes du t-shirt jaune, y compris en miroir', async ({
  page,
}) => {
  const result = await page.evaluate(appearanceScenario);
  for (const variant of result.variants) {
    expect(variant.cyan).toBeGreaterThan(15);
    expect(variant.darkMarks.every((count) => count > 0)).toBe(true);
    expect(variant.yellow).toBeGreaterThan(40);
    expect(variant.shirtUnchanged).toBe(true);
  }
  expect(result.visibleCanvases).toBe(1);
});

test('les grandes têtes restent distinctives, cliquables et entières dans les caches avec miroir et découpes', async ({
  page,
}) => {
  const result = await page.evaluate(appearanceScenario);
  for (const variant of result.variants) {
    expect(variant.headAreaRatio).toBeGreaterThan(4);
    expect(variant.topClickable).toBe(true);
    expect(variant.sideClickable).toBe(true);
    expect(variant.warmRetainsTop).toBe(true);
    expect(variant.warmDifference).toBeLessThan(0.3);
    expect(variant.clipHidesTop).toBe(true);
    expect(variant.clipRejectsTop).toBe(true);
    expect(variant.departureRetainsTop).toBe(true);
    expect(variant.departureStable).toBe(true);
  }
});
