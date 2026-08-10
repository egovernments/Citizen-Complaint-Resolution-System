import { useCallback } from 'react';
import { useLocaleState } from 'ra-core';
import { localizationService } from '@/api';
import { clearTranslationCache } from '@/providers/bridge';

/**
 * CCSD-2157: after a Localization create/update, make the edit actually
 * propagate to the rendered UI. Three caches sit between a saved row and the
 * screen and none were being invalidated on save:
 *
 *   1. egov-localization's server-side assembled-response cache (Redis) — the
 *      /_search the app calls keeps serving the pre-write snapshot until it is
 *      busted (localizationService.cacheBust()).
 *   2. the configurator's own localStorage translation cache (24h TTL) — read
 *      on every boot, only cleared on login / tenant change, so a saved edit
 *      stayed invisible for up to a day / until re-login.
 *   3. react-admin's in-memory polyglot messages — loaded once per locale, so
 *      even after 1+2 the current session keeps the stale strings until the
 *      locale is reloaded.
 *
 * This hook returns a callback that clears all three: bust the server cache,
 * clear the FE translation cache, then re-set the active locale so ra-core
 * re-invokes the i18nProvider and re-fetches fresh messages (the app re-renders
 * with the corrected string — no manual reload / re-login needed).
 */
export function useLocalizationSaveRefresh(): () => Promise<void> {
  const [locale, setLocale] = useLocaleState();
  return useCallback(async () => {
    // 1. server cache — best-effort; a failure here still lets 2+3 run so a
    //    reload picks up the change once the server TTL lapses.
    try {
      await localizationService.cacheBust();
    } catch {
      /* non-fatal */
    }
    // 2. FE localStorage + in-memory translation cache.
    clearTranslationCache();
    // 3. force ra-core to re-fetch messages for the active locale. changeLocale
    //    runs regardless of whether the value changed, so the (now cache-cleared)
    //    fetch hits the API and the tree re-renders with the new string.
    if (locale) setLocale(locale);
  }, [locale, setLocale]);
}
