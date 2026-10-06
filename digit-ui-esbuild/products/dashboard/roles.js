import { useEffect, useState } from "react";
import { fetchAccess } from "./src/services/analyticsService";
import { getTenantId } from "./src/services/authService";

/**
 * useDashboardAccess — resolves the dashboard's nav/route gate from
 * egov-accesscontrol via POST /pgr-services/v2/analytics/_access.
 *
 * PGR resolves the caller's roles server-side (the same RequestInfo every
 * other analytics call already sends) and asks egov-accesscontrol whether
 * they hold the base analytics capability — the frontend sends no role list,
 * parses no policy, and keeps no allowlist of its own. This replaces the
 * former dss.DashboardConfig `allowedRoles` MDMS field and the hardcoded
 * DASHBOARD_ROLES fallback list, both retired by issue #1050.
 *
 * Fails CLOSED: a network error, a non-2xx response, or a malformed body all
 * resolve to `allowed: false` — unlike the old MDMS-backed gate, there is no
 * client-side fallback list to widen access when the call can't be resolved.
 *
 * This is deliberately NOT a security boundary: the data plane is enforced
 * server-side by the analytics catalog + capability checks. This hook only
 * decides whether the nav surfaces (home card, /employee/dashboard route)
 * show.
 *
 * @returns {{ allowed: boolean, loading: boolean }} — consumers must render
 *   nothing while `loading` so the gate never flashes a redirect/card.
 */
export const useDashboardAccess = () => {
  const [state, setState] = useState({ allowed: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    fetchAccess(getTenantId())
      .then((res) => {
        if (cancelled) return;
        setState({ allowed: res?.allowed === true, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ allowed: false, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
