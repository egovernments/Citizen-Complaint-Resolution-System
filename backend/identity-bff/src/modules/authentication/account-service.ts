import { withPersonLease } from "../accounts/person-lease.js";
import { enabledIdentityProviders, identityClient, request } from "../organizations/organization-service.js";
import { readUser } from "../../integrations/keycloak/admin-api.js";
import { requireCurrentSession } from "../sessions/session-store.js";
import type { IdentitySession } from "../sessions/types.js";
import { surfaceConfig, surfaceContextKind, type IdentitySurface } from "./surfaces.js";

export const ACCOUNT_ACTIONS = ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "delete_credential", "UPDATE_EMAIL", "idp_link"] as const;
export type AccountAction = typeof ACCOUNT_ACTIONS[number];
export class AccountActionError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export interface AccountMetadata {
  actions: AccountAction[];
  credentials: Array<{ id: string; type: string; label: string }>;
  providers: Array<{ alias: string }>;
}

export async function accountMetadata(session: IdentitySession, surface: IdentitySurface): Promise<AccountMetadata> {
  if (session.authMethod === "phone_otp") return { actions: [], credentials: [], providers: [] };
  const subject = encodeURIComponent(session.claims.sub);
  const [client, credentialsResponse, providersResponse] = await Promise.all([
    identityClient(surfaceConfig(surface).clientId),
    request(`/users/${subject}/credentials`), request(`/users/${subject}/federated-identity`),
  ]);
  const declared = (client?.attributes["digit.auth.account.actions"] || "").split(",").map(value => value.trim());
  const credentials = await credentialsResponse.json() as Array<{ id?: string; type?: string; userLabel?: string }>;
  const providers = await providersResponse.json() as Array<{ identityProvider?: string }>;
  return {
    actions: client?.enabled ? ACCOUNT_ACTIONS.filter(action => declared.includes(action)) : [],
    credentials: credentials.flatMap(item => item.id && item.type ? [{ id: item.id, type: item.type, label: item.userLabel || "" }] : []),
    providers: providers.flatMap(item => item.identityProvider ? [{ alias: item.identityProvider }] : []),
  };
}

export async function authorizeAccountAction(session: IdentitySession, surface: IdentitySurface, action: unknown, credentialId: unknown, provider: unknown): Promise<string> {
  const account = await accountMetadata(session, surface);
  if (typeof action !== "string" || !account.actions.includes(action as AccountAction)) {
    throw new AccountActionError("ACTION_NOT_ALLOWED", 400, "This account action is not available");
  }
  if (action === "delete_credential") {
    if (typeof credentialId !== "string" || !credentialId) throw new AccountActionError("INVALID_REQUEST", 400, "credentialId is required");
    if (!account.credentials.some(item => item.id === credentialId && ["otp", "webauthn"].includes(item.type))) {
      throw new AccountActionError("CREDENTIAL_NOT_SECOND_FACTOR", 409, "Only a second-factor credential may be removed");
    }
    return `${action}:${credentialId}`;
  }
  if (action === "idp_link") {
    if (typeof provider !== "string" || !/^[A-Za-z0-9._-]+$/.test(provider) || !(await enabledIdentityProviders()).has(provider)) {
      throw new AccountActionError("INVALID_REQUEST", 400, "An enabled provider is required");
    }
    if (account.providers.some(item => item.alias === provider)) throw new AccountActionError("PROVIDER_ALREADY_LINKED", 409, "This provider is already linked");
    return `${action}:${provider}`;
  }
  return action;
}

export async function unlinkProvider(subject: string, sessionId: string, surface: IdentitySurface, alias: string): Promise<Array<{ alias: string }>> {
  return withPersonLease(subject, async lease => {
    const session = await requireCurrentSession(lease, sessionId);
    const account = await accountMetadata(session, surface);
    if (!account.providers.some(provider => provider.alias === alias)) throw new AccountActionError("PROVIDER_NOT_LINKED", 404, "This provider is not linked");
    const user = await readUser(subject);
    if (user.enabled === false) throw new AccountActionError("SESSION_REVOKED", 401, "This session has ended");
    const phone = surfaceContextKind(surface) === "citizen" && user.attributes?.phoneNumberVerified?.includes("true") && user.attributes?.phoneNumber?.some(value => /^\+[1-9]\d{3,14}$/.test(value));
    const primaryCount = Number(account.credentials.some(credential => credential.type === "password")) + account.providers.length + Number(Boolean(phone));
    if (primaryCount <= 1) throw new AccountActionError("LAST_SIGNIN_METHOD", 409, "Keep at least one sign-in method");
    await lease.assertHeld();
    await request(`/users/${encodeURIComponent(subject)}/federated-identity/${encodeURIComponent(alias)}`, { method: "DELETE" }, [204]);
    return account.providers.filter(provider => provider.alias !== alias);
  });
}
