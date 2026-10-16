import { pendingInvitationsFor } from "../bindings/invitations.js";
import type express from "express";
import { accountMetadata, unlinkProvider } from "../authentication/account-service.js";
import { privateRef } from "../citizen-otp/otp-store.js";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { logoutFromKeycloak } from "../authentication/oidc.js";
import { DEFAULT_SURFACE, parseSurface, surfaceContextKind } from "../authentication/surfaces.js";
import { logoutSessions } from "../revocation/index.js";
import { currentSession } from "./current-session.js";
import {
  clearedSessionCookie,
  getIdentitySession,
  getSelectedIdentityContext,
  identitySessionSurface,
  listPersonSessions,
  sessionIdFromCookie,
} from "./session-store.js";

/** How long `GET /session` waits for invitations before answering without them. */
export const PENDING_INVITATIONS_WAIT_MS = 3_000;

/**
 * Invitations are a hint on the session read, never a dependency of it: a
 * Keycloak Admin outage, malformed `digit.bindings`, a busy lease or a slow
 * read all degrade to `[]` rather than failing a valid session.
 */
async function pendingInvitationsOrEmpty(subject: string): Promise<Awaited<ReturnType<typeof pendingInvitationsFor>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pendingInvitationsFor(subject),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), PENDING_INVITATIONS_WAIT_MS); }),
    ]);
  } catch (error) {
    console.warn("Pending invitations unavailable:", (error as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function registerSessionRoutes(app: express.Application): void {
  app.get("/identity/v1/session", asyncRoute(async (request, response) => {
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface", code: "UNSUPPORTED_SURFACE" });
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) return response.status(401).json({ authenticated: false, code: "SESSION_REQUIRED", error: "A signed-in session is required" });
    const { claims, boundTenant } = current.session;
    const context = await getSelectedIdentityContext(current.sessionId);
    const account = request.query.include === "account" ? await accountMetadata(current.session, surface) : undefined;
    const sessions = account ? (await listPersonSessions(claims.sub)).map(session => ({
      id: privateRef("session", session.sessionId), current: session.sessionId === current.sessionId,
      surface: session.surface, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
    })) : undefined;
    return response.json({
      ...(account && { account, sessions }),
      authenticated: true,
      pendingInvitations: surfaceContextKind(surface) === "citizen" ? [] : await pendingInvitationsOrEmpty(claims.sub),
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
        ...(surfaceContextKind(surface) === "citizen" && {
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

  app.post("/identity/v1/account/providers/_unlink", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) return response.status(403).json({ code: "UNTRUSTED_ORIGIN", error: "Untrusted request origin" });
    const surface = parseSurface(request.body?.surface ?? request.query.surface);
    if (!surface) return response.status(400).json({ code: "UNSUPPORTED_SURFACE", error: "Unsupported sign-in surface" });
    const alias = request.body?.alias;
    if (typeof alias !== "string" || !/^[A-Za-z0-9._-]+$/.test(alias)) return response.status(400).json({ code: "INVALID_REQUEST", error: "A provider alias is required" });
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) return response.status(401).json({ code: "SESSION_REQUIRED", error: "A signed-in session is required" });
    const providers = await unlinkProvider(current.session.claims.sub, current.sessionId, surface, alias);
    return response.json({ providers });
  }));

  app.post("/identity/v1/logout", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const surface = parseSurface(request.body?.surface ?? request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface", code: "UNSUPPORTED_SURFACE" });
    const scope = request.body?.scope ?? request.query.scope ?? "current";
    if (scope !== "current" && scope !== "others" && scope !== "all") return response.status(400).json({ code: "INVALID_REQUEST", error: "Unsupported logout scope" });
    const sessionId = sessionIdFromCookie(request.headers.cookie, surface);
    if (sessionId) {
      const session = await getIdentitySession(sessionId);
      if (session && identitySessionSurface(session) === surface) {
        // Retain logout support for sessions created before Keycloak sid was recorded.
        const legacy = (await Promise.all((await listPersonSessions(session.claims.sub))
          .filter(item => scope === "all" || (scope === "current" ? item.sessionId === sessionId : item.sessionId !== sessionId))
          .map(item => getIdentitySession(item.sessionId)))).filter(item => item && !item.kcSessionId);
        await logoutSessions(session.claims.sub, scope, sessionId);
        for (const item of legacy) await logoutFromKeycloak(item!.refreshToken, item!.oidcClientId || config.keycloakBffClientId)
          .catch(error => console.warn("Keycloak logout failed:", (error as Error).message));
      }
    }
    if (scope !== "others") response.setHeader("Set-Cookie", clearedSessionCookie(surface));
    return response.status(204).end();
  }));
}
