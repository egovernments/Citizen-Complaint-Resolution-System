import { useSyncExternalStore } from 'react';

/** ours (cfgreview F22, #1568): true below Tailwind's md breakpoint (768 px). False where matchMedia is missing (tests, SSR). */
const QUERY = '(max-width: 767px)';

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const m = window.matchMedia(QUERY);
  m.addEventListener?.('change', cb);
  return () => m.removeEventListener?.('change', cb);
}

const snapshot = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
