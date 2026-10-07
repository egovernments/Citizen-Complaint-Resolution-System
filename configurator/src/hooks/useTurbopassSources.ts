import { useEffect, useState } from 'react';
import { availableSources } from '@/utils/turbopassSuggestions';
import { resolveConfig } from '@/api/runtimeConfig';

/** Same-origin '/turbopass' by default (nginx proxies it to the search-api);
 *  TURBOPASS_URL in config.js (or the build-time VITE_TURBOPASS_URL) overrides. */
export const TURBOPASS_BASE: string =
  resolveConfig('TURBOPASS_URL', import.meta.env.VITE_TURBOPASS_URL) || '/turbopass';

export interface TurbopassHealth {
  /** The boundary sources it can answer, in SOURCE_ORDER. */
  sources: string[];
  /** Countries it holds an official boundary set for (ISO alpha-2). */
  officialCountries: string[];
}

const NOTHING: TurbopassHealth = { sources: [], officialCountries: [] };

/**
 * One read of this deployment's turbopass /health: null while asking, empty
 * when it isn't deployed (the SPA answers /turbopass/ with HTML) or holds no
 * boundary data. Geography reads it once for both the sources and the
 * Preconfigured option.
 */
export function useTurbopassHealth(base: string = TURBOPASS_BASE): TurbopassHealth | null {
  const [health, setHealth] = useState<TurbopassHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const official = body?.official && typeof body.official === 'object' ? Object.keys(body.official).sort() : [];
        setHealth({ sources: availableSources(body?.sources), officialCountries: official });
      })
      .catch(() => {
        if (!cancelled) setHealth(NOTHING);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return health;
}
