import type { PassengerPose } from './passengerMotion';
import { isPassengerMoving, stablePassengerHash } from './passengerPresentation';

export interface CanvasClip {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface CanvasPassenger {
  pose: PassengerPose;
  color: string;
  feeLabel?: string;
  interactive: boolean;
  offsetY?: number;
  clips?: readonly CanvasClip[];
}

export interface CanvasSceneView {
  startX: number;
  width: number;
  height: number;
  mirrored: boolean;
}

export interface CanvasPassengerFrame {
  passengers: readonly CanvasPassenger[];
  view: CanvasSceneView;
  departure?: CanvasDepartureLayer;
}

export interface CanvasDepartureLayer {
  passengers: readonly CanvasPassenger[];
  clips: readonly CanvasClip[];
  offsetY: number;
}

export interface CanvasViewport {
  width: number;
  height: number;
  ratio: number;
}

interface CanvasProjection {
  scale: number;
  left: number;
  top: number;
}

function projection(view: CanvasSceneView, viewport: CanvasViewport): CanvasProjection | undefined {
  if (
    !Number.isFinite(view.width) ||
    !Number.isFinite(view.height) ||
    !Number.isFinite(view.startX) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    view.width <= 0 ||
    view.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return undefined;
  }
  const scale = Math.min(viewport.width / view.width, viewport.height / view.height);
  return {
    scale,
    left: (viewport.width - view.width * scale) / 2,
    top: (viewport.height - view.height * scale) / 2,
  };
}

export function canvasPassengerAnchor(
  frame: CanvasPassengerFrame,
  viewport: CanvasViewport,
  passenger: CanvasPassenger,
): { x: number; y: number } {
  const layout = projection(frame.view, viewport);
  if (!layout) return { x: 0, y: 0 };
  const logicalX = frame.view.mirrored
    ? frame.view.startX + frame.view.width - passenger.pose.x
    : passenger.pose.x - frame.view.startX;
  return {
    x: layout.left + logicalX * layout.scale,
    y: layout.top + (passenger.pose.y + (passenger.offsetY ?? 0)) * layout.scale,
  };
}

function containsClip(clip: CanvasClip, x: number, y: number): boolean {
  if (
    clip.width <= 0 ||
    clip.height <= 0 ||
    x < clip.x ||
    x > clip.x + clip.width ||
    y < clip.y ||
    y > clip.y + clip.height
  ) {
    return false;
  }
  const radius = Math.min(Math.max(0, clip.radius ?? 0), clip.width / 2, clip.height / 2);
  if (radius === 0) return true;
  const centerX = Math.max(clip.x + radius, Math.min(x, clip.x + clip.width - radius));
  const centerY = Math.max(clip.y + radius, Math.min(y, clip.y + clip.height - radius));
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

export function hitTestCanvasPassenger(
  frame: CanvasPassengerFrame,
  viewport: CanvasViewport,
  cssX: number,
  cssY: number,
): CanvasPassenger | undefined {
  const layout = projection(frame.view, viewport);
  if (!layout || !Number.isFinite(cssX) || !Number.isFinite(cssY)) return undefined;
  const viewX = (cssX - layout.left) / layout.scale;
  const viewY = (cssY - layout.top) / layout.scale;
  if (viewX < 0 || viewX > frame.view.width || viewY < 0 || viewY > frame.view.height) {
    return undefined;
  }
  const x = frame.view.mirrored
    ? frame.view.startX + frame.view.width - viewX
    : frame.view.startX + viewX;
  for (let index = frame.passengers.length - 1; index >= 0; index -= 1) {
    const passenger = frame.passengers[index];
    if (
      !passenger ||
      !passenger.interactive ||
      !passenger.pose.sourceObserved ||
      passenger.pose.opacity <= 0
    ) {
      continue;
    }
    const y = viewY - (passenger.offsetY ?? 0);
    if (passenger.clips && !passenger.clips.some((clip) => containsClip(clip, x, y))) continue;
    if (
      containsClip(
        { x: passenger.pose.x - 12, y: passenger.pose.y - 33, width: 25, height: 40, radius: 5 },
        x,
        y,
      )
    ) {
      return passenger;
    }
  }
  return undefined;
}

interface PassengerSprite {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

type SpritePainter = (context: CanvasRenderingContext2D) => void;

// One small surface per reusable glyph, never one surface per transaction.
// Four pixels per scene unit stay crisp at desktop DPR without unbounded atlases.
const SPRITE_DENSITY = 4;
const MAX_SHIRT_SPRITES = 256;
const MAX_HASHES = 2_048;
const MAX_DEPARTURE_PIXELS = 1_000_000;
const MAX_DEPARTURE_DIMENSION = 2_048;
const MAX_DEPARTURE_DENSITY = 4;
const skinPalette = ['#ebcba6', '#bf8f65', '#966746', '#d2ad84'] as const;

function createSprite(
  x: number,
  y: number,
  width: number,
  height: number,
  paint: SpritePainter,
): PassengerSprite | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * SPRITE_DENSITY);
  canvas.height = Math.ceil(height * SPRITE_DENSITY);
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.scale(SPRITE_DENSITY, SPRITE_DENSITY);
  context.translate(-x, -y);
  paint(context);
  return { canvas, x, y, width, height };
}

function releaseSprite(sprite: PassengerSprite): void {
  sprite.canvas.width = 0;
  sprite.canvas.height = 0;
}

function paintSprite(context: CanvasRenderingContext2D, sprite: PassengerSprite | undefined): void {
  if (!sprite) return;
  context.drawImage(sprite.canvas, sprite.x, sprite.y, sprite.width, sprite.height);
}

function roundedRectangle(context: CanvasRenderingContext2D, clip: CanvasClip): void {
  if (clip.width <= 0 || clip.height <= 0) return;
  const radius = Math.min(Math.max(0, clip.radius ?? 0), clip.width / 2, clip.height / 2);
  const { x, y, width, height } = clip;
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function paintHead(context: CanvasRenderingContext2D, variant: number): void {
  context.fillStyle = skinPalette[variant % skinPalette.length] ?? '#ebcba6';
  context.beginPath();
  context.arc(0, 0, 4.6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = variant % 2 === 0 ? '#344d39' : '#634d38';
  context.beginPath();
  if (variant % 3 === 0) {
    context.moveTo(-5, 0);
    context.quadraticCurveTo(-5, -7, 1, -6);
    context.quadraticCurveTo(7, -5, 5, 1);
    context.lineTo(1, -2);
  } else {
    context.moveTo(-4, -2);
    context.quadraticCurveTo(0, -8, 4, -2);
  }
  context.closePath();
  context.fill();
}

function paintShirt(context: CanvasRenderingContext2D, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-4, -17);
  context.quadraticCurveTo(0, -19, 4, -17);
  context.lineTo(6, -7);
  context.lineTo(-6, -7);
  context.closePath();
  context.fill();
}

const iconPainters: Record<string, SpritePainter> = {
  shadow(context) {
    context.fillStyle = 'rgba(11, 41, 37, 0.55)';
    context.beginPath();
    context.ellipse(0, 1, 7, 3, 0, 0, Math.PI * 2);
    context.fill();
  },
  contract(context) {
    context.fillStyle = '#e4c780';
    context.beginPath();
    roundedRectangle(context, { x: 5, y: -12, width: 5, height: 7, radius: 1 });
    context.fill();
  },
  confirmed(context) {
    context.fillStyle = '#9ad6a0';
    context.beginPath();
    context.arc(10, -27, 2.5, 0, Math.PI * 2);
    context.fill();
  },
  clock(context) {
    context.fillStyle = '#365048';
    context.strokeStyle = '#c7d3c5';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(10, -27, 3.2, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(10, -29);
    context.lineTo(10, -27);
    context.lineTo(11.5, -26);
    context.stroke();
  },
  arrow(context) {
    context.strokeStyle = '#f0bd7b';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-6, 0);
    context.lineTo(6, 0);
    context.moveTo(2, -4);
    context.lineTo(6, 0);
    context.lineTo(2, 4);
    context.stroke();
  },
};

const iconBounds: Record<string, readonly [number, number, number, number]> = {
  shadow: [-8, -3, 16, 8],
  contract: [4, -13, 7, 9],
  confirmed: [6, -31, 8, 8],
  clock: [5, -32, 10, 10],
  arrow: [-8, -6, 16, 12],
};

export function createPassengerCanvasRenderer(): {
  draw(
    context: CanvasRenderingContext2D,
    frame: CanvasPassengerFrame,
    viewport: CanvasViewport,
    selectedId?: string,
    highlightedId?: string,
  ): void;
  dispose(): void;
} {
  const heads = new Map<number, PassengerSprite>();
  const shirts = new Map<string, PassengerSprite>();
  const icons = new Map<string, PassengerSprite>();
  const hashes = new Map<string, number>();
  let departureImage:
    | {
        passengers: readonly CanvasPassenger[];
        clips: readonly CanvasClip[];
        mirrored: boolean;
        density: number;
        sprite?: PassengerSprite;
      }
    | undefined;

  function clearDepartureImage(): void {
    if (departureImage?.sprite) releaseSprite(departureImage.sprite);
    departureImage = undefined;
  }

  function hashFor(id: string): number {
    const previous = hashes.get(id);
    if (previous !== undefined) return previous;
    const hash = stablePassengerHash(id);
    if (hashes.size >= MAX_HASHES) {
      const oldest = hashes.keys().next().value;
      if (oldest !== undefined) hashes.delete(oldest);
    }
    hashes.set(id, hash);
    return hash;
  }

  function headFor(variant: number): PassengerSprite | undefined {
    const previous = heads.get(variant);
    if (previous) return previous;
    const sprite = createSprite(-7, -9, 15, 16, (context) => paintHead(context, variant));
    if (sprite) heads.set(variant, sprite);
    return sprite;
  }

  function shirtFor(color: string): PassengerSprite | undefined {
    const previous = shirts.get(color);
    if (previous) return previous;
    const sprite = createSprite(-7, -20, 14, 14, (context) => paintShirt(context, color));
    if (sprite) {
      if (shirts.size >= MAX_SHIRT_SPRITES) {
        const oldest = shirts.keys().next().value;
        if (oldest !== undefined) {
          const retired = shirts.get(oldest);
          if (retired) releaseSprite(retired);
          shirts.delete(oldest);
        }
      }
      shirts.set(color, sprite);
    }
    return sprite;
  }

  function iconFor(name: string): PassengerSprite | undefined {
    const previous = icons.get(name);
    if (previous) return previous;
    const paint = iconPainters[name];
    const bounds = iconBounds[name];
    if (!paint || !bounds) return undefined;
    const sprite = createSprite(bounds[0], bounds[1], bounds[2], bounds[3], paint);
    if (sprite) icons.set(name, sprite);
    return sprite;
  }

  function drawPassenger(
    context: CanvasRenderingContext2D,
    passenger: CanvasPassenger,
    mirrored: boolean,
    selectedId?: string,
    highlightedId?: string,
  ): void {
    const { pose, interactive } = passenger;
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || pose.opacity <= 0) return;
    const hash = hashFor(pose.tx.id);
    const skin = skinPalette[hash % skinPalette.length] ?? '#ebcba6';
    const step = isPassengerMoving(pose) ? Math.sin(pose.walkPhase) * 3.5 : 0;
    const facing = mirrored ? -pose.facing : pose.facing;
    const headScale = Math.max(0.8, Math.min(1.85, pose.headScale));
    context.save();
    context.translate(pose.x, pose.y);
    context.globalAlpha = Math.max(0, Math.min(1, pose.opacity));
    if (interactive && (pose.tx.id === selectedId || pose.tx.id === highlightedId)) {
      context.strokeStyle = '#f5d589';
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(0, 2, 11, 5, 0, 0, Math.PI * 2);
      context.stroke();
    }
    // Undo the street mirror locally: body, bag, eye and indicators stay readable.
    if (mirrored) context.scale(-1, 1);
    paintSprite(context, iconFor('shadow'));
    context.strokeStyle = '#183d36';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-3, -7);
    context.lineTo(-4 + step, 0);
    context.moveTo(3, -7);
    context.lineTo(4 - step, 0);
    context.stroke();
    paintSprite(context, shirtFor(passenger.color));
    context.strokeStyle = skin;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-5, -15);
    context.lineTo(-7, -8 - step);
    context.moveTo(5, -15);
    context.lineTo(7, -9 + step);
    context.stroke();
    context.save();
    context.translate(0, -22);
    context.scale(headScale, headScale);
    paintSprite(context, headFor(hash % 12));
    context.fillStyle = '#34504a';
    context.beginPath();
    context.arc(facing * 2.1, 0.1, 0.65, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (pose.tx.kind === 'contract') paintSprite(context, iconFor('contract'));
    if ((pose.sourceObserved || !interactive) && pose.tx.status === 'confirmed') {
      paintSprite(context, iconFor('confirmed'));
    }
    if (interactive && !pose.sourceObserved) paintSprite(context, iconFor('clock'));
    if (pose.phase === 'exiting' || pose.phase === 'returning') {
      const canonicalAngle = pose.movementAngle ?? (pose.facing === -1 ? 180 : 0);
      const movementAngle = mirrored ? 180 - canonicalAngle : canonicalAngle;
      context.save();
      context.translate(0, -36);
      context.rotate((movementAngle * Math.PI) / 180);
      paintSprite(context, iconFor('arrow'));
      context.restore();
    }
    context.restore();
  }

  function drawDeparture(
    context: CanvasRenderingContext2D,
    departure: CanvasDepartureLayer,
    mirrored: boolean,
    requestedDensity: number,
  ): void {
    const clips = departure.clips.filter(
      (clip) =>
        Number.isFinite(clip.x) &&
        Number.isFinite(clip.y) &&
        Number.isFinite(clip.width) &&
        Number.isFinite(clip.height) &&
        clip.width > 0 &&
        clip.height > 0,
    );
    const left = Math.min(...clips.map((clip) => clip.x));
    const top = Math.min(...clips.map((clip) => clip.y));
    const width = Math.max(...clips.map((clip) => clip.x + clip.width)) - left;
    const height = Math.max(...clips.map((clip) => clip.y + clip.height)) - top;
    const density = Math.min(
      Math.max(0.25, Math.min(MAX_DEPARTURE_DENSITY, requestedDensity)),
      MAX_DEPARTURE_DIMENSION / width,
      MAX_DEPARTURE_DIMENSION / height,
      Math.sqrt(MAX_DEPARTURE_PIXELS / (width * height)),
    );
    if (
      departureImage &&
      (departureImage.passengers !== departure.passengers ||
        departureImage.clips !== departure.clips ||
        departureImage.mirrored !== mirrored ||
        departureImage.density !== density)
    ) {
      clearDepartureImage();
    }
    if (!departureImage && Number.isFinite(density) && density > 0) {
      // A failed allocation is attempted once for these inputs, never once per animation frame.
      departureImage = {
        passengers: departure.passengers,
        clips: departure.clips,
        mirrored,
        density,
      };
      let canvas: HTMLCanvasElement | undefined;
      try {
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(width * density));
        canvas.height = Math.max(1, Math.floor(height * density));
        const imageContext = canvas.getContext('2d');
        if (imageContext) {
          // Fit the exact clip bounds into the bounded backing store, including fractional sizes.
          imageContext.scale(canvas.width / width, canvas.height / height);
          imageContext.translate(-left, -top);
          imageContext.beginPath();
          for (const clip of clips) roundedRectangle(imageContext, clip);
          imageContext.clip();
          for (const passenger of departure.passengers) {
            drawPassenger(imageContext, passenger, mirrored);
          }
          departureImage.sprite = { canvas, x: left, y: top, width, height };
        }
      } catch {
        // The individual drawing path still retains every occupant if raster allocation fails.
      }
      if (canvas && !departureImage.sprite) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    context.save();
    context.translate(0, departure.offsetY);
    if (departureImage?.sprite) {
      paintSprite(context, departureImage.sprite);
    } else {
      context.beginPath();
      for (const clip of departure.clips) roundedRectangle(context, clip);
      context.clip();
      for (const passenger of departure.passengers) drawPassenger(context, passenger, mirrored);
    }
    context.restore();
  }

  return {
    draw(context, frame, viewport, selectedId, highlightedId) {
      if (!frame.departure) clearDepartureImage();
      const ratio = Number.isFinite(viewport.ratio) && viewport.ratio > 0 ? viewport.ratio : 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const layout = projection(frame.view, viewport);
      if (!layout) return;
      context.save();
      context.translate(layout.left, layout.top);
      context.scale(layout.scale, layout.scale);
      context.translate(-frame.view.startX, 0);
      context.beginPath();
      context.rect(frame.view.startX, 0, frame.view.width, frame.view.height);
      context.clip();
      if (frame.view.mirrored) {
        context.translate(2 * frame.view.startX + frame.view.width, 0);
        context.scale(-1, 1);
      }
      if (frame.departure) {
        drawDeparture(context, frame.departure, frame.view.mirrored, layout.scale * ratio);
      }
      // Actors inside the same vehicle share one clip operation and transform.
      // Keep their original order so overlaps and hit testing agree.
      let index = 0;
      while (index < frame.passengers.length) {
        const first = frame.passengers[index];
        if (!first) break;
        const clips = first.clips;
        const offsetY = first.offsetY ?? 0;
        context.save();
        context.translate(0, offsetY);
        if (clips) {
          context.beginPath();
          for (const clip of clips) roundedRectangle(context, clip);
          context.clip();
        }
        do {
          const passenger = frame.passengers[index];
          if (!passenger) break;
          drawPassenger(context, passenger, frame.view.mirrored, selectedId, highlightedId);
          index += 1;
          const next = frame.passengers[index];
          if (!next || next.clips !== clips || (next.offsetY ?? 0) !== offsetY) break;
        } while (index < frame.passengers.length);
        context.restore();
      }
      context.restore();
    },
    dispose() {
      clearDepartureImage();
      for (const sprites of [heads, shirts, icons]) {
        for (const sprite of sprites.values()) releaseSprite(sprite);
        sprites.clear();
      }
      hashes.clear();
    },
  };
}
