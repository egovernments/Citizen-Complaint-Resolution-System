import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type FlattenedJWSInput, type JWSHeaderParameters, type KeyLike } from "jose";
import { config } from "../../infrastructure/config.js";
import type { KeycloakClaims } from "./types.js";

/**
 * Custom JWKS fetcher that uses native fetch() instead of jose's internal
 * http.get. This ensures the OTEL undici instrumentation propagates
 * traceparent to Keycloak, linking JWKS fetches into the parent trace.
 */
function createTracedRemoteJWKSet(url: URL, opts?: { cooldownDuration?: number }) {
  let cachedJwks: ReturnType<typeof createLocalJWKSet> | null = null;
  let lastFetch = 0;
  let pendingFetch: Promise<void> | null = null;
  const cooldown = opts?.cooldownDuration ?? 30_000;

  async function refreshJwks(): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const json = (await res.json()) as JSONWebKeySet;
    cachedJwks = createLocalJWKSet(json);
    lastFetch = Date.now();
  }

  return async (protectedHeader?: JWSHeaderParameters, token?: FlattenedJWSInput): Promise<KeyLike> => {
    const stale = !cachedJwks || Date.now() - lastFetch > cooldown;
    if (stale) {
      // Deduplicate concurrent fetches
      pendingFetch ??= refreshJwks().finally(() => { pendingFetch = null; });
      await pendingFetch;
    }
    return cachedJwks!(protectedHeader, token);
  };
}

const jwksCache = new Map<string, ReturnType<typeof createTracedRemoteJWKSet>>();
let jwksUriOverride: string | undefined;

function getJwks(realm: string): ReturnType<typeof createTracedRemoteJWKSet> {
  if (!jwksCache.has(realm)) {
    const uri = jwksUriOverride || `${config.keycloakAdminUrl}/realms/${realm}/protocol/openid-connect/certs`;
    jwksCache.set(realm, createTracedRemoteJWKSet(new URL(uri)));
  }
  return jwksCache.get(realm)!;
}

export function initJwks(jwksUri?: string) {
  jwksUriOverride = jwksUri;
  jwksCache.clear();
}

export async function validateJwt(
  authHeader: string | undefined,
  options?: { issuer?: string; audience?: string },
): Promise<KeycloakClaims | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    // Decode without full verification to extract issuer
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const iss = payload.iss as string;
    if (!iss) return null;
    if (options?.issuer && iss !== options.issuer) return null;

    const realm = iss.split("/realms/").pop();
    if (!realm) return null;

    const jwks = getJwks(realm);
    const { payload: verified } = await jwtVerify(token, jwks, {
      issuer: options?.issuer || iss,
      audience: options?.audience || undefined,
      algorithms: ["RS256"],
    });

    if (!verified.sub) return null;
    // KC's master-realm admin (and some other built-in accounts) often lack
    // an `email` claim. We synthesize one so downstream code that expects a
    // string keeps working — it's never used as a real address, just as a
    // stable identifier alongside `sub` for logging and cache keys.
    const email =
      (verified.email as string) ||
      `${verified.preferred_username || verified.sub}@${realm}.kc.local`;
    return {
      sub: verified.sub,
      email,
      name: (verified.name as string) || undefined,
      preferred_username:
        (verified.preferred_username as string) || undefined,
      email_verified: verified.email_verified as boolean | undefined,
      phone_number: (verified.phone_number as string) || undefined,
      realm_access: (verified.realm_access as { roles: string[] }) || undefined,
      groups: (verified.groups as string[]) || undefined,
      organization:
        (verified.organization as KeycloakClaims["organization"]) || undefined,
      nonce: (verified.nonce as string) || undefined,
      azp: (verified.azp as string) || undefined,
      realm,
    };
  } catch (err) {
    const e = err as Error & { code?: string };
    const tokenLen = (authHeader || "").slice(7).length;
    const dotCount = (authHeader || "").slice(7).split(".").length - 1;
    console.error(
      `[JWT] validateJwt failed: name=${e.name || "?"} code=${e.code || "?"} ` +
        `tokenLen=${tokenLen} dotCount=${dotCount} ` +
        `msg=${e.message || String(e)}`,
    );
    return null;
  }
}
