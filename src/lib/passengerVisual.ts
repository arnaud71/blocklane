/** Shared drawing and clearance envelope; foot anchors and transaction head ratios stay unchanged. */
export const PASSENGER_VISUAL_SCALE = 1.12;
export const MIN_HEAD_SCALE = 0.8;
export const MAX_HEAD_SCALE = 2.5;

/** Conservative sprite bounds, including the largest head and the selection ring. */
export const PASSENGER_HEADROOM = Math.ceil((22 + 9 * MAX_HEAD_SCALE) * PASSENGER_VISUAL_SCALE);
export const PASSENGER_FOOTROOM = Math.ceil(8 * PASSENGER_VISUAL_SCALE);
export const PASSENGER_HALF_WIDTH = Math.ceil(8 * MAX_HEAD_SCALE * PASSENGER_VISUAL_SCALE);
