/** Shared scene geometry keeps pedestrians on the right platform at every viewport size. */
export interface StreetPoint {
  x: number;
  y: number;
}

export type WagonKind = 'candidate' | 'observed';

export const SCENE_WIDTH = 460;
export const SCENE_HEIGHT = 740;
export const WAGON_WIDTH = 85;
export const WAGON_HEIGHT = 217;
export const WAGON_X = (SCENE_WIDTH - WAGON_WIDTH) / 2;
export const OBSERVED_WAGON_Y = 175;
export const CANDIDATE_WAGON_Y = 460;
export const PLATFORM_CORRIDOR_X = 298;
export const ENTRY_DOOR_Y = 64;
export const EXIT_DOOR_Y = 176;
const DOOR_INSIDE_X = 270;
const DOOR_PLATFORM_X = 294;

export function wagonOrigin(kind: WagonKind): StreetPoint {
  return { x: WAGON_X, y: kind === 'observed' ? OBSERVED_WAGON_Y : CANDIDATE_WAGON_Y };
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
  const boundedIndex = Math.max(0, index) % 80;
  return { x: 318 + (boundedIndex % 4) * 30, y: 118 + Math.floor(boundedIndex / 4) * 28 };
}

/** Door passengers stay clipped inside until they have completely reached the platform. */
export function isInsideDoorway(point: StreetPoint): boolean {
  return point.x < DOOR_PLATFORM_X;
}
