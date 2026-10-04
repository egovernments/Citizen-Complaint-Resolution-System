import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { logoutFromKeycloak } from "../authentication/oidc.js";
import { DEFAULT_SURFACE, parseSurface } from "../authentication/surfaces.js";
import {
  revokeCitizenLogin,
  revokeManagedUserLogins,
} from "../managed-accounts/managed-account-service.js";
import { currentSession } from "./current-session.js";
import {
  clearedSessionCookie,
  deleteIdentitySession,
  getIdentitySession,
  getSelectedIdentityContext,
  identitySessionSurface,
  sessionIdFromCookie,
} from "./session-store.js";

export function registerSessionRoutes(app: express.Application): void {
  app.get("/identity/v1/session", asyncRoute(async (request, response) => {
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface" });
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) return response.status(401).json({ authenticated: false });
    const { claims, boundTenant } = current.session;
    const context = await getSelectedIdentityContext(current.sessionId);
    return response.json({
      authenticated: true,
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
        ...(surface === "citizen" && {
          phoneNumber: claims.phone_number,
          phoneNumberVerified: claims.phone_number_verified === true,
        }),
      },
      context: context ? {
        tenantId: context.tenantId,
        name: context.name,
        organizationAlias: context.organizationAlias,
      } : null,
      // Only employee/citizen sessions carry these; the configurator shape is unchanged.
      ...(surface !== DEFAULT_SURFACE && {
        surface,
        tenant: boundTenant ? {
          urlSlug: boundTenant.urlSlug,
          tenantId: boundTenant.tenantId,
          name: boundTenant.name,
        } : null,
      }),
      expiresAt: current.session.sessionExpiresAt || current.session.accessExpiresAt,
    });
  }));

  app.post("/identity/v1/logout", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const surface = parseSurface(request.body?.surface ?? request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface" });
    const sessionId = sessionIdFromCookie(request.headers.cookie, surface);
    if (sessionId) {
      const stored = await getIdentitySession(sessionId);
      // Another surface's session id in this cookie is left untouched.
      const session = stored && identitySessionSurface(stored) === surface ? stored : null;
      if (!stored || session) await deleteIdentitySession(sessionId);
      if (session) {
        const revocation = surface === "citizen" && session.boundTenant
          ? revokeCitizenLogin(config.keycloakIssuer, session.claims.sub,
            session.boundTenant.tenantId, sessionId)
          : revokeManagedUserLogins(config.keycloakIssuer, session.claims.sub, sessionId);
        await revocation.catch((error: Error) => {
          console.warn("DIGIT token revocation failed:", error.message);
        });
        await logoutFromKeycloak(
          session.refreshToken,
          session.oidcClientId || config.keycloakBffClientId,
        ).catch((error: Error) => {
          console.warn("Keycloak logout failed:", error.message);
        });
      }
    }
    response.setHeader("Set-Cookie", clearedSessionCookie(surface));
    return response.status(204).end();
  }));
}
