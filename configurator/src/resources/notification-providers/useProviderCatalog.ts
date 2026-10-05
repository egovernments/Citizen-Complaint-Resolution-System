// Loads the bridge's provider catalog once per screen mount.
//
// The catalog is the source of truth for which provider types exist and which
// credentials each one needs. When the call fails — a bridge older than
// `GET /providers/catalog` — we fall back to FALLBACK_CATALOG and flag it, so the
// create path switches to the LEGACY request body and the screen can say why only
// three provider types are on offer.
import { useEffect, useState } from 'react';
import { fetchProviderCatalog } from './providerApi';
import { FALLBACK_CATALOG, type ProviderType } from './providerCatalog';

export interface ProviderCatalogState {
  catalog: ProviderType[];
  loading: boolean;
  /** 'bridge' = live catalog; 'fallback' = the offline list (use the legacy create body). */
  source: 'bridge' | 'fallback';
  /** Why we fell back, for the operator-facing note. */
  error: string | null;
}

export function useProviderCatalog(): ProviderCatalogState {
  const [state, setState] = useState<ProviderCatalogState>({
    catalog: FALLBACK_CATALOG,
    loading: true,
    source: 'fallback',
    error: null,
  });

  useEffect(() => {
    let alive = true;
    fetchProviderCatalog()
      .then((catalog) => {
        if (!alive) return;
        // An empty catalog is a bridge that answered but offers nothing — keep the
        // fallback so the operator is not left with an empty provider picker.
        if (catalog.length === 0) {
          setState({ catalog: FALLBACK_CATALOG, loading: false, source: 'fallback', error: null });
          return;
        }
        setState({ catalog, loading: false, source: 'bridge', error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          catalog: FALLBACK_CATALOG,
          loading: false,
          source: 'fallback',
          error: (err as Error)?.message ?? 'catalog unavailable',
        });
      });
    return () => { alive = false; };
  }, []);

  return state;
}
