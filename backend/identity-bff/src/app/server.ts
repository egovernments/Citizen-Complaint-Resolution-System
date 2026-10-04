import { closeCache, initCache } from "../infrastructure/redis.js";
import { config } from "../infrastructure/config.js";
import { createIdentityApp } from "./create-app.js";
import { initJwks } from "../modules/authentication/token-verifier.js";
import { startReconcile } from "../modules/sync/reconcile.js";
import { startOnboardingWorker } from "../modules/onboarding/worker.js";
import { warnAboutInsecureOtpModes } from "../modules/citizen-otp/otp-sender.js";
import { backfillTenantRoutes } from "../modules/tenant-routes/backfill.js";

initJwks();
initCache();
warnAboutInsecureOtpModes();

const app = createIdentityApp();
let stopReconcile = () => {};
const server = app.listen(config.port, () => {
  console.log(`digit-identity-bff listening on :${config.port}`);
  stopReconcile = startReconcile();
  if (config.identityTenantRouteBackfill) {
    void backfillTenantRoutes()
      .then((result) => console.log("Tenant route backfill:", JSON.stringify(result)))
      .catch((error) => console.error("Tenant route backfill failed:", (error as Error).message));
  }
  // Optional; failures to reach PGR are logged and never affect sign-in.
  startOnboardingWorker();
});

process.on("SIGTERM", () => {
  stopReconcile();
  server.close(() => {
    void closeCache().finally(() => process.exit(0));
  });
});
