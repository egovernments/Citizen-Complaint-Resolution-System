// Testing-tenant scoping — shared by the citizen create dispatcher and the
// complaints list so the same rule decides tenant visibility everywhere.
//
// A tenant is "testing" when the configurator's "Make this a testing tenant"
// checkbox set `isTestingTenant: true` on its record. StoreService reads the
// authoritative tenant.tenants master and caches the codes as
// initData.testingTenantCodes, so this resolves synchronously (usable inside a
// react-query `select`, no hook needed).
//
// FLAG-FIRST, CONFIG-FALLBACK: if no tenant is flagged (a box that hasn't
// migrated to the flag yet), fall back to the legacy deploy-time
// globalConfigs TESTING_TENANT_ID so nothing breaks mid-migration.
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
    /* initData not ready — fall through to config */
  }
  if (codes.length === 0) {
    const cfg = window?.globalConfigs?.getConfig?.("TESTING_TENANT_ID");
    if (cfg) codes = [cfg];
  }
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
