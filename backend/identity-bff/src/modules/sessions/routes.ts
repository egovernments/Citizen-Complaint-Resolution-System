import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { logoutFromKeycloak } from "../authentication/oidc.js";
import { revokeManagedUserLogins } from "../managed-accounts/managed-account-service.js";
import { currentSession } from "./current-session.js";
import {
  clearedSessionCookie,
  deleteIdentitySession,
  getIdentitySession,
  getSelectedIdentityContext,
  sessionIdFromCookie,
} from "./session-store.js";

export function registerSessionRoutes(app: express.Application): void {
  app.get("/identity/v1/session", asyncRoute(async (request, response) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) return response.status(401).json({ authenticated: false });
    const { claims } = current.session;
    const context = await getSelectedIdentityContext(current.sessionId);
    return response.json({
      authenticated: true,
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
      },
      context: context ? {
        tenantId: context.tenantId,
        name: context.name,
        organizationAlias: context.organizationAlias,
      } : null,
      expiresAt: current.session.sessionExpiresAt || current.session.accessExpiresAt,
    });
  }));

  app.post("/identity/v1/logout", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const sessionId = sessionIdFromCookie(request.headers.cookie);
    if (sessionId) {
      const session = await getIdentitySession(sessionId);
      await deleteIdentitySession(sessionId);
      if (session) {
        await revokeManagedUserLogins(config.keycloakIssuer, session.claims.sub)
          .catch((error: Error) => {
            console.warn("DIGIT token revocation failed:", error.message);
          });
      }
      await logoutFromKeycloak(
        session?.refreshToken,
        session?.oidcClientId || config.keycloakBffClientId,
      ).catch((error: Error) => {
        console.warn("Keycloak logout failed:", error.message);
      });
    }
    response.setHeader("Set-Cookie", clearedSessionCookie());
    return response.status(204).end();
  }));
}
