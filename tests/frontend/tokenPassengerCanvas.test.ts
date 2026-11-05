import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_HOUSES, HOUSE_IDS } from '../../shared/activityHouses';
import {
  createPassengerCanvasRenderer,
  hitTestCanvasPassenger,
  type CanvasPassenger,
  type CanvasPassengerFrame,
} from '../../src/lib/passengerCanvas';

interface PaintEvent {
  type: 'fill' | 'stroke' | 'image';
  style?: string;
  image?: TestCanvas;
}
interface TestCanvas {
  width: number;
  height: number;
  events: PaintEvent[];
  getContext: () => CanvasRenderingContext2D | null;
}
function context(events: PaintEvent[] = []): CanvasRenderingContext2D {
  const values: Record<string, unknown> = { fillStyle: '', strokeStyle: '' };
  return new Proxy(values, {
    get(target, key: string) {
      if (key === 'fill')
        return () => events.push({ type: 'fill', style: String(target.fillStyle) });
      if (key === 'stroke')
        return () => events.push({ type: 'stroke', style: String(target.strokeStyle) });
      if (key === 'drawImage') return (image: TestCanvas) => events.push({ type: 'image', image });
      if (!(key in target)) target[key] = () => undefined;
      return target[key];
    },
  }) as unknown as CanvasRenderingContext2D;
}
function canvasDocument(available = true): TestCanvas[] {
  const canvases: TestCanvas[] = [];
  vi.stubGlobal('document', {
    createElement() {
      const events: PaintEvent[] = [];
      const canvas: TestCanvas = {
        width: 0,
        height: 0,
        events,
        getContext: () => (available ? context(events) : null),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return canvases;
}
function passenger(index: number, usdt = false): CanvasPassenger {
  return {
    pose: {
      tx: {
        id: `0x${index.toString(16).padStart(64, '0')}`,
        chain: 'ethereum',
        status: 'pending',
        feeRate: 12,
        size: 21_000,
        kind: 'contract',
        value: '0 ETH',
        ...(usdt ? { tokens: [{ tokenId: 'usdt', operation: 'transfer', evidence: 'call' }] } : {}),
      },
      x: 40 + index * 12,
      y: 80,
      queueX: 40 + index * 12,
      queueY: 80,
      phase: 'queue',
      destination: 'queue',
      reason: 'observed',
      selectedForCandidate: false,
      inWagon: false,
      wagon: null,
      inHandoff: false,
      sourceObserved: true,
      headScale: 1,
      resourceUnits: 21_000,
      opacity: 1,
      progress: 1,
      facing: 1,
      walkPhase: 0,
    },
    color: '#ef9a42',
    interactive: true,
  };
}
const viewport = { width: 200, height: 160, ratio: 1 };
const frame = (passengers: CanvasPassenger[]): CanvasPassengerFrame => ({
  passengers,
  view: { startX: 0, width: 200, height: 160, mirrored: false },
});
const hasBadgePaint = (events: PaintEvent[]) =>
  events.some((event) => event.type === 'fill' && event.style === '#26a17b');
const drawsBadge = (events: PaintEvent[]) =>
  events.some(
    (event) => event.type === 'image' && event.image && hasBadgePaint(event.image.events),
  );

afterEach(() => vi.unstubAllGlobals());

describe('USDT Canvas passenger badge and category highlighting', () => {
  it('draws every recognized category once on a single traveler with the original fee shirt and hit area', () => {
    const canvases = canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const person = passenger(1, true);
    person.pose.tx.tokens!.push({
      tokenId: 'usdc',
      operation: 'transfer',
      evidence: 'call',
      amount: '2000000',
    });
    person.pose.tx.protocols = [
      { protocolId: 'uniswap', operation: 'execute', evidence: 'call' },
      { protocolId: 'aave', operation: 'supply', evidence: 'call' },
    ];
    const scene = frame([person]);
    const events: PaintEvent[] = [];
    renderer.draw(context(events), scene, viewport);
    for (const id of HOUSE_IDS) {
      const color = ACTIVITY_HOUSES[id].color;
      expect(
        canvases.filter((canvas) =>
          canvas.events.some((event) => event.type === 'fill' && event.style === color),
        ),
      ).toHaveLength(1);
    }
    expect(scene.passengers).toHaveLength(1);
    expect(person.color).toBe('#ef9a42');
    expect(hitTestCanvasPassenger(scene, viewport, person.pose.x - 3, 60)).toBe(person);
    const count = canvases.length;
    renderer.draw(context(), scene, viewport);
    expect(canvases).toHaveLength(count);
    renderer.dispose();
  });

  it('refreshes a warmed static raster when USDC and protocol badges arrive and when protocol highlighting changes', () => {
    const canvases = canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const people = Array.from({ length: 8 }, (_, index) => passenger(index));
    const scene = frame(people);
    renderer.draw(context(), scene, viewport);
    renderer.draw(context(), scene, viewport);
    const oldImages = canvases.filter((canvas) => canvas.width > 20 && canvas.height > 20);
    people[0]!.pose.tx.tokens = [
      { tokenId: 'usdc', operation: 'transfer', evidence: 'call', amount: '1' },
    ];
    people[0]!.pose.tx.protocols = [{ protocolId: 'aave', operation: 'borrow', evidence: 'call' }];
    const highlighted: PaintEvent[] = [];
    renderer.draw(context(highlighted), { ...scene, highlightHouseId: 'aave' }, viewport);
    expect(
      highlighted.some(
        (event) => event.type === 'stroke' && event.style === ACTIVITY_HOUSES.aave.color,
      ),
    ).toBe(true);
    expect(oldImages.some((canvas) => canvas.width === 0)).toBe(true);
    const ordinary: PaintEvent[] = [];
    renderer.draw(context(ordinary), scene, viewport);
    expect(
      ordinary.some(
        (event) => event.type === 'stroke' && event.style === ACTIVITY_HOUSES.aave.color,
      ),
    ).toBe(false);
    expect(people).toHaveLength(8);
    renderer.dispose();
  });

  it('uses one cached badge glyph and preserves fee colour and pointer selection', () => {
    const canvases = canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const people = [passenger(1, true), passenger(2, true), passenger(3)];
    const scene = frame(people);
    const events: PaintEvent[] = [];
    renderer.draw(context(events), scene, viewport);
    expect(canvases.filter((canvas) => hasBadgePaint(canvas.events))).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === 'image' && event.image && hasBadgePaint(event.image.events),
      ),
    ).toHaveLength(2);
    const count = canvases.length;
    renderer.draw(context(), scene, viewport);
    expect(canvases).toHaveLength(count);
    expect(people.every((person) => person.color === '#ef9a42')).toBe(true);
    expect(hitTestCanvasPassenger(scene, viewport, people[0]!.pose.x - 3, 60)).toBe(people[0]);
    renderer.dispose();
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('paints the badge directly if a reusable Canvas surface cannot be allocated', () => {
    canvasDocument(false);
    const renderer = createPassengerCanvasRenderer();
    const events: PaintEvent[] = [];
    renderer.draw(context(events), frame([passenger(1, true)]), viewport);
    expect(hasBadgePaint(events)).toBe(true);
    renderer.dispose();
  });

  it('invalidates a warmed collective raster when token metadata arrives on the same pose', () => {
    canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const people = Array.from({ length: 8 }, (_, index) => passenger(index));
    const scene = frame(people);
    renderer.draw(context(), scene, viewport);
    renderer.draw(context(), scene, viewport);
    const warm: PaintEvent[] = [];
    renderer.draw(context(warm), scene, viewport);
    expect(warm.filter((event) => event.type === 'image')).toHaveLength(1);
    people[0]!.pose.tx.tokens = [{ tokenId: 'usdt', operation: 'approval', evidence: 'call' }];
    const upgraded: PaintEvent[] = [];
    renderer.draw(context(upgraded), scene, viewport);
    expect(drawsBadge(upgraded)).toBe(true);
    renderer.dispose();
  });

  it('invalidates the collective raster when a category highlight is toggled', () => {
    canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const people = Array.from({ length: 8 }, (_, index) => passenger(index, index === 0));
    const scene = frame(people);
    renderer.draw(context(), scene, viewport);
    renderer.draw(context(), scene, viewport);
    const highlighted: PaintEvent[] = [];
    renderer.draw(context(highlighted), { ...scene, highlightTokenId: 'usdt' }, viewport);
    expect(
      highlighted.filter((event) => event.type === 'stroke' && event.style === '#7ce1bd'),
    ).toHaveLength(1);
    const unhighlighted: PaintEvent[] = [];
    renderer.draw(context(unhighlighted), scene, viewport);
    expect(unhighlighted.some((event) => event.style === '#7ce1bd')).toBe(false);
    expect(people).toHaveLength(8);
    renderer.dispose();
  });

  it('refreshes the departing collective image when token metadata is upgraded', () => {
    const canvases = canvasDocument();
    const renderer = createPassengerCanvasRenderer();
    const person = passenger(1);
    const scene: CanvasPassengerFrame = {
      ...frame([]),
      departure: {
        passengers: [person],
        clips: [{ x: 20, y: 30, width: 80, height: 70 }],
        offsetY: 0,
      },
    };
    renderer.draw(context(), scene, viewport);
    const previousDeparture = canvases.find(
      (canvas) => canvas.width === 80 && canvas.height === 70,
    );
    expect(previousDeparture).toBeDefined();
    person.pose.tx.tokens = [{ tokenId: 'usdt', operation: 'transfer', evidence: 'call' }];
    renderer.draw(context(), scene, viewport);
    expect(previousDeparture!.width).toBe(0);
    expect(canvases.some((canvas) => drawsBadge(canvas.events))).toBe(true);
    renderer.dispose();
  });
});
