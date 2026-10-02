import { config } from "../../infrastructure/config.js";
import { validateJwt } from "./token-verifier.js";
import type { IdentityTokenSet, KeycloakClaims } from "./types.js";

interface OidcClient {
  clientId: string;
  clientSecret: string;
}

export function oidcClientForMethod(type: "password" | "oauth" | "magic_link"): OidcClient {
  return type === "magic_link"
    ? {
      clientId: config.keycloakMagicLinkClientId,
      clientSecret: config.keycloakMagicLinkClientSecret,
    }
    : {
      clientId: config.keycloakBffClientId,
      clientSecret: config.keycloakBffClientSecret,
    };
}

function oidcClient(clientId: string): OidcClient {
  if (clientId === config.keycloakMagicLinkClientId && config.keycloakMagicLinkClientSecret) {
    return oidcClientForMethod("magic_link");
  }
  if (clientId === config.keycloakBffClientId) return oidcClientForMethod("password");
  throw new Error("Unknown identity OIDC client");
}

function oidcUrl(path: string, backchannel = false): string {
  const base = backchannel
    ? config.keycloakOidcBackchannelUrl
    : config.keycloakIssuer;
  return `${base.replace(/\/$/, "")}/protocol/openid-connect/${path}`;
}

export function authorizationUrl(
  state: string,
  codeChallenge: string,
  nonce: string,
  clientId: string,
  idpHint?: string,
): string {
  const url = new URL(oidcUrl("auth"));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: config.identityRedirectUri,
    response_type: "code",
    scope: config.identityScope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (idpHint) params.set("kc_idp_hint", idpHint);
  url.search = params.toString();
  return url.toString();
}

async function tokenRequest(params: URLSearchParams, clientId: string): Promise<IdentityTokenSet> {
  const client = oidcClient(clientId);
  params.set("client_id", client.clientId);
  params.set("client_secret", client.clientSecret);

  const response = await fetch(oidcUrl("token", true), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error(`Keycloak token request failed: ${response.status}`);
  }

  const body = await response.json() as Record<string, unknown>;
  if (typeof body.access_token !== "string" ||
      typeof body.expires_in !== "number") {
    throw new Error("Keycloak returned an invalid token response");
  }

  return {
    accessToken: body.access_token,
    idToken: typeof body.id_token === "string" ? body.id_token : undefined,
    refreshToken:
      typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    accessExpiresIn: body.expires_in,
    refreshExpiresIn:
      typeof body.refresh_expires_in === "number"
        ? body.refresh_expires_in
        : undefined,
  };
}

export async function verifyIdentityIdToken(
  idToken: string | undefined,
  expectedNonce: string,
  clientId: string,
): Promise<KeycloakClaims> {
  if (!idToken) throw new Error("Keycloak did not return an ID token");
  const claims = await validateJwt(`Bearer ${idToken}`, {
    issuer: config.keycloakIssuer,
    audience: clientId,
  });
  if (!claims || claims.nonce !== expectedNonce) {
    throw new Error("Keycloak returned an invalid ID token");
  }
  return claims;
}

export function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  clientId: string,
): Promise<IdentityTokenSet> {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.identityRedirectUri,
    code_verifier: codeVerifier,
  }), clientId);
}

export function refreshIdentityTokens(
  refreshToken: string,
  clientId = config.keycloakBffClientId,
): Promise<IdentityTokenSet> {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), clientId);
}

export async function verifyIdentityAccessToken(
  accessToken: string,
  expectedAuthorizedParty = config.keycloakBffClientId,
): Promise<KeycloakClaims> {
  const claims = await validateJwt(`Bearer ${accessToken}`, {
    issuer: config.keycloakIssuer,
    audience: config.keycloakBffAudience,
  });
  if (!claims) throw new Error("Keycloak returned an invalid access token");
  if (claims.azp !== expectedAuthorizedParty) {
    throw new Error("Keycloak access token has an invalid authorized party");
  }
  return claims;
}

export async function logoutFromKeycloak(
  refreshToken?: string,
  clientId = config.keycloakBffClientId,
): Promise<void> {
  if (!refreshToken) return;
  const client = oidcClient(clientId);
  const response = await fetch(oidcUrl("logout", true), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Keycloak logout failed: ${response.status}`);
  }
}
