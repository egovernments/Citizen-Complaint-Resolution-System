import { registerWorkspaceMemberRoutes } from "../modules/workspace-members/routes.js";
import express from "express";
import { AccountActionError } from "../modules/authentication/account-service.js";
import { SessionRevokedError } from "../modules/sessions/session-store.js";
import { IdentityAdminError } from "../modules/organizations/organization-service.js";
import { LeaseBusyError, LeaseLostError } from "../modules/accounts/person-lease.js";
import { IdentityUnavailableError } from "../modules/authentication/oidc.js";
import { DigitUnavailableError } from "../modules/managed-accounts/digit-user-client.js";
import { surfaceRegistry } from "../modules/authentication/surfaces.js";
import { config } from "../infrastructure/config.js";
import { registerControlPlaneRoutes } from "../modules/control-plane/routes.js";
import { registerAccessContextRoutes } from "../modules/access-context/routes.js";
import { registerAuthenticationRoutes } from "../modules/authentication/routes.js";
import { registerMagicLinkRoutes } from "../modules/authentication/magic-link-signup.js";
import { registerPasswordSetupRoutes } from "../modules/authentication/password-setup.js";
import { registerOperationalRoutes } from "../modules/operations/routes.js";
import { registerSessionRoutes } from "../modules/sessions/routes.js";
import { registerCitizenOtpRoutes } from "../modules/citizen-otp/routes.js";

/**
 * The standalone identity boundary. Keep this application free of DIGIT
 * domain-service imports: PGR and other onboarding services are callers, not
 * dependencies.
 */
export function createIdentityApp(): express.Application {
  surfaceRegistry(); // Fail startup on unsafe or incomplete surface configuration.
  const app = express();
  if (config.identityTrustProxyHops > 0) {
    app.set("trust proxy", config.identityTrustProxyHops);
  }
  app.use(express.json({ limit: "1mb" }));
  registerOperationalRoutes(app);

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (req.path.startsWith("/identity/v1") && origin && config.identityAllowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use("/identity/v1", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  registerAuthenticationRoutes(app);
  registerMagicLinkRoutes(app);
  registerPasswordSetupRoutes(app);
  registerCitizenOtpRoutes(app);
  registerSessionRoutes(app);
  registerWorkspaceMemberRoutes(app);
  registerAccessContextRoutes(app);
  registerControlPlaneRoutes(app);
  app.use(identityErrorHandler);
  return app;
}

/** Maps known failures that escape a route to their JSON contract errors. */
export function identityErrorHandler(
  error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction,
): unknown {
  if (error instanceof AccountActionError || error instanceof LeaseBusyError || error instanceof LeaseLostError) {
    if (error instanceof LeaseBusyError || error instanceof LeaseLostError) res.setHeader("Retry-After", "1");
    return res.status(error.status).json({ code: error.code, error: error.message });
  }
  if (error instanceof SessionRevokedError) return res.status(401).json({ code: "SESSION_REVOKED", error: "This session has ended" });
  if (error instanceof IdentityUnavailableError || error instanceof IdentityAdminError) {
    return res.status(503).json({ code: "IDENTITY_UNAVAILABLE", error: "Identity service is temporarily unavailable" });
  }
  // A DIGIT (egov-user or MDMS) outage a route did not map itself: the JSON
  // contract error, never Express's HTML page.
  if (error instanceof DigitUnavailableError) {
    return res.status(503).json({ code: "DIGIT_UNAVAILABLE", error: "DIGIT is temporarily unavailable" });
  }
  return next(error);
}
