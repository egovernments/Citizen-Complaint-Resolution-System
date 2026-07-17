// FALLBACK roles allowed to open the supervisor dashboard, used whenever the
// dss.DashboardConfig MDMS record is absent or unreadable (fresh tenants,
// MDMS down, schema not registered) so existing deployments keep working
// unchanged. Deployments with a custom role taxonomy (e.g. CMS_* roles)
// override this via MDMS instead of a rebuild — see useDashboardAccess below.
//
// Checked tenant-agnostically (role CODE only, via Digit.UserService.hasAccess)
// because employee roles live at the state root tenant ("ke") while the working
// tenant may be a city tenant — Digit.Utils.didEmployeeHasAtleastOneRole filters
// by current tenant and would wrongly hide the dashboard there.
export const DASHBOARD_ROLES = ["SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO", "PGR_LME", "PGR_ADMIN", "SUPERUSER"];

/**
 * useDashboardAccess — resolves the dashboard's nav/route role gate from MDMS.
 *
 * Master: dss.DashboardConfig at the STATE ROOT tenant (same owning tenant as
 * the dss.KpiDefinition / dss.DashboardPack catalog), single record:
 *   { "id": "default", "allowedRoles": ["SUPERVISOR", ...] }
 *
 * Resolution:
 *   - record present with a non-empty allowedRoles array → those role codes
 *   - record absent / fetch error / malformed shape → DASHBOARD_ROLES fallback
 *     (silent — a tenant that never seeds the master behaves exactly as before)
 *
 * Fetched through the same MDMS v1-compat search the rest of the UI uses
 * (Digit.Hooks.useCustomMDMS → /egov-mdms-service/v1/_search; mdms-v2 serves it
 * as schemaCode "dss.DashboardConfig"). react-query caches it for the session
 * (staleTime/cacheTime Infinity), so the gate costs one request per login, and
 * both consumers (route guard + home card) share the one cache entry.
 *
 * This is deliberately NOT a security boundary: the data plane is enforced
 * server-side by the analytics catalog + scope RBAC. This hook only decides
 * whether the nav surfaces (home card, /employee/dashboard route) show.
 *
 * @returns {{ allowed: boolean, loading: boolean }} — consumers must render
 *   nothing while `loading` so the gate never flashes a redirect/card.
 */
export const useDashboardAccess = () => {
  const stateId = Digit.ULBService.getStateId();

  const { data, isLoading } = Digit.Hooks.useCustomMDMS(
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
  const configured = Array.isArray(record?.allowedRoles)
    ? record.allowedRoles.filter((role) => typeof role === "string" && role)
    : [];
  const roles = configured.length ? configured : DASHBOARD_ROLES;

  return { allowed: !!Digit.UserService.hasAccess(roles), loading: isLoading };
};
