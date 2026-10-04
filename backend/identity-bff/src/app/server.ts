import { startKeycloakEventPoller } from "../modules/revocation/poller.js";
import { closeCache, initCache } from "../infrastructure/redis.js";
import { config } from "../infrastructure/config.js";
import { createIdentityApp } from "./create-app.js";
import { initJwks } from "../modules/authentication/token-verifier.js";
import { runIdentityReconciliation } from "../modules/reconciliation/reconciliation-service.js";
import { startOnboardingWorker } from "../modules/onboarding/worker.js";
import { warnAboutInsecureOtpModes } from "../modules/citizen-otp/otp-sender.js";
import { backfillTenantRoutes } from "../modules/tenant-routes/backfill.js";

initJwks();
initCache();
warnAboutInsecureOtpModes();

const app = createIdentityApp();
const stopEventPoller = startKeycloakEventPoller();
const reconcile = () => void runIdentityReconciliation()
  .then((result) => console.log("Identity reconciliation:", result))
  .catch((error) => console.error(
    "Identity reconciliation failed:",
    (error as Error).message,
  ));
const server = app.listen(config.port, () => {
  console.log(`digit-identity-bff listening on :${config.port}`);
  if (config.identityReconcileOnStartup) reconcile();
  if (config.identityTenantRouteBackfill) {
    void backfillTenantRoutes()
      .then((result) => console.log("Tenant route backfill:", JSON.stringify(result)))
      .catch((error) => console.error("Tenant route backfill failed:", (error as Error).message));
  }
  // Optional; failures to reach PGR are logged and never affect sign-in.
  startOnboardingWorker();
});

if (config.identityReconciliationIntervalSeconds > 0) {
  setInterval(reconcile, config.identityReconciliationIntervalSeconds * 1000).unref();
}

process.on("SIGTERM", () => {
  stopEventPoller();
  server.close(() => {
    void closeCache().finally(() => process.exit(0));
  });
});
