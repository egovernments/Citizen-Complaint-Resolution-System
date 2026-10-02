import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { ManagedAccountError } from "../managed-accounts/managed-account-service.js";
import { currentSession } from "../sessions/current-session.js";
import { getSelectedIdentityContext } from "../sessions/session-store.js";
import { inviteOrganizationMember } from "./member-invitation-service.js";
import { IdentityAdminError } from "./organization-service.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new IdentityAdminError(`${name} is required`, 400);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, name);
}

function emailAddress(value: unknown): string {
  const email = requiredString(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IdentityAdminError("email is invalid", 400);
  }
  return email;
}

function requestedRoles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(
    (role) => typeof role === "string" && role.trim(),
  )) {
    throw new IdentityAdminError("roles must be a string array", 400);
  }
  const roles = [...new Set(value.map((role: string) => role.trim()))].sort();
  const unsupported = roles.filter((role) => !config.digitManagedRoleAllowlist.includes(role));
  if (unsupported.length) {
    throw new IdentityAdminError(`Unsupported employee roles: ${unsupported.join(", ")}`, 400);
  }
  return roles;
}

function invitationFailure(error: unknown, response: express.Response) {
  if (error instanceof IdentityAdminError || error instanceof ManagedAccountError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error instanceof DigitUnavailableError) {
    return response.status(error.status === 409 ? 409 : 503).json({ error: error.message });
  }
  throw error;
}

export function registerOrganizationRoutes(app: express.Application): void {
  app.post("/identity/v1/organization-members/_invite", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const current = await currentSession(request.headers.cookie);
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    const context = await getSelectedIdentityContext(current.sessionId);
    if (!context) {
      return response.status(409).json({ error: "Select an Organization before inviting members" });
    }

    try {
      const result = await inviteOrganizationMember({
        actorSubject: current.session.claims.sub,
        context,
        email: emailAddress(request.body?.email),
        name: requiredString(request.body?.name, "name"),
        mobileNumber: requiredString(request.body?.mobileNumber, "mobileNumber"),
        countryCode: optionalString(request.body?.countryCode, "countryCode"),
        roles: requestedRoles(request.body?.roles),
      });
      return response.status(result.identityUserCreated ? 201 : 200).json(result);
    } catch (error) {
      return invitationFailure(error, response);
    }
  }));
}
