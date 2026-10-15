import { useEffect, useState } from 'react';

/**
 * From this width the docs rail sits beside the page, open unless the user closed
 * it: the left rail (256px), the docs rail (256px) and the page's padding still
 * leave the Employees table the ~860px it needs. Narrower, the docs wait as a
 * strip and open over the page instead of squeezing it.
 */
export const DOCS_BESIDE_PX = 1400;

const query = (px: number) => `(min-width: ${px}px)`;

function matches(px: number): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query(px)).matches;
}

/** Whether the window is at least `px` wide, kept current as it resizes. */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(() => matches(px));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query(px));
    const update = () => setWide(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [px]);
  return wide;
}
