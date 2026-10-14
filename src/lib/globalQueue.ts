/** A bounded collective crowd uses the same unit in both provider queues. */
export const MAX_GLOBAL_QUEUE_GROUPS = 48;

export function globalQueueGroupSize(totals: readonly (number | null)[]): number {
  const largest = totals.reduce<number>(
    (maximum, total) =>
      total !== null && Number.isSafeInteger(total) && total >= 0
        ? Math.max(maximum, total)
        : maximum,
    0,
  );
  const minimum = Math.max(1, Math.ceil(largest / MAX_GLOBAL_QUEUE_GROUPS));
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  return (
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((size) => size >= minimum) ?? minimum
  );
}
