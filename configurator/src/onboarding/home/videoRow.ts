const CARD_MIN_PX = 220;
const GAP_PX = 20;
export const MAX_PER_PAGE = 4;

/** How many "Learn the basics" cards fit side by side in `width` pixels: at least one, at most four. */
export function cardsPerPage(width: number): number {
  return Math.max(1, Math.min(MAX_PER_PAGE, Math.floor((width + GAP_PX) / (CARD_MIN_PX + GAP_PX))));
}
