import { config } from "../../infrastructure/config.js";
import {
  refreshIdentityTokens,
  verifyIdentityAccessToken,
} from "../authentication/oidc.js";
import {
  deleteIdentitySession,
  getIdentitySession,
  saveIdentitySession,
  sessionIdFromCookie,
} from "./session-store.js";
import type { IdentitySession } from "./types.js";

export async function currentSession(
  cookieHeader?: string,
): Promise<{ sessionId: string; session: IdentitySession } | null> {
  const sessionId = sessionIdFromCookie(cookieHeader);
  if (!sessionId) return null;
  let session = await getIdentitySession(sessionId);
  if (!session) return null;

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
    );
    session = (await getIdentitySession(sessionId))!;
    return { sessionId, session };
  } catch (error) {
    console.warn("Identity session refresh failed:", (error as Error).message);
    await deleteIdentitySession(sessionId);
    return null;
  }
}
