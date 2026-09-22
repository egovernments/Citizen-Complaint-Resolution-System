import express from "express";
import { config } from "../infrastructure/config.js";
import { registerControlPlaneRoutes } from "../modules/control-plane/routes.js";
import { registerAccessContextRoutes } from "../modules/access-context/routes.js";
import { registerAuthenticationRoutes } from "../modules/authentication/routes.js";
import { registerMagicLinkSignupRoutes } from "../modules/authentication/magic-link-signup.js";
import { registerPasswordSetupRoutes } from "../modules/authentication/password-setup.js";
import { registerOperationalRoutes } from "../modules/operations/routes.js";
import { registerOrganizationRoutes } from "../modules/organizations/routes.js";
import { registerSessionRoutes } from "../modules/sessions/routes.js";

/**
 * The standalone identity boundary. Keep this application free of DIGIT
 * domain-service imports: PGR and other onboarding services are callers, not
 * dependencies.
 */
export function createIdentityApp(): express.Application {
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
  registerMagicLinkSignupRoutes(app);
  registerPasswordSetupRoutes(app);
  registerSessionRoutes(app);
  registerAccessContextRoutes(app);
  registerOrganizationRoutes(app);
  registerControlPlaneRoutes(app);
  return app;
}
