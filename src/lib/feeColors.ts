export const LOW_FEE_COLOR = '#f2d35d';
export const AVERAGE_FEE_COLOR = '#ef9a42';
export const HIGH_FEE_COLOR = '#db4e47';

type ColorChannels = readonly [number, number, number];

const low: ColorChannels = [242, 211, 93];
const average: ColorChannels = [239, 154, 66];
const high: ColorChannels = [219, 78, 71];

function interpolateColor(from: ColorChannels, to: ColorChannels, progress: number): string {
  return (
    '#' +
    ([0, 1, 2] as const)
      .map((index) =>
        Math.round(from[index] + (to[index] - from[index]) * progress)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Relative to one chain's currently displayed pending sample, never a network average. */
export function feeColorForRate(feeRate: number, averageFeeRate: number | null): string {
  if (
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    averageFeeRate === null ||
    !Number.isFinite(averageFeeRate) ||
    averageFeeRate <= 0
  )
    return AVERAGE_FEE_COLOR;

  const ratio = Math.min(2, feeRate / averageFeeRate);
  if (ratio === 0) return LOW_FEE_COLOR;
  if (ratio === 1) return AVERAGE_FEE_COLOR;
  if (ratio === 2) return HIGH_FEE_COLOR;
  return ratio < 1
    ? interpolateColor(low, average, ratio)
    : interpolateColor(average, high, ratio - 1);
}
