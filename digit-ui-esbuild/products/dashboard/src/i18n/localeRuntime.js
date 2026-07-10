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
 * - Standalone (dev harness, DashboardLogin): no Digit runtime exists, so a
 *   minimal in-module store fetches the same bundles straight from
 *   /localization/messages/v1/_search, keyed off localStorage["Employee.locale"]
 *   (the key the host writes on every language change).
 *
 * The dashboard subtree stays self-contained: no @egovernments or
 * react-i18next imports — the host instance is reached via window.i18next.
 */
import { getTenantId } from "../config/dashboardConfig";

const FALLBACK_LOCALE = "en_IN";
const STANDALONE_MODULES = [
  "rainmaker-dashboard",
  "rainmaker-pgr",
  "rainmaker-common",
  "rainmaker-boundary-admin",
];

const standalone = {
  messages: {}, // { [locale]: { [code]: message } }
  pending: {}, // { [locale]: Promise }
  listeners: new Set(),
};

const hostI18next = () => (typeof window !== "undefined" ? window.i18next : undefined);

const readStoredLocale = () => {
  try {
    return window.localStorage.getItem("Employee.locale") || FALLBACK_LOCALE;
  } catch (e) {
    return FALLBACK_LOCALE;
  }
};

export function getLanguage() {
  return hostI18next()?.language || readStoredLocale();
}

export function exists(key) {
  if (key == null || key === "") return false;
  const host = hostI18next();
  if (host) return host.exists(String(key));
  const map = standalone.messages[getLanguage()];
  return !!map && Object.prototype.hasOwnProperty.call(map, String(key));
}

/**
 * Translate `key`, else return `fallback` (else the key itself, matching
 * DIGIT's echo-the-key behavior). Pass the current English literal as
 * `fallback` so unseeded environments render exactly what they render today.
 */
export function translate(key, fallback) {
  if (key == null || key === "") return fallback !== undefined ? fallback : "";
  const k = String(key);
  const host = hostI18next();
  if (host) {
    if (host.exists(k)) return host.t(k);
    return fallback !== undefined ? fallback : k;
  }
  const map = standalone.messages[getLanguage()];
  if (map && Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  return fallback !== undefined ? fallback : k;
}

const notifyStandalone = () => standalone.listeners.forEach((cb) => cb());

/** No-op when embedded; in standalone, fetch the message bundles once per locale. */
export function ensureMessages() {
  if (hostI18next()) return;
  const locale = getLanguage();
  if (standalone.messages[locale] || standalone.pending[locale]) return;
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
    });
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
