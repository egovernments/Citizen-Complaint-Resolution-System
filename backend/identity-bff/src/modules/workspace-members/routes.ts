import type express from "express";
import { asyncRoute, sendError as send } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { errorStatus, isErrorCode, type HttpErrorCode } from "../../contract/error-codes.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { parseSurface } from "../authentication/surfaces.js";
import { currentSession } from "../sessions/current-session.js";
import { acceptWorkspaceInvitation, declineWorkspaceInvitation, linkWorkspaceMember, listWorkspaceMembers, removeWorkspaceMember, updateWorkspaceMemberEmail, type MemberState } from "./service.js";

const tenantPattern = /^[A-Za-z0-9_-]{1,50}$/;
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function failure(error: unknown, response: express.Response) {
  const candidate = error as { code?: unknown; message?: string; retryAfter?: number };
  if (candidate?.retryAfter) response.setHeader("Retry-After", String(candidate.retryAfter));
  if (isErrorCode(candidate?.code) && typeof errorStatus(candidate.code as HttpErrorCode) === "number") {
    return send(response, candidate.code as HttpErrorCode, candidate.message || "Identity operation failed");
  }
  return send(response, error instanceof DigitUnavailableError ? "DIGIT_UNAVAILABLE" : "IDENTITY_UNAVAILABLE", "Workspace membership is temporarily unavailable");
}
function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function registerWorkspaceMemberRoutes(app: express.Application): void {
  app.get("/identity/v1/workspace-members", asyncRoute(async (request, response) => {
    try {
      const current = await currentSession(request.headers.cookie);
      if (!current) return send(response, "SESSION_REQUIRED", "An identity session is required");
      const tenantId = request.query.tenantId;
      const first = Number(request.query.first ?? 0), max = Number(request.query.max ?? 100), state = request.query.state;
      if (state !== undefined && !["active", "pending", "removed"].includes(state as string)) return send(response, "INVALID_REQUEST", "Invalid member query");
      if (typeof tenantId !== "string" || !tenantPattern.test(tenantId) || !Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(max) || max < 1 || max > 500) return send(response, "INVALID_REQUEST", "Invalid member query");
      return response.json(await listWorkspaceMembers(current.session.claims.sub, tenantId, first, max, state as MemberState | undefined));
    } catch (error) { return failure(error, response); }
  }));
  for (const action of ["_link", "_remove", "_updateEmail"] as const) {
    app.post(`/identity/v1/workspace-members/${action}`, asyncRoute(async (request, response) => {
      if (!hasTrustedWriteOrigin(request)) return send(response, "UNTRUSTED_ORIGIN", "Untrusted request origin");
      try {
        const current = await currentSession(request.headers.cookie);
        if (!current) return send(response, "SESSION_REQUIRED", "An identity session is required");
        const { tenantId, digitUuid, email, reinvite, resend } = request.body || {};
        if (typeof tenantId !== "string" || !tenantPattern.test(tenantId) || typeof digitUuid !== "string" || !uuidPattern.test(digitUuid) ||
            (action !== "_remove" && !validEmail(email)) || (reinvite !== undefined && typeof reinvite !== "boolean") ||
            (resend !== undefined && (action !== "_link" || typeof resend !== "boolean" || (resend && reinvite)))) return send(response, "INVALID_REQUEST", "Invalid workspace member request");
        const actor = current.session.claims.sub;
        if (action === "_remove") return response.json(await removeWorkspaceMember(actor, tenantId, digitUuid));
        if (action === "_updateEmail") return response.status(202).json(await updateWorkspaceMemberEmail(actor, tenantId, digitUuid, email));
        const result = await linkWorkspaceMember({ actor, tenantId, digitUuid, email, reinvite, resend });
        return response.status(result.identityUserCreated ? 201 : 200).json(result);
      } catch (error) { return failure(error, response); }
    }));
  }
  for (const action of ["_accept", "_decline"] as const) {
    app.post(`/identity/v1/workspace-invitations/${action}`, asyncRoute(async (request, response) => {
      if (!hasTrustedWriteOrigin(request)) return send(response, "UNTRUSTED_ORIGIN", "Untrusted request origin");
      const surface = parseSurface(request.query.surface);
      if (!surface || surface === "citizen") return send(response, "UNSUPPORTED_SURFACE", "A staff surface is required");
      try {
        const current = await currentSession(request.headers.cookie, surface);
        if (!current) return send(response, "SESSION_REQUIRED", "An identity session is required");
        const { tenantId, invitationVersion } = request.body || {};
        if (typeof tenantId !== "string" || !tenantPattern.test(tenantId) || !Number.isSafeInteger(invitationVersion) || invitationVersion < 1) return send(response, "INVALID_REQUEST", "Invalid invitation request");
        const respond = action === "_accept" ? acceptWorkspaceInvitation : declineWorkspaceInvitation;
        return response.json(await respond(current.session.claims.sub, tenantId, invitationVersion));
      } catch (error) { return failure(error, response); }
    }));
  }
}
