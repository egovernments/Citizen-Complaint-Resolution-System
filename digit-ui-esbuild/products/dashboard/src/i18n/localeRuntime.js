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
import { isPublicDashboardRuntime } from "../services/dashboardRuntime";

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
  const params = new URLSearchParams({
    module: STANDALONE_MODULES.join(","),
    locale,
    tenantId: getTenantId(),
  });
  const request = fetch(`/localization/messages/v1/_search?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      RequestInfo: {
        apiId: "Rainmaker",
        ver: ".01",
        ...(authToken && { authToken }),
      },
    }),
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
  let authToken = null;
  if (!isPublicDashboardRuntime()) {
    try {
      authToken = window.localStorage.getItem("Employee.token");
    } catch (e) {
      /* ignore */
    }
  }
  const locales = [...new Set([getLanguage(), FALLBACK_LOCALE])];
  return Promise.all(locales.map((locale) => loadStandaloneMessages(locale, authToken)));
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
