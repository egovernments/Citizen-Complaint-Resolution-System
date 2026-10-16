import { withPersonLease, LeaseBusyError, LeaseLostError } from "../accounts/person-lease.js";
import { config } from "../../infrastructure/config.js";
import {
  refreshIdentityTokens,
  InvalidGrantError,
  IdentityUnavailableError,
  verifyIdentityAccessToken,
} from "../authentication/oidc.js";
import {
  deleteIdentitySession,
  getIdentitySession,
  identitySessionSurface,
  saveIdentitySession,
  SessionRevokedError,
  sessionIdFromCookie,
  touchIdentitySession,
} from "./session-store.js";
import { phoneIdentityStillValid } from "../organizations/organization-service.js";

const PHONE_OTP_IDENTITY_CHECK_MS = 60_000;
import type { IdentitySession } from "./types.js";
import { DEFAULT_SURFACE, type IdentitySurface } from "../authentication/surfaces.js";

/**
 * The session behind `surface`'s cookie. A session is only ever returned for
 * the surface that created it, so an employee or citizen session id pasted
 * into another surface's cookie authenticates nothing there.
 */
export async function currentSession(
  cookieHeader?: string,
  surface: IdentitySurface = DEFAULT_SURFACE,
): Promise<{ sessionId: string; session: IdentitySession } | null> {
  const sessionId = sessionIdFromCookie(cookieHeader, surface);
  if (!sessionId) return null;
  let session = await getIdentitySession(sessionId);
  if (!session || identitySessionSurface(session) !== surface || session.sessionExpiresAt <= Date.now()) return null;
  // Read-only requests must not queue behind a slow token mint or mirror.
  if (session.authMethod === "phone_otp"
    ? Date.now() - (session.identityCheckedAt || 0) <= PHONE_OTP_IDENTITY_CHECK_MS
    : session.accessExpiresAt > Date.now() + 30_000) return { sessionId, session };
  return withPersonLease(session.claims.sub, async () => {
    session = await getIdentitySession(sessionId);
    if (!session || session.sessionExpiresAt <= Date.now()) return null;
    if (session.authMethod === "phone_otp") {
      // No Keycloak token to refresh, so the Keycloak user is re-checked
      // directly: disabling or deleting it, or taking the verified number away
      // from it, ends the session within a minute.
      if (Date.now() - (session.identityCheckedAt || 0) > PHONE_OTP_IDENTITY_CHECK_MS) {
        let valid: boolean | null = null;
        try {
          valid = await phoneIdentityStillValid(session.claims.sub, session.claims.phone_number || "");
        } catch (error) {
          // A Keycloak blip must not sign every OTP citizen out. The check is
          // not marked done, so the next request tries again.
          console.warn("Phone OTP session identity check failed:", (error as Error).message);
          return { sessionId, session };
        }
        if (valid === false) {
          await deleteIdentitySession(sessionId);
          return null;
        }
        if (valid) {
          const checkedAt = Date.now();
          session = { ...session, identityCheckedAt: checkedAt };
          if (!await touchIdentitySession(sessionId, session, fresh => ({ ...fresh, identityCheckedAt: checkedAt }))) return null;
        }
      }
      return { sessionId, session };
    }

    if (session.accessExpiresAt > Date.now() + 30_000) {
      return { sessionId, session };
    }
    if (!session.refreshToken ||
        (session.refreshExpiresAt && session.refreshExpiresAt <= Date.now())) {
      await deleteIdentitySession(sessionId);
      return null;
    }

    try {
      const oidcClientId = session.oidcClientId || config.keycloakBffClientId;
      const tokens = await refreshIdentityTokens(session.refreshToken, oidcClientId);
      const claims = await verifyIdentityAccessToken(tokens.accessToken, oidcClientId);
      if (claims.sub !== session.claims.sub) {
        throw new Error("Refreshed token changed subject");
      }
      tokens.refreshToken ||= session.refreshToken;
      if (!tokens.refreshExpiresIn && session.refreshExpiresAt) {
        tokens.refreshExpiresIn = Math.max(
          1,
          Math.floor((session.refreshExpiresAt - Date.now()) / 1000),
        );
      }
      const sessionExpiresAt = session.sessionExpiresAt ||
        Date.now() + config.identitySessionTtlSeconds * 1000;
      await saveIdentitySession(
        sessionId,
        tokens,
        claims,
        Math.max(1, Math.floor((sessionExpiresAt - Date.now()) / 1000)),
        oidcClientId,
        sessionExpiresAt,
        { surface: session.surface, boundTenant: session.boundTenant },
      );
      session = await getIdentitySession(sessionId);
      return session ? { sessionId, session } : null;
    } catch (error) {
      console.warn("Identity session refresh failed:", (error as Error).message);
      if (error instanceof SessionRevokedError) return null;
      if (error instanceof LeaseBusyError || error instanceof LeaseLostError) throw error;
      if (error instanceof InvalidGrantError) {
        await deleteIdentitySession(sessionId);
        return null;
      }
      throw new IdentityUnavailableError("Identity service is temporarily unavailable");
    }
  });
}
