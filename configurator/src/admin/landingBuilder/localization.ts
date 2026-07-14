/** Localization plumbing for the Builder (P4, CCSD-2009).
 *
 * The Builder shows HUMAN-READABLE text, not keys: values resolve from the
 * localization store (module rainmaker-pgr) with a module-level cache, plus
 * the Builder's staged edits on top. Staged edits are persisted on Save Draft
 * through the existing localizationUpsert API — one call per locale (the
 * localization service silently drops mixed-locale batches).
 */
import { digitClient } from '@/providers/bridge';
import type { LocEdits } from './types';

export const LOC_MODULE = 'rainmaker-pgr';

/** Languages offered in the Inspector / localization drawer. */
export const BUILDER_LOCALES: Array<{ code: string; label: string; short: string }> = [
  { code: 'pt_PT', label: 'Português', short: 'PT' },
  { code: 'en_IN', label: 'English', short: 'EN' },
];

const cache = new Map<string, Record<string, string>>(); // locale -> key -> msg

export async function loadMessages(tenantId: string, locale: string): Promise<Record<string, string>> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const rows = await digitClient.localizationSearch(tenantId, locale, LOC_MODULE);
  const map: Record<string, string> = {};
  (rows || []).forEach((r) => {
    const code = r?.code as string | undefined;
    const message = r?.message as string | undefined;
    if (code && typeof message === 'string') map[code] = message;
  });
  cache.set(locale, map);
  return map;
}

/** Everything loaded from the store for a locale (empty until loadMessages).
 *  The preview pushes this WHOLE map (staged edits layered on top) so the
 *  iframe renders saved-but-unedited custom text too — its i18n store never
 *  loads the module itself. */
export function getLoadedMessages(locale: string): Record<string, string> {
  return cache.get(locale) ?? {};
}

/** Staged edit wins, then the store; undefined when the key is unknown. */
export function resolveText(
  key: string | undefined,
  locale: string,
  locEdits: LocEdits,
): string | undefined {
  if (!key) return undefined;
  const staged = locEdits[locale]?.[key];
  if (staged !== undefined) return staged;
  return cache.get(locale)?.[key];
}

/** Persist staged edits (per-locale batches) and fold them into the cache. */
export async function persistLocEdits(tenantId: string, locEdits: LocEdits): Promise<void> {
  let wrote = false;
  for (const [locale, byKey] of Object.entries(locEdits)) {
    const messages = Object.entries(byKey).map(([code, message]) => ({
      code,
      message,
      module: LOC_MODULE,
    }));
    if (!messages.length) continue;
    await digitClient.localizationUpsert(tenantId, locale, messages);
    wrote = true;
    const map = cache.get(locale);
    if (map) messages.forEach((m) => { map[m.code] = m.message; });
  }
  if (wrote) {
    // The localization service caches search responses; without a bust, other
    // clients (the live landing page) can keep reading the pre-save text.
    // Best-effort — the write above already succeeded.
    try {
      await digitClient.request('/localization/messages/cache-bust', {
        RequestInfo: digitClient.buildRequestInfo(),
      });
    } catch {
      /* non-fatal */
    }
  }
}

export function invalidateLocCache(): void {
  cache.clear();
}
