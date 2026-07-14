import { useCallback, useMemo } from "react";
import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";
import Urls from "../../utils/urls";

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
 * So statesFor(role) = { S.applicationStatus : some action of S lists that role },
 * restricted to non-terminal states: a role that can act on a terminal state
 * (e.g. CSR reopening RESOLVED) doesn't "own" a queue there, and counting it
 * would let My contain states that All excludes.
 *
 * Both returns are reference-stable (useMemo/useCallback): PGRInbox memoizes
 * the composer config off them, and the composer treats config identity as
 * load-bearing (see the CCRS#558 note in PGRInbox.js).
 */
const codeOf = (s) => s?.applicationStatus || s?.state;
const isActionable = (s) => !s?.isTerminateState && Array.isArray(s?.actions) && s.actions.length > 0;

const useBusinessServiceStates = (tenantId) => {
  const fetchStates = async () => {
    const wfBs = await Request({
      url: Urls.workflow.businessServiceSearch,
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

  // Every open/actionable state (any non-terminal state that has actions).
  const allActionableStates = useMemo(
    () => states.filter(isActionable).map(codeOf).filter(Boolean),
    [states]
  );

  // States whose actions can be performed by any of the given role codes.
  const statesForRoles = useCallback(
    (roleCodes = []) => {
      if (!roleCodes.length) return [];
      const set = new Set();
      states.filter(isActionable).forEach((s) => {
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
    },
    [states]
  );

  return { statesForRoles, allActionableStates, isLoading };
};

export default useBusinessServiceStates;
