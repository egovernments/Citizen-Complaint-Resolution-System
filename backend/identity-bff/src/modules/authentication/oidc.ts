import { config } from "../../infrastructure/config.js";
import { validateJwt } from "./token-verifier.js";
import type { IdentityAuthMethod, IdentityTokenSet, KeycloakClaims } from "./types.js";

import type { IdentitySurface } from "./surfaces.js";

export interface OidcClient {
  clientId: string;
  clientSecret: string;
  /** Surface whose sessions this client creates. */
  surface: IdentitySurface;
  /** Scope requested at the Keycloak authorization endpoint. */
  scope: string;
}

/**
 * Every Keycloak client the BFF may authorize, exchange, refresh or log out
 * with. Built on each call because tests (and future hot reloads) change
 * `config` at runtime. A client with no secret is not usable and therefore
 * absent, except the configurator's own client, whose secret has always had
 * a development default.
 */
function oidcClients(): OidcClient[] {
  const clients: OidcClient[] = [{
    clientId: config.keycloakBffClientId,
    clientSecret: config.keycloakBffClientSecret,
    surface: "configurator",
    scope: config.identityScope,
  }];
  if (config.keycloakMagicLinkClientSecret) {
    clients.push({
      clientId: config.keycloakMagicLinkClientId,
      clientSecret: config.keycloakMagicLinkClientSecret,
      surface: "configurator",
      scope: config.identityScope,
    });
  }
  if (config.keycloakEmployeeClientSecret) {
    clients.push({
      clientId: config.keycloakEmployeeClientId,
      clientSecret: config.keycloakEmployeeClientSecret,
      surface: "employee",
      scope: config.identityEmployeeScope,
    });
  }
  if (config.keycloakCitizenClientSecret) {
    clients.push({
      clientId: config.keycloakCitizenClientId,
      clientSecret: config.keycloakCitizenClientSecret,
      surface: "citizen",
      scope: config.identityCitizenScope,
    });
  }
  return clients;
}

export class UnknownOidcClientError extends Error {
  constructor() {
    super("Unknown identity OIDC client");
  }
}

export function oidcClient(clientId: string): OidcClient {
  const client = oidcClients().find((candidate) => candidate.clientId === clientId);
  if (!client) throw new UnknownOidcClientError();
  return client;
}

/** The Keycloak client configured for a surface and method, or null when unconfigured. */
export function oidcClientForSurface(
  surface: IdentitySurface,
  type: IdentityAuthMethod["type"],
): OidcClient | null {
  if (surface === "configurator") {
    return type === "magic_link"
      ? oidcClients().find((client) => client.clientId === config.keycloakMagicLinkClientId) || null
      : oidcClient(config.keycloakBffClientId);
  }
  // Employee and citizen journeys each run in their own Keycloak client,
  // flow and theme; magic links are a configurator-only signup channel.
  if (type === "magic_link") return null;
  const clientId = surface === "employee"
    ? config.keycloakEmployeeClientId
    : config.keycloakCitizenClientId;
  return oidcClients().find((client) =>
    client.clientId === clientId && client.surface === surface) || null;
}

function oidcUrl(path: string, backchannel = false): string {
  const base = backchannel
    ? config.keycloakOidcBackchannelUrl
    : config.keycloakIssuer;
  return `${base.replace(/\/$/, "")}/protocol/openid-connect/${path}`;
}

/** Parameters the BFF owns; `extraParams` can never override them. */
const RESERVED_AUTHORIZE_PARAMS = new Set([
  "client_id", "redirect_uri", "response_type", "scope", "state", "nonce",
  "code_challenge", "code_challenge_method", "kc_idp_hint",
]);

export function authorizationUrl(
  state: string,
  codeChallenge: string,
  nonce: string,
  clientId: string,
  options: {
    scope?: string;
    idpHint?: string;
    /** e.g. `digit_tenant` (display only), `prompt=login`, `ui_locales`. */
    extraParams?: Record<string, string>;
  } = {},
): string {
  const url = new URL(oidcUrl("auth"));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: config.identityRedirectUri,
    response_type: "code",
    scope: options.scope || config.identityScope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (options.idpHint) params.set("kc_idp_hint", options.idpHint);
  for (const [name, value] of Object.entries(options.extraParams || {})) {
    if (RESERVED_AUTHORIZE_PARAMS.has(name)) {
      throw new Error(`Authorization parameter ${name} is reserved`);
    }
    params.set(name, value);
  }
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
