import { withPersonLease } from "../accounts/person-lease.js";
import { ensureActive } from "../bindings/store.js";
import { revokeTenantMembers } from "../revocation/index.js";
import { createOnboardingDependencies } from "./adapter.js";

export const onboardingDependencies = createOnboardingDependencies({
  withPersonLease,
  ensureActive,
  revokeTenantMembers,
});
