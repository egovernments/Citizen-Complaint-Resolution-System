/**
 * useInboxVisibility — feature flag for the PGR inbox My/All visibility tabs
 * (Visibility V1, VISIBILITY-DESIGN.md §6.1).
 *
 * Reads the state-level MDMS master `RAINMAKER-PGR.InboxVisibilityConfig`
 * ({ enabled, version, reporteeDepth, ... }). The flag is OFF unless a record
 * exists with `enabled: true` — an absent master, a fetch error, or
 * `enabled: false` all render the LEGACY inbox (no tabs, assigned-to-me
 * radio, OPEN_STATES default search), exactly as before Visibility V1.
 * Per-tenant rollout and rollback are therefore a pure MDMS flip; no
 * frontend redeploy (holistic-fix / MDMS-over-code convention).
 *
 * The BE counterpart (Step 2) is `PGR_VISIBILITY_ENABLED` on pgr-services
 * plus the same MDMS master read per tenant by VisibilityService — see the
 * design doc for the layering.
 */
const useInboxVisibility = () => {
  const stateId = Digit.ULBService.getStateId();
  const { data, isLoading } = Digit.Hooks.useCommonMDMS(stateId, "RAINMAKER-PGR", ["InboxVisibilityConfig"], {
    select: (d) => d?.["RAINMAKER-PGR"]?.InboxVisibilityConfig?.[0],
    retry: false,
  });

  return { enabled: data?.enabled === true, config: data, isLoading };
};

export default useInboxVisibility;
