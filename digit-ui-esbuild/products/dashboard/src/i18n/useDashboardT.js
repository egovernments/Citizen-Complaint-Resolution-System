import { useEffect, useReducer } from "react";
import { translate, exists, getLanguage, subscribe, ensureMessages } from "./localeRuntime";

/**
 * The dashboard's t() hook. `t(key, seedEnglish)` translates against the host
 * i18next when embedded (or the standalone store on the dev harness) and
 * echoes the KEY when unseeded — gaps surface, never the inline English
 * (which exists only as the seed pack's extraction source). `language` is
 * included so imperatively-drawn surfaces (Leaflet layers, ApexCharts
 * instances) can re-key on it — the #882 ward-tooltip pattern.
 *
 * `i18nTick` increments on EVERY store event (language change AND late bundle
 * arrival). The host's ChangeLanguage fires i18next.changeLanguage without
 * awaiting the new locale's bundle fetch, so `language` alone is not a safe
 * memo dep for derivations that bake resolved strings (the Add-KPI picker's
 * catalogItems): they'd compute against a half-loaded store and never refresh
 * when the messages land. Dep on `i18nTick` wherever resolve* output is memoized.
 */
export default function useDashboardT() {
  const [tick, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    ensureMessages();
    return subscribe(() => {
      // Language switch writes Employee.locale sync, then bundles arrive later.
      // Re-fetch the active locale into the side-cache on every signal.
      ensureMessages();
      bump();
    });
  }, []);
  return { t: translate, exists, language: getLanguage(), i18nTick: tick };
}
