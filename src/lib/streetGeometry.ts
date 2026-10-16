import { PENDING_SAMPLE_LIMIT } from '../../shared/model';

/** Canonical right-platform geometry; the Bitcoin scene mirrors these coordinates at display. */
export interface StreetPoint {
  x: number;
  y: number;
}

/** Physical waiting places, shared by current and historical observations. */
export interface QueueLayout {
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
}

export type WagonKind = 'next' | 'later';
export type PassengerQueueZone = 'active' | 'history';

export const SCENE_WIDTH = 460;
export const SCENE_HEIGHT = 740;
export const WAGON_WIDTH = 85;
export const WAGON_HEIGHT = 217;
export const WAGON_X = (SCENE_WIDTH - WAGON_WIDTH) / 2;
/** Illustrated places only; this is not the transaction capacity of a real block. */
export const WAGON_SEAT_COUNT = 96;
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
/** The unobserved network is a source of late discoveries, never a local pool count. */
export const NETWORK_BOX_RECT = { x: 434, y: 28, width: 26, height: 88 } as const;
export const NETWORK_VESTIBULE_Y = 140;
/** Fan out only after clearing the cabinet, entirely above the active waiting area. */
export const NETWORK_FLOW_LANES = [NETWORK_VESTIBULE_Y, 122, 104, 86] as const;
export const NETWORK_FLOW_BRANCH_X = 410;
const DOOR_INSIDE_X = 270;
const DOOR_PLATFORM_X = 294;
const WAGON_SEAT_COLUMNS = 8;
const WAGON_SEAT_COLUMN_SPACING = 49 / (WAGON_SEAT_COLUMNS - 1);
const WAGON_SEAT_ROW_SPACING = 9;
export const ACTIVE_QUEUE_AREA = { x: 318, y: 200, width: 90, height: 280 } as const;
export const HISTORICAL_QUEUE_AREA = { x: 318, y: 560, width: 90, height: 80 } as const;
const QUEUE_START_X = ACTIVE_QUEUE_AREA.x;
const QUEUE_END_X = ACTIVE_QUEUE_AREA.x + ACTIVE_QUEUE_AREA.width;
// Leave room for the tallest heads and historical clocks below the queue legend.
const QUEUE_START_Y = ACTIVE_QUEUE_AREA.y;
const QUEUE_ROWS = 9;
const HISTORICAL_QUEUE_ROWS = 3;
const QUEUE_ROW_SPACING = 35;
const HISTORICAL_QUEUE_ROW_SPACING = 40;
const QUEUE_PERSON_SPACING = 32;

/** Match the number of columns to the projected quay, without stretching people. */
export function createQueueLayout(projectionScale = 1): QueueLayout {
  const safeScale = Number.isFinite(projectionScale) && projectionScale > 0 ? projectionScale : 1;
  const columns = Math.max(
    1,
    Math.min(
      64,
      Math.floor(((QUEUE_END_X - QUEUE_START_X) * safeScale) / QUEUE_PERSON_SPACING) + 1,
    ),
  );
  return { columns, rows: QUEUE_ROWS, capacity: columns * QUEUE_ROWS };
}

export const DEFAULT_QUEUE_LAYOUT = createQueueLayout();

/** Late, source-proved inclusions enter from the lower edge of the network box. */
export function networkBoxExit(): StreetPoint {
  return {
    x: NETWORK_BOX_RECT.x + NETWORK_BOX_RECT.width / 2,
    y: NETWORK_BOX_RECT.y + NETWORK_BOX_RECT.height,
  };
}

export function networkBoxArrivalPath(laneIndex = 0): StreetPoint[] {
  const exit = networkBoxExit();
  const lane = Number.isFinite(laneIndex) ? Math.max(0, Math.floor(laneIndex)) : 0;
  const laneY = NETWORK_FLOW_LANES[lane % NETWORK_FLOW_LANES.length]!;
  return [
    exit,
    { x: exit.x, y: NETWORK_VESTIBULE_Y },
    ...(laneY === NETWORK_VESTIBULE_Y
      ? []
      : [
          { x: NETWORK_FLOW_BRANCH_X, y: NETWORK_VESTIBULE_Y },
          { x: NETWORK_FLOW_BRANCH_X, y: laneY },
        ]),
    { x: PLATFORM_CORRIDOR_X, y: laneY },
  ];
}

/** A separate upper passage joins the doorway without crossing any waiting place. */
export function networkBoxBoardingPath(seatIndex: number, laneIndex = 0): StreetPoint[] {
  return [
    ...networkBoxArrivalPath(laneIndex),
    boardingApproach('next'),
    entryDoorPoint('next'),
    wagonSeat('next', seatIndex),
  ];
}

/** Separate physical places for unknown/absent historical observations on the same outer quay. */
export function historicalQueueLayout(layout: QueueLayout = DEFAULT_QUEUE_LAYOUT): QueueLayout {
  return {
    columns: layout.columns,
    rows: HISTORICAL_QUEUE_ROWS,
    capacity: layout.columns * HISTORICAL_QUEUE_ROWS,
  };
}

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
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const slot = safeIndex % WAGON_SEAT_COUNT;
  return {
    x: WAGON_X + 17.5 + (slot % WAGON_SEAT_COLUMNS) * WAGON_SEAT_COLUMN_SPACING,
    y: wagonOrigin(kind).y + 80 + Math.floor(slot / WAGON_SEAT_COLUMNS) * WAGON_SEAT_ROW_SPACING,
  };
}

export function queuePosition(
  index: number,
  layout: QueueLayout = DEFAULT_QUEUE_LAYOUT,
): StreetPoint {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const slot = safeIndex % layout.capacity;
  const columnSpacing =
    layout.columns > 1 ? (QUEUE_END_X - QUEUE_START_X) / (layout.columns - 1) : 0;
  // Reuse these physical places only after all free places have been allocated.
  return {
    x: QUEUE_START_X + (slot % layout.columns) * columnSpacing,
    y: QUEUE_START_Y + Math.floor(slot / layout.columns) * QUEUE_ROW_SPACING,
  };
}

export function historicalQueuePosition(
  index: number,
  layout: QueueLayout = DEFAULT_QUEUE_LAYOUT,
): StreetPoint {
  const history = historicalQueueLayout(layout);
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const slot = safeIndex % history.capacity;
  const columnSpacing =
    history.columns > 1 ? HISTORICAL_QUEUE_AREA.width / (history.columns - 1) : 0;
  return {
    x: HISTORICAL_QUEUE_AREA.x + (slot % history.columns) * columnSpacing,
    y: HISTORICAL_QUEUE_AREA.y + Math.floor(slot / history.columns) * HISTORICAL_QUEUE_ROW_SPACING,
  };
}

/** Enter sideways from beyond the outer edge, never through the road or the top of the scene. */
export function arrivalStart(
  queueIndex: number,
  layout: QueueLayout = DEFAULT_QUEUE_LAYOUT,
): StreetPoint {
  return { x: SCENE_WIDTH + 28, y: queuePosition(queueIndex, layout).y };
}

/** Door passengers stay clipped inside until they have completely reached the platform. */
export function isInsideDoorway(point: StreetPoint): boolean {
  return point.x < DOOR_PLATFORM_X;
}
