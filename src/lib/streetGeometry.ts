import { PENDING_SAMPLE_LIMIT } from '../../shared/model';

/** Canonical right-platform geometry; the Bitcoin scene mirrors these coordinates at display. */
export interface StreetPoint {
  x: number;
  y: number;
}

export type WagonKind = 'next' | 'later';

export const SCENE_WIDTH = 460;
export const SCENE_HEIGHT = 740;
export const WAGON_WIDTH = 85;
export const WAGON_HEIGHT = 217;
export const WAGON_X = (SCENE_WIDTH - WAGON_WIDTH) / 2;
export const NEXT_WAGON_Y = 175;
export const LATER_WAGON_Y = 460;
/** Legacy coordinate names kept for existing callers while their model is migrated. */
export const OBSERVED_WAGON_Y = NEXT_WAGON_Y;
export const CANDIDATE_WAGON_Y = LATER_WAGON_Y;
export const PLATFORM_CORRIDOR_X = 298;
/** Incoming pedestrians cross this outer column before reaching their assigned queue places. */
export const ARRIVAL_LANE_X = 438;
export const ENTRY_DOOR_Y = 64;
export const EXIT_DOOR_Y = 176;
export const HISTORY_QUEUE_START = PENDING_SAMPLE_LIMIT * 2;
const DOOR_INSIDE_X = 270;
const DOOR_PLATFORM_X = 294;
const QUEUE_COLUMNS = 8;
const QUEUE_COLUMN_SPACING = 90 / (QUEUE_COLUMNS - 1);
const QUEUE_ROW_SPACING = 14;

export function wagonOrigin(kind: WagonKind): StreetPoint {
  return { x: WAGON_X, y: kind === 'next' ? NEXT_WAGON_Y : LATER_WAGON_Y };
}

export function boardingApproach(kind: WagonKind): StreetPoint {
  return { x: PLATFORM_CORRIDOR_X, y: wagonOrigin(kind).y + ENTRY_DOOR_Y };
}

export function entryDoorPoint(kind: WagonKind): StreetPoint {
  return { x: DOOR_INSIDE_X, y: wagonOrigin(kind).y + ENTRY_DOOR_Y };
}

export function exitDoorPoint(kind: WagonKind): StreetPoint {
  return { x: DOOR_INSIDE_X, y: wagonOrigin(kind).y + EXIT_DOOR_Y };
}

export function exitPlatformPoint(kind: WagonKind): StreetPoint {
  return { x: DOOR_PLATFORM_X, y: wagonOrigin(kind).y + EXIT_DOOR_Y };
}

export function wagonSeat(kind: WagonKind, index: number): StreetPoint {
  const slot = Math.max(0, index) % 12;
  return {
    x: 205 + (slot % 3) * 24.5,
    y: wagonOrigin(kind).y + 80 + Math.floor(slot / 3) * 30,
  };
}

export function queuePosition(index: number): StreetPoint {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  if (safeIndex >= HISTORY_QUEUE_START) {
    const historySlot = (safeIndex - HISTORY_QUEUE_START) % 16;
    return { x: 318 + (historySlot % 4) * 30, y: 568 + Math.floor(historySlot / 4) * 22 };
  }
  const currentSlot = safeIndex % PENDING_SAMPLE_LIMIT;
  // Assigned queue places start beside the upper entrance, then extend down the quay.
  // Surplus retained observations may overlap these places without changing queue order.
  return {
    x: 318 + (currentSlot % QUEUE_COLUMNS) * QUEUE_COLUMN_SPACING,
    y: NEXT_WAGON_Y + ENTRY_DOOR_Y + Math.floor(currentSlot / QUEUE_COLUMNS) * QUEUE_ROW_SPACING,
  };
}

/** Enter sideways from beyond the outer edge, never through the road or the top of the scene. */
export function arrivalStart(queueIndex: number): StreetPoint {
  return { x: SCENE_WIDTH + 28, y: queuePosition(queueIndex).y };
}

/** Door passengers stay clipped inside until they have completely reached the platform. */
export function isInsideDoorway(point: StreetPoint): boolean {
  return point.x < DOOR_PLATFORM_X;
}
