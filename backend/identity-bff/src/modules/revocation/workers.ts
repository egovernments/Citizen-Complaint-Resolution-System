import { drainKeycloakLogoutRetries, drainRevocationJobs } from "./index.js";
import { drainTokenRetries } from "./inventory.js";

/** Independent of Keycloak polling: retries still run when the event API is down. */
export function startRevocationWorkers(): () => void {
  let active = false; let stopped = false;
  const tick = async () => {
    if (active || stopped) return;
    active = true;
    try {
      // One broken subject must not prevent the already-recorded token retries.
      await drainRevocationJobs().catch(() => { console.warn("Subject revocation retry deferred"); });
      await drainTokenRetries().catch(() => { console.warn("Token revocation retry deferred"); });
      await drainKeycloakLogoutRetries().catch(() => { console.warn("Keycloak logout retry deferred"); });
    } finally { active = false; }
  };
  const timer = setInterval(tick, 5_000); timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
