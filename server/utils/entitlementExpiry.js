/** A provider replacement package must never extend an existing entitlement. */
export function earliestValidExpiry(...values) {
  const timestamps = values
    .filter((value) => value != null)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  return timestamps.length
    ? new Date(Math.min(...timestamps))
    : null;
}
