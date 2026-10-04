import { requestJson, restrictDestination, surfaceBase } from "./identityBffLogin";

import { identityMessage } from "./identityMessages";
export { identityMessage } from "./identityMessages";

export async function accountRequest(fetchImpl, url, data) {
  const { response, body } = await requestJson(fetchImpl, url, data === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = new Error(identityMessage(body?.code).message);
    error.code = body?.code;
    throw error;
  }
  return body;
}

// Called only when the person opens account settings, never by the app shell.
export function loadIdentityAccount({ surface, fetchImpl }) {
  return accountRequest(fetchImpl, `/identity/v1/session?surface=${encodeURIComponent(surface)}&include=account`);
}

export function buildAccountActionUrl({ surface, tenant, account, action, credentialId, provider, returnTo }) {
  if (!account?.actions?.includes(action)) throw new Error("Action not available");
  if (action === "delete_credential" && !account.credentials?.some((c) =>
    c.id === credentialId && ["otp", "webauthn"].includes(c.type))) {
    throw new Error("Select a second-factor credential");
  }
  if (action === "idp_link" && (!provider || account.providers?.some((p) => p.alias === provider))) {
    throw new Error("Select an unlinked provider");
  }
  const base = surfaceBase(tenant, surface);
  const destination = restrictDestination(returnTo, base);
  const params = new URLSearchParams({ surface, tenantSlug: tenant.urlSlug, action,
    returnTo: destination === base ? `${base}/user/account` : destination });
  if (action === "delete_credential") params.set("credentialId", credentialId);
  if (action === "idp_link") params.set("provider", provider);
  return `/identity/v1/authorize?${params}`;
}

export function availableProviders(methods, account) {
  return (methods || []).filter((m) => m.type === "idp" && m.idpHint &&
    !account?.providers?.some((p) => p.alias === m.idpHint));
}

// Surface query selector agreed on bridge thread identity-surface-requests;
// bodies remain the frozen invitation/provider shapes.
export function acceptIdentityInvitation({ tenant, invitation, fetchImpl }) {
  if (invitation?.tenantId !== tenant.tenantId || !Number.isInteger(invitation.invitationVersion)) {
    throw new Error("No invitation for this workspace");
  }
  return accountRequest(fetchImpl, "/identity/v1/workspace-invitations/_accept?surface=employee", {
    tenantId: invitation.tenantId, invitationVersion: invitation.invitationVersion,
  });
}

export function unlinkIdentityProvider({ surface, alias, fetchImpl }) {
  return accountRequest(fetchImpl, `/identity/v1/account/providers/_unlink?surface=${encodeURIComponent(surface)}`, { alias });
}
