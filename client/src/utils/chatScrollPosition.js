export function isAtMessageBottom(viewport, tolerance = 16) {
  if (!viewport) return false;

  const remaining =
    viewport.scrollHeight -
    viewport.scrollTop -
    viewport.clientHeight;

  return Number.isFinite(remaining) &&
    remaining <= tolerance;
}
