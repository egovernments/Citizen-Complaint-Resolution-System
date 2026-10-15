/**
 * Where a Select's open list starts, horizontally. The list floats over the page
 * and may be wider than its field, so long options read in full; near the right
 * edge of the viewport it slides left by just enough to stay on screen, and never
 * past the left margin.
 */
export function popoverLeft(triggerLeft: number, popoverWidth: number, viewportWidth: number, margin: number): number {
  const overflow = triggerLeft + popoverWidth - (viewportWidth - margin);
  if (overflow <= 0) return triggerLeft;
  return Math.max(margin, triggerLeft - overflow);
}
