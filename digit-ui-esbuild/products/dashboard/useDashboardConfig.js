/**
 * useDashboardConfig — session-cached loader for the dss.DashboardConfig MDMS
 * master (STATE ROOT tenant, same owning tenant as the dss.KpiDefinition /
 * dss.DashboardPack catalog), a single-record per-tenant dashboard config:
 *
 *   { "id": "default", "allowedRoles": [...],
 *     "numberFormat": { "en_IN": "#,##0.00", "pt_PT": "#.##0,00",
 *                       "default": "#,##0.00" } }
 *
 * (`numberFormat` is locale-keyed with an optional `default`; a plain string
 * is the legacy one-mask-for-every-locale form — see utils/numberFormat.js.)
 *
 * This is THE shared fetch for every dss.DashboardConfig consumer. PR #1258
 * (route/card role gate) reads `allowedRoles` from the same master with an
 * identical react-query key — same useCustomMDMS(stateId, "dss",
 * [{ name: "DashboardConfig" }]) call, staleTime/cacheTime Infinity — so
 * whichever lands first, the record costs ONE request per login and #1258's
 * useDashboardAccess should be refactored onto this hook when both are in.
 *
 * Fetched through the same MDMS v1-compat search the rest of the UI uses
 * (Digit.Hooks.useCustomMDMS -> /egov-mdms-service/v1/_search; the mdmsv2
 * argument is left falsy). retry: false — the gate must settle in one round
 * trip; an unseeded/unreachable master resolves to null (built-in behavior),
 * never to a retry spinner.
 *
 * @returns {{ config: object|null, loading: boolean }}
 *   - config: the "default" record (else the first record); null when the
 *     master is unseeded / unreadable / malformed. Consumers treat null as
 *     "keep built-in behavior".
 *   - loading: query in flight — consumers must HOLD rendering while true so
 *     configured behavior never flashes in after a default-rendered frame.
 */
export const useDashboardConfig = () => {
  // Standalone harness (DashboardLogin dev mode): no Digit runtime and no
  // react-query provider exist. window.Digit is initialized before React
  // mounts (or never), so this branch is stable for the page's lifetime and
  // the conditional hook call below can never change hook order within a
  // mounted tree.
  if (typeof window === "undefined" || !window.Digit?.Hooks?.useCustomMDMS) {
    return { config: null, loading: false };
  }

  const digit = window.Digit;
  const stateId = digit.ULBService.getStateId();

  const { data, isLoading } = digit.Hooks.useCustomMDMS(
    stateId,
    "dss",
    [{ name: "DashboardConfig" }],
    {
      cacheTime: Infinity,
      staleTime: Infinity,
      retry: false,
      select: (res) => res?.dss?.DashboardConfig,
    }
  );

  // Shape-guard everything: Kong's cjson pre-function can flatten an empty
  // array to {}, and a hand-seeded master may carry extra records — prefer the
  // "default" record, tolerate anything else by falling back.
  const records = Array.isArray(data) ? data : [];
  const record = records.find((r) => r?.id === "default") || records[0];

  return { config: record || null, loading: isLoading };
};

export default useDashboardConfig;
