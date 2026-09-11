/**
 * useDashboardConfig — session-cached loader for the dss.DashboardConfig MDMS
 * master (STATE ROOT tenant, same owning tenant as the dss.KpiDefinition /
 * dss.DashboardPack catalog), a single-record per-tenant dashboard config:
 *
 *   { "id": "default",
 *     "numberFormat": { "en_IN": "#,##0.00", "pt_PT": "#.##0,00",
 *                       "default": "#,##0.00" } }
 *
 * (`numberFormat` is locale-keyed with an optional `default`; a plain string
 * is the legacy one-mask-for-every-locale form — see utils/numberFormat.js.)
 *
 * This is THE shared fetch for every dss.DashboardConfig consumer:
 * numberFormat, timeZone, publicDashboardEnabled. The nav/route access gate
 * (roles.js) no longer reads this master — since issue #1050 it resolves
 * from egov-accesscontrol via POST /pgr-services/v2/analytics/_access.
 *
 * Fetched through the same MDMS v1-compat search the rest of the UI uses
 * (Digit.Hooks.useCustomMDMS -> /egov-mdms-service/v1/_search; the mdmsv2
 * argument is left falsy). retry: false — the gate must settle in one round
 * trip; an unseeded/unreachable master resolves to null (built-in behavior),
 * never to a retry spinner.
 *
 * @returns {{ config: object|null, loading: boolean }}
 *   - config: the deterministic record selectDashboardConfigRecord() picks
 *     (see below); null when the master is unseeded / unreadable / malformed.
 *     Consumers treat null as "keep built-in behavior".
 *   - loading: query in flight — consumers must HOLD rendering while true so
 *     configured behavior never flashes in after a default-rendered frame.
 */

/**
 * Deterministic dashboard-config record selection when MDMS returns more than
 * one active dss.DashboardConfig record (duplicate/malformed data) — the SAME
 * rule KpiCatalogService.selectDashboardConfigRecord (Java) and the
 * pgr_dashboard_tenant_timezone SQL view (ORDER BY) apply, so every layer
 * picks the identical record from identical data:
 *   1) the record whose (trimmed) id equals "default" wins;
 *   2) else the first record in API response order (the historical behavior).
 * The explicit default is the single-record contract; preserving response
 * order for malformed duplicates avoids silently changing existing tenants.
 */
export function selectDashboardConfigRecord(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  if (records.length === 1) return records[0];

  const trimmedId = (r) => (typeof r?.id === "string" ? r.id.trim() : null);

  const withDefault = records.find((r) => trimmedId(r) === "default");
  if (withDefault) return withDefault;

  return records[0];
}

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
  // array to {}, and a hand-seeded master may carry extra records — resolve
  // deterministically via selectDashboardConfigRecord.
  const records = Array.isArray(data) ? data : [];
  const record = selectDashboardConfigRecord(records);

  return { config: record || null, loading: isLoading };
};

export default useDashboardConfig;
