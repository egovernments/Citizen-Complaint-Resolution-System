/**
 * Localization runtime for the dashboard, working in BOTH mounting modes:
 *
 * - Embedded (production, inside DigitUI): reads messages from the host
 *   i18next singleton (`window.i18next`) that Digit.Services.useStore fills.
 * - Standalone (dev harness): fetches the same bundles from
 *   /localization/messages/v1/_search into an in-module store.
 *
 * CRITICAL (#1108): host i18next is configured with fallbackLng=en_IN, and
 * i18next.exists/t ignore `{ fallbackLng: false }` for missing keys — they
 * still return the English message. Locale-strict reads MUST go through
 * getResource(lng, ns, key) (or our side-cache), never exists()/t().
 */
import { getTenantId } from "../config/dashboardConfig";

const FALLBACK_LOCALE = "en_IN";
const I18N_NS = "translations";
const FETCH_COOLDOWN_MS = 15_000;
const STANDALONE_MODULES = [
  "rainmaker-dashboard",
  "rainmaker-pgr",
  "rainmaker-common",
  // Match Module.js: rainmaker-boundary-<HIERARCHY_TYPE> (default admin).
  `rainmaker-boundary-${
    (typeof window !== "undefined" &&
      window?.globalConfigs?.getConfig?.("HIERARCHY_TYPE")?.toString?.().toLowerCase()) ||
    "admin"
  }`,
];

const standalone = {
  messages: {}, // { [locale]: { [code]: message } }
  pending: {}, // { [locale]: Promise }
  failedAt: {}, // { [locale]: timestamp } — cooldown after failed fetch
  listeners: new Set(),
};

/** Cached language; refreshed on subscribe signals (languageChanged / bundle). */
let cachedLanguage = null;

/** Normalized-key indexes: `${source}:${lng}` → Map(normalizedKey → message). */
const looseIndexCache = new Map();

const hostI18next = () => (typeof window !== "undefined" ? window.i18next : undefined);

const readStoredLocale = () => {
  try {
    return window.localStorage.getItem("Employee.locale") || FALLBACK_LOCALE;
  } catch (e) {
    return FALLBACK_LOCALE;
  }
};

function resolveLanguage() {
  // Host i18next is the authority when set (embedded). Employee.locale is only
  // a bridge while the host language is still unset — LocalizationService
  // writes it sync before the async bundle fetch finishes (#1108).
  const host = hostI18next();
  if (host?.language) return host.language;
  return readStoredLocale();
}

export function getLanguage() {
  if (cachedLanguage != null) return cachedLanguage;
  cachedLanguage = resolveLanguage();
  return cachedLanguage;
}

function invalidateLanguageCache() {
  cachedLanguage = null;
}

function invalidateLooseIndexes() {
  looseIndexCache.clear();
}

/** True locale-strict lookup — does NOT follow i18next fallbackLng. */
function hostMessage(lng, key) {
  const host = hostI18next();
  if (!host?.getResource || !lng) return undefined;
  const ns = host.options?.defaultNS;
  const nsName = Array.isArray(ns) ? ns[0] : ns || I18N_NS;
  const value = host.getResource(lng, nsName, key);
  if (value == null || value === "") return undefined;
  return String(value);
}

function sideMessage(lng, key) {
  const map = standalone.messages[lng];
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  return map[key];
}

function normalizeKey(code) {
  return String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildLooseIndex(map) {
  const index = new Map();
  if (!map) return index;
  for (const [k, v] of Object.entries(map)) {
    if (v == null || v === "") continue;
    const nk = normalizeKey(k);
    if (nk && !index.has(nk)) index.set(nk, String(v));
  }
  return index;
}

function looseIndexFor(source, lng, map) {
  const cacheKey = `${source}:${lng}`;
  let index = looseIndexCache.get(cacheKey);
  if (!index) {
    index = buildLooseIndex(map);
    looseIndexCache.set(cacheKey, index);
  }
  return index;
}

/**
 * Underscore/punctuation-insensitive lookup — analytics sometimes emits
 * BOMET_CHEPALUNGU_KONGASIS while the pack keys BOMET_CHEPALUNGU_KONG_ASIS.
 * Uses a per-(source, locale) normalized index so table renders stay O(1)
 * per cell instead of a full-bundle scan.
 */
export function findMessageLoose(code, lng) {
  if (code == null || code === "" || !lng) return undefined;
  const want = normalizeKey(code);
  if (!want) return undefined;

  const host = hostI18next();
  if (host?.getResourceBundle) {
    const ns = host.options?.defaultNS;
    const nsName = Array.isArray(ns) ? ns[0] : ns || I18N_NS;
    const found = looseIndexFor("host", lng, host.getResourceBundle(lng, nsName)).get(want);
    if (found !== undefined) return found;
  }
  return looseIndexFor("side", lng, standalone.messages[lng]).get(want);
}

/**
 * Locale-strict existence. Never use host.exists() — it bleeds en_IN even
 * with `{ fallbackLng: false }` (#1108 All-wards stuck in English).
 */
export function existsInLocale(key, lng) {
  if (key == null || key === "" || !lng) return false;
  const k = String(key);
  return hostMessage(lng, k) !== undefined || sideMessage(lng, k) !== undefined;
}

export function exists(key) {
  return existsInLocale(key, getLanguage());
}

/**
 * Locale-strict translate. Missing message → echo the KEY (DIGIT platform
 * behavior), never silent en_IN bleed through i18next fallbackLng.
 *
 * `seedEnglish` is NEVER rendered: it is the canonical English message for
 * the key, kept inline as the single source the generated en_IN seed pack
 * (digit-mcp dashboard-l10n-seed.ts) is script-extracted from.
 */
export function translateInLocale(key, lng) {
  if (key == null || key === "") return "";
  const k = String(key);
  if (!lng) return k;
  const fromHost = hostMessage(lng, k);
  if (fromHost !== undefined) return fromHost;
  const fromSide = sideMessage(lng, k);
  if (fromSide !== undefined) return fromSide;
  return k;
}

// eslint-disable-next-line no-unused-vars -- seedEnglish is extraction source, not runtime input
export function translate(key, seedEnglish) {
  return translateInLocale(key, getLanguage());
}

export { FALLBACK_LOCALE };

const notifyStandalone = () => standalone.listeners.forEach((cb) => cb());

function fetchStandaloneLocale(locale) {
  if (standalone.messages[locale] || standalone.pending[locale]) return;
  const failedAt = standalone.failedAt[locale];
  if (failedAt && Date.now() - failedAt < FETCH_COOLDOWN_MS) return;

  let authToken = null;
  try {
    authToken = window.localStorage.getItem("Employee.token");
  } catch (e) {
    /* ignore */
  }
  const params = new URLSearchParams({
    module: STANDALONE_MODULES.join(","),
    locale,
    tenantId: getTenantId(),
  });
  standalone.pending[locale] = fetch(`/localization/messages/v1/_search?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ RequestInfo: { apiId: "Rainmaker", ver: ".01", authToken } }),
  })
    .then((res) => {
      // Non-OK must not poison the cache with {} — that would block retries
      // for the rest of the session (ensureMessages now runs in embedded mode).
      if (!res.ok) throw new Error(`localization _search ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const map = {};
      (data?.messages || []).forEach((m) => {
        if (m?.code) map[m.code] = m.message;
      });
      standalone.messages[locale] = map;
      delete standalone.pending[locale];
      delete standalone.failedAt[locale];
      looseIndexCache.delete(`side:${locale}`);
      notifyStandalone();
    })
    .catch(() => {
      // Leave messages[locale] unset so a later ensureMessages() can retry,
      // but cooldown so a flapping service cannot hammer _search.
      delete standalone.pending[locale];
      standalone.failedAt[locale] = Date.now();
    });
}

/**
 * Always side-fetch the active locale (and en_IN when different). Host
 * useStore may race changeLanguage; the side-cache + getResource path is
 * what actually makes "All wards" / "All types" flip to Portuguese (#1108).
 */
export function ensureMessages() {
  const locale = getLanguage();
  fetchStandaloneLocale(locale);
  if (locale !== FALLBACK_LOCALE) fetchStandaloneLocale(FALLBACK_LOCALE);
}

/**
 * Re-render signal: fires on host language change / bundle load, or on
 * standalone bundle arrival. Returns an unsubscribe function.
 */
export function subscribe(cb) {
  const host = hostI18next();
  const unsubs = [];
  const onSignal = () => {
    invalidateLanguageCache();
    invalidateLooseIndexes();
    cb();
  };
  if (host) {
    host.on("languageChanged", onSignal);
    unsubs.push(() => host.off("languageChanged", onSignal));
    // addResources notifies the store; prefer store over i18n.on('added')
    // so we only fire once per bundle arrival.
    if (host.store?.on) {
      host.store.on("added", onSignal);
      unsubs.push(() => host.store.off?.("added", onSignal));
    } else {
      host.on?.("added", onSignal);
      unsubs.push(() => host.off?.("added", onSignal));
    }
  }
  standalone.listeners.add(onSignal);
  unsubs.push(() => standalone.listeners.delete(onSignal));
  return () => unsubs.forEach((fn) => fn());
}
