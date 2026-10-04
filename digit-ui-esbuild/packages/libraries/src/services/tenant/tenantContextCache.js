/**
 * Last known tenant context per URL slug, kept in localStorage.
 *
 * The app looks up its tenant from the URL slug on every boot. If the BFF is
 * briefly down (network error or 5xx), the last good answer for that slug
 * lets the app still start. A 404 or other 4xx means the slug is gone or
 * wrong, so the saved entry is removed and never used.
 */
const KEY_PREFIX = "Digit.tenantContext.";

export function tenantContextCacheKey(urlSlug) {
  return `${KEY_PREFIX}${urlSlug}`;
}

export function defaultTenantContextStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage || null : null;
  } catch (_) {
    // Some browsers throw when storage is blocked.
    return null;
  }
}

export function saveTenantContext(storage, urlSlug, tenant) {
  if (!storage) return;
  try {
    storage.setItem(tenantContextCacheKey(urlSlug), JSON.stringify({ tenant, savedAt: Date.now() }));
  } catch (_) {
    // A full or blocked storage only means there is no fallback next time.
  }
}

export function readTenantContext(storage, urlSlug) {
  if (!storage) return null;
  try {
    const entry = JSON.parse(storage.getItem(tenantContextCacheKey(urlSlug)));
    return entry?.tenant?.urlSlug === urlSlug ? entry.tenant : null;
  } catch (_) {
    return null;
  }
}

export function clearTenantContext(storage, urlSlug) {
  if (!storage) return;
  try {
    storage.removeItem(tenantContextCacheKey(urlSlug));
  } catch (_) {
    // Nothing to clear.
  }
}

/**
 * Only an outage may fall back to the saved context: no answer at all, or a
 * real 5xx from the server. A reply that fails our own checks is not an outage.
 */
export function canUseCachedTenantContext(error) {
  if (!error || error.verificationFailed) return false;
  if (typeof error.status === "number") return error.status >= 500;
  return Boolean(error.networkError);
}

/**
 * Run `load` (which fetches and checks the context). On success, save it.
 * On a network error or 5xx, return the saved context if there is one.
 * On a 4xx, remove the saved context. Anything else is rethrown.
 */
export async function withTenantContextCache(urlSlug, load, storage) {
  try {
    const tenant = await load();
    saveTenantContext(storage, urlSlug, tenant);
    return tenant;
  } catch (error) {
    if (typeof error?.status === "number" && error.status >= 400 && error.status < 500) {
      clearTenantContext(storage, urlSlug);
      throw error;
    }
    if (canUseCachedTenantContext(error)) {
      const cached = readTenantContext(storage, urlSlug);
      if (cached) return cached;
    }
    throw error;
  }
}
