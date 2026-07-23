import { useMemo } from "react";

// Reopen window in milliseconds, read from MDMS RAINMAKER-PGR.UIConstants.REOPENSLA — the
// tenant-configurable knob the configurator already exposes for PGR, and the single source of
// truth for how long a resolved/rejected complaint stays reopenable.
//
// Returns undefined while MDMS is loading and on tenants with no usable value. Callers must
// treat undefined as "window unknown" and let the action through rather than block it:
// pgr-services still applies its own pgr.complain.idle.time backstop, so deferring is safe,
// whereas blocking on a missing master would enforce a deadline nobody configured.
//
// Until #925 the window was a hardcoded `ComplainMaxIdleTime = 3600000` default parameter in the
// reopen timeline instances, which silently won over REOPENSLA because the MDMS lookup that was
// meant to supply it had been commented out — so every tenant got 1 hour regardless of config.
const useReopenWindow = (tenantId) => {
  const { data } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "UIConstants" }],
    {
      cacheTime: Infinity,
      retry: false,
      enabled: !!tenantId,
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
