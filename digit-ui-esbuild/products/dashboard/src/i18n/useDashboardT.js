import { useEffect, useReducer } from "react";
import { translate, exists, getLanguage, subscribe, ensureMessages } from "./localeRuntime";

/**
 * The dashboard's t() hook. `t(key, enFallback)` translates against the host
 * i18next when embedded (or the standalone store on the dev harness) and
 * echoes the fallback when the key is unseeded. `language` is included so
 * imperatively-drawn surfaces (Leaflet layers, ApexCharts instances) can
 * re-key on it — the #882 ward-tooltip pattern.
 */
export default function useDashboardT() {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    ensureMessages();
    return subscribe(bump);
  }, []);
  return { t: translate, exists, language: getLanguage() };
}
