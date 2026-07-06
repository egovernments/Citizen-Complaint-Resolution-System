import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";

/**
 * useBusinessServiceStates — reads the PGR workflow BusinessService and exposes
 * helpers to map roles -> the workflow states those roles own (their "queue").
 *
 * This is the FE-side, UNOPTIMISED half of Visibility V1 (Step 1). The real
 * implementation resolves this server-side from a materialized HRMS projection
 * (see CCRS/VISIBILITY-DESIGN.md §4). Here we derive "statesFor(roles)" live in
 * the browser so the My/All tabs return genuinely different result sets against
 * the existing pgr `_search`/`_count` — no backend change.
 *
 * "A complaint sits in state S waiting for the role(s) that can act on S."
 * So statesFor(role) = { S.applicationStatus : some action of S lists that role }.
 */
const useBusinessServiceStates = (tenantId) => {
  const fetchStates = async () => {
    const wfBs = await Request({
      url: "/egov-workflow-v2/egov-wf/businessservice/_search",
      method: "POST",
      auth: true,
      userService: true,
      useCache: true,
      params: { tenantId, businessServices: "PGR" },
    });
    return wfBs?.BusinessServices?.[0]?.states || [];
  };

  const { data: states = [], isLoading } = useQuery(
    ["pgrBusinessServiceStates", tenantId],
    fetchStates,
    { staleTime: 5 * 60 * 1000, retry: false, refetchOnWindowFocus: false }
  );

  const codeOf = (s) => s?.applicationStatus || s?.state;

  // Every open/actionable state (any non-terminal state that has actions).
  const allActionableStates = states
    .filter((s) => !s?.isTerminateState && Array.isArray(s?.actions) && s.actions.length > 0)
    .map(codeOf)
    .filter(Boolean);

  // States whose actions can be performed by any of the given role codes.
  const statesForRoles = (roleCodes = []) => {
    if (!roleCodes.length) return [];
    const set = new Set();
    states.forEach((s) => {
      (s.actions || []).forEach((a) => {
        (a.roles || []).forEach((r) => {
          if (roleCodes.includes(r)) {
            const code = codeOf(s);
            if (code) set.add(code);
          }
        });
      });
    });
    return [...set];
  };

  return { statesForRoles, allActionableStates, isLoading };
};

export default useBusinessServiceStates;
