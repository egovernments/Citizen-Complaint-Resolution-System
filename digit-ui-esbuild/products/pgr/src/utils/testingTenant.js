// Testing-tenant scoping — shared by the citizen create dispatcher and the
// complaints list so the same rule decides tenant visibility everywhere.
//
// A tenant is "testing" when the configurator's "Make this a testing tenant"
// checkbox set `isTestingTenant: true` on its record. StoreService reads the
// authoritative tenant.tenants master and caches the codes as
// initData.testingTenantCodes, so this resolves synchronously (usable inside a
// react-query `select`, no hook needed).
//
// FLAG ∪ LEGACY CONFIG: flagged codes are UNIONED with the legacy deploy-time
// globalConfigs TESTING_TENANT_ID (not flag-else-config) — on a box mid-
// migration where one tenant is flagged but another is still known only via
// the config, both must stay hidden from production.
//
// TESTING_MODE (per-entrance boolean, still from globalConfigs) identifies
// whether THIS entrance is the testing one; the flag identifies WHICH tenants
// are testing. The two are orthogonal and both required.

export const getTestingTenantCodes = () => {
  let codes = [];
  try {
    const cached = window?.Digit?.SessionStorage?.get?.("initData")?.testingTenantCodes;
    if (Array.isArray(cached)) codes = cached.filter(Boolean);
  } catch (e) {
    /* initData not ready — the legacy config below still applies */
  }
  const cfg = window?.globalConfigs?.getConfig?.("TESTING_TENANT_ID");
  if (cfg && !codes.includes(cfg)) codes.push(cfg);
  return new Set(codes);
};

export const isTestingEntrance = () => !!window?.globalConfigs?.getConfig?.("TESTING_MODE");

// Should a row belonging to `tenantCode` be shown on THIS entrance?
//   - no testing setup at all (empty set)  -> prod shows everything, testing shows nothing
//   - testing entrance                     -> only testing-tenant rows
//   - production entrance                  -> everything EXCEPT testing-tenant rows
export const isVisibleOnEntrance = (tenantCode) => {
  const testing = getTestingTenantCodes();
  const onTestingEntrance = isTestingEntrance();
  if (testing.size === 0) return !onTestingEntrance;
  return onTestingEntrance ? testing.has(tenantCode) : !testing.has(tenantCode);
};
