import { useEffect, useState } from 'react';
import { availableSources } from '@/utils/turbopassSuggestions';

/** Same-origin '/turbopass' by default (nginx proxies it); VITE_TURBOPASS_URL overrides. */
export const TURBOPASS_BASE: string = import.meta.env.VITE_TURBOPASS_URL || '/turbopass';

/**
 * The boundary sources this deployment's turbopass can answer, from its
 * /health: null while asking, [] when it isn't deployed (the SPA answers
 * /turbopass/ with HTML) or holds no boundary data.
 */
export function useTurbopassSources(base: string = TURBOPASS_BASE): string[] | null {
  const [sources, setSources] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setSources(availableSources(body?.sources));
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return sources;
}
