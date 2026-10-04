import { createHash } from "node:crypto";

/**
 * The resume key of `workspace-members/_link` (design §5 step 4, D25/A4).
 *
 *   requestId = hex(SHA-256("link-v1\n" + actor + "\n" + tenantId + "\n" + digitUuid + "\n" + email))
 *
 * - actor: the Keycloak subject of the ACCOUNT_ADMIN calling `_link`;
 * - email: trimmed and lower-cased, the same way `_link` normalizes it.
 *
 * It is derived, so a client retry of the same link resumes without sending any
 * idempotency header. It is stored in `digit.linkPending.requestId` and in the
 * binding's `createdBy.requestId`.
 */
export function normalizeLinkEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function linkRequestId(actor: string, tenantId: string, digitUuid: string, email: string): string {
  const fields = [actor, tenantId, digitUuid, normalizeLinkEmail(email)];
  for (const value of fields) {
    if (!value || /[\r\n]/.test(value)) throw new Error("link request fields must be non-empty and single-line");
  }
  return createHash("sha256").update(["link-v1", ...fields].join("\n"), "utf8").digest("hex");
}
