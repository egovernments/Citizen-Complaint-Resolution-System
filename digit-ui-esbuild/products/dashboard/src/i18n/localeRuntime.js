/**
 * Localization runtime for the dashboard, working in BOTH mounting modes:
 *
 * - Embedded (production, inside DigitUI): delegates to the host i18next
 *   singleton that packages/libraries exposes as `window.i18next`. Message
 *   bundles (rainmaker-dashboard / rainmaker-pgr / rainmaker-common /
 *   rainmaker-boundary-<hierarchy>) are loaded by the Digit.Services.useStore
 *   call in Module.js, and the ChangeLanguage dropdown in the host TopBar
 *   drives language switches.
 *
 * - Standalone (dev harness, DashboardLogin) and Public: no Digit runtime
 *   exists, so a minimal in-module store fetches the same bundles straight from
 *   /localization/messages/v1/_search. The harness keys the locale off
 *   localStorage["Employee.locale"] (what the host writes on every language
 *   change); the public page off its own PUBLIC_LOCALE_KEY. setLanguage() is
 *   the in-page switch for both (#1797); embedded keeps the host TopBar's.
 *
 * The dashboard subtree stays self-contained: no @egovernments or
 * react-i18next imports — the host instance is reached via window.i18next.
 */
import { getTenantId } from "../config/dashboardConfig";
import { getMdmsSearchUrl } from "../services/complaintHierarchyService";
import { isPublicDashboardRuntime } from "../services/dashboardRuntime";

const FALLBACK_LOCALE = "en_IN";

/**
 * Where the standalone runtime remembers the visitor's language. The public
 * page gets its OWN key (#1797): reading `Employee.locale` there would hand a
 * co-hosted employee session's language to an anonymous page, and writing it
 * from the public switcher would silently re-language the employee app.
 */
export const PUBLIC_LOCALE_KEY = "ccrs.dashboard.public-locale.v1";
const EMPLOYEE_LOCALE_KEY = "Employee.locale";

const globalConfig = (key) => {
  try {
    return window.globalConfigs?.getConfig?.(key) || undefined;
  } catch (e) {
    return undefined;
  }
};

/**
 * The tenant's own boundary hierarchy for the standalone (public) page: the CMS row of
 * CMS-BOUNDARY.HierarchySchema, as Module.js resolves it for the employee mount
 * (services/boundaryService.js fetchTenantHierarchyType). A plain request, because the
 * public page has no session; null when the tenant has no row (HIERARCHY_TYPE then).
 * Cached per tenant for the page load.
 */
const tenantHierarchies = {};
export function standaloneHierarchyType(tenantId = getTenantId()) {
  if (!tenantHierarchies[tenantId]) {
    tenantHierarchies[tenantId] = fetch(getMdmsSearchUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: { apiId: "Rainmaker", ver: ".01" },
        MdmsCriteria: {
          tenantId,
          moduleDetails: [{ moduleName: "CMS-BOUNDARY", masterDetails: [{ name: "HierarchySchema" }] }],
        },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const rows = data?.MdmsRes?.["CMS-BOUNDARY"]?.HierarchySchema;
        const row = Array.isArray(rows) ? rows.find((r) => r?.moduleName === "CMS" && r?.hierarchy) : null;
        return row ? String(row.hierarchy) : null;
      })
      .catch(() => null);
  }
  return tenantHierarchies[tenantId];
}

/**
 * Same bundle set Module.js loads into the host i18next, derived the same way:
 * the boundary pack follows the tenant's hierarchy (standaloneHierarchyType), else
 * globalConfigs.HIERARCHY_TYPE (hardcoding `admin` silently dropped ward names on
 * every non-ADMIN tenant).
 */
export function standaloneModules(tenantHierarchy) {
  const hierarchyType = String(tenantHierarchy || globalConfig("HIERARCHY_TYPE") || "ADMIN").toLowerCase();
  return [
    "rainmaker-dashboard",
    "rainmaker-pgr",
    "rainmaker-common",
    `rainmaker-boundary-${hierarchyType}`,
  ];
}

const standalone = {
  messages: {}, // { [locale]: { [code]: message } }
  pending: {}, // { [locale]: Promise }
  listeners: new Set(),
  // Active locale once setLanguage() has run this page load. Storage is only
  // the across-reloads memory: a browser that refuses localStorage (private
  // mode, quota) must still switch language for the current visit.
  locale: null,
};

const hostI18next = () => (typeof window !== "undefined" ? window.i18next : undefined);

const localeStorageKey = () =>
  isPublicDashboardRuntime() ? PUBLIC_LOCALE_KEY : EMPLOYEE_LOCALE_KEY;

/**
 * Deployment default for a public visitor who has never picked a language:
 * the employee app's own boot rule (packages/libraries Digit.Utils
 * getDefaultLanguage — each half defaulted independently, `en` / `IN`). The
 * dev harness keeps its historical en_IN so its behaviour is unchanged.
 */
function defaultLocale() {
  if (!isPublicDashboardRuntime()) return FALLBACK_LOCALE;
  return `${globalConfig("LOCALE_DEFAULT") || "en"}_${globalConfig("LOCALE_REGION") || "IN"}`;
}

const readStoredLocale = () => {
  try {
    return window.localStorage.getItem(localeStorageKey()) || defaultLocale();
  } catch (e) {
    return defaultLocale();
  }
};

export function getLanguage() {
  return hostI18next()?.language || standalone.locale || readStoredLocale();
}

/**
 * Switch the standalone runtime's language (#1797). No-op when a host i18next
 * exists — there the DigitUI TopBar owns the switch. Standalone: remember the
 * choice under the mode-appropriate key, load the bundle (memoised), stamp
 * <html lang>, and notify every useDashboardT subscriber so the whole tree —
 * including imperatively-drawn charts keyed on `language` — re-renders.
 */
/**
 * Whether THIS runtime owns language switching. False whenever a host i18next
 * exists (DigitUI's TopBar switcher is in charge); the in-page LanguageMenu
 * gates on the same predicate so it can only appear where setLanguage acts.
 */
export function ownsLanguageSwitch() {
  return !hostI18next();
}

export function setLanguage(locale) {
  if (!locale || !ownsLanguageSwitch()) return Promise.resolve();
  standalone.locale = locale;
  try {
    window.localStorage.setItem(localeStorageKey(), locale);
  } catch (e) {
    /* private mode / quota — the switch still applies for this page load */
  }
  try {
    if (typeof document !== "undefined") document.documentElement.lang = locale.split("_")[0];
  } catch (e) {
    /* ignore */
  }
  notifyStandalone();
  return loadStandaloneMessages(locale, standaloneAuthToken());
}

export function exists(key) {
  if (key == null || key === "") return false;
  const host = hostI18next();
  if (host) return host.exists(String(key));
  const k = String(key);
  const active = standalone.messages[getLanguage()];
  const english = standalone.messages[FALLBACK_LOCALE];
  return (
    (!!active && Object.prototype.hasOwnProperty.call(active, k)) ||
    (!!english && Object.prototype.hasOwnProperty.call(english, k))
  );
}

/**
 * Translate `key`, falling back to its canonical English copy when the active
 * locale has not received the message yet. Standalone/public mode loads en_IN
 * beside the active locale to reproduce the employee host's fallback chain.
 *
 * `seedEnglish` is also the single source the generated en_IN seed pack
 * (digit-mcp dashboard-l10n-seed.ts) is script-extracted from. Keep it in
 * sync when changing copy, then regenerate the pack.
 */
export function translate(key, seedEnglish) {
  if (key == null || key === "") return "";
  const k = String(key);
  const host = hostI18next();
  if (host) {
    return host.exists(k) ? host.t(k) : seedEnglish || k;
  }
  const active = standalone.messages[getLanguage()];
  if (active && Object.prototype.hasOwnProperty.call(active, k)) return active[k];
  const english = standalone.messages[FALLBACK_LOCALE];
  if (english && Object.prototype.hasOwnProperty.call(english, k)) return english[k];
  return seedEnglish || k;
}

const notifyStandalone = () => standalone.listeners.forEach((cb) => cb());

function loadStandaloneMessages(locale, authToken) {
  if (standalone.messages[locale]) return Promise.resolve();
  if (standalone.pending[locale]) return standalone.pending[locale];
  const request = standaloneHierarchyType().then((tenantHierarchy) => fetch(`/localization/messages/v1/_search?${new URLSearchParams({
    module: standaloneModules(tenantHierarchy).join(","),
    locale,
    tenantId: getTenantId(),
  })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      RequestInfo: {
        apiId: "Rainmaker",
        ver: ".01",
        ...(authToken && { authToken }),
      },
    }),
  }))
    .then((res) => (res.ok ? res.json() : { messages: [] }))
    .then((data) => {
      const map = {};
      (data?.messages || []).forEach((m) => {
        if (m?.code) map[m.code] = m.message;
      });
      standalone.messages[locale] = map;
      delete standalone.pending[locale];
      notifyStandalone();
    })
    .catch(() => {
      standalone.messages[locale] = {};
      delete standalone.pending[locale];
      notifyStandalone();
    });
  standalone.pending[locale] = request;
  return request;
}

/**
 * No-op when embedded. Standalone loads the active locale plus en_IN so
 * dynamic dimension keys have the same fallback behavior as host i18next.
 */
export function ensureMessages() {
  if (hostI18next()) return Promise.resolve();
  const authToken = standaloneAuthToken();
  const locales = [...new Set([getLanguage(), FALLBACK_LOCALE])];
  return Promise.all(locales.map((locale) => loadStandaloneMessages(locale, authToken)));
}

/** The dev harness attaches its employee token; the public runtime never reads storage for one. */
function standaloneAuthToken() {
  if (isPublicDashboardRuntime()) return null;
  try {
    return window.localStorage.getItem("Employee.token");
  } catch (e) {
    return null;
  }
}

/**
 * Re-render signal: fires on host language change / bundle load, or on
 * standalone bundle arrival. Returns an unsubscribe function.
 */
export function subscribe(cb) {
  const host = hostI18next();
  if (host) {
    host.on("languageChanged", cb);
    host.store?.on("added", cb);
    return () => {
      host.off("languageChanged", cb);
      host.store?.off("added", cb);
    };
  }
  standalone.listeners.add(cb);
  return () => standalone.listeners.delete(cb);
}
