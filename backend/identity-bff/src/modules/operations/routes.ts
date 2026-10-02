import type express from "express";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";

export function registerOperationalRoutes(app: express.Application): void {
  app.get("/livez", (_request, response) => response.json({ status: "ok" }));

  app.get("/healthz", async (_request, response) => {
    try {
      await getRedis().ping();
      return response.json({ status: "ok", redis: "connected" });
    } catch {
      return response.status(503).json({ status: "unhealthy", redis: "disconnected" });
    }
  });

  app.get("/readyz", async (_request, response) => {
    const checks: Record<string, string> = {};
    try {
      await getRedis().ping();
      checks.redis = "connected";
      const jwks = await fetch(config.keycloakJwksUri, {
        signal: AbortSignal.timeout(config.digitTimeoutMs),
      });
      if (!jwks.ok) throw new Error(`JWKS ${jwks.status}`);
      checks.keycloak = "connected";
      if (config.digitMdmsSearchUrl) {
        const mdms = await fetch(config.digitMdmsSearchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            RequestInfo: { apiId: "digit-identity-bff-readiness" },
            MdmsCriteria: {
              tenantId: config.digitFoundationSourceTenant,
              moduleDetails: [{ moduleName: "tenant", masterDetails: [{ name: "tenants" }] }],
            },
          }),
          signal: AbortSignal.timeout(config.digitTimeoutMs),
        });
        if (!mdms.ok) throw new Error(`MDMS ${mdms.status}`);
        checks.mdms = "connected";
      }
      if (config.digitUserServiceUrl) {
        const users = await fetch(`${config.digitUserServiceUrl.replace(/\/$/, "")}/_search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ RequestInfo: { apiId: "digit-identity-bff-readiness" } }),
          signal: AbortSignal.timeout(config.digitTimeoutMs),
        });
        if (users.status >= 500) throw new Error(`egov-user ${users.status}`);
        await users.body?.cancel();
        checks.userService = "connected";
      }
      return response.json({ status: "ready", checks });
    } catch (error) {
      return response.status(503).json({
        status: "not_ready",
        checks,
        error: (error as Error).message,
      });
    }
  });
}
