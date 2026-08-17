import { useMemo } from "react";

// Reopen window in milliseconds, read from MDMS RAINMAKER-PGR.UIConstants.REOPENSLA — the
// tenant-configurable knob the configurator already exposes for PGR, and the single source of
// truth for how long a resolved/rejected complaint stays reopenable. pgr-services reads the
// very same master in validateReOpen(), so the UI guard and server enforcement cannot drift.
//
// Returns undefined while MDMS is loading and on tenants with no usable value. Callers must
// treat undefined as "window unknown" and let the action through rather than block it:
// pgr-services still applies its own pgr.complain.idle.time backstop, so deferring is safe,
// whereas blocking on a missing master would enforce a deadline nobody configured.
//
// Until #925 the window was a hardcoded `ComplainMaxIdleTime = 3600000` default parameter in the
// reopen timeline instances, which silently won over REOPENSLA because the MDMS lookup that was
// meant to supply it had been commented out — so every tenant got 1 hour regardless of config.
//
// NOTE on the arguments below: passing a 5th argument puts useCustomMDMS on its mdms-v2 branch,
// which builds its own react-query config and ignores everything in the 4th except `select`.
// So no cacheTime/retry/enabled is passed here — it would read as intent that never takes
// effect. The v2 branch likewise resolves the tenant itself via ULBService.getCurrentTenantId();
// `tenantId` is still passed because it keeps the non-v2 signature honest and callers already
// have it, but it does not select the tenant. Effective query config comes from
// useCustomAPIHook (cacheTime 1000ms, staleTime 5000ms, retry 2); the tenant is part of the
// query key via the request body, so there is no cross-tenant cache bleed.
const useReopenWindow = (tenantId) => {
  const { data } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "UIConstants" }],
    {
      select: (d) => d?.["RAINMAKER-PGR"]?.UIConstants,
    },
    { schemaCode: "RAINMAKER-PGR.UIConstants" }
  );

  return useMemo(() => {
    const value = Array.isArray(data) ? data[0]?.REOPENSLA : undefined;
    // A non-positive window would hide REOPEN forever; treat it as misconfigured and defer.
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  }, [data]);
};

export default useReopenWindow;
