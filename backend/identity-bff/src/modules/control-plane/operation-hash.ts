import { createHash } from "node:crypto";

/**
 * Canonical payload hash for `organizations/_ensure` (design §5, D25/A6).
 *
 * The BFF stores it on the Organization as `digit.operationHash`. A repeat call
 * with the same operationId and restartNo must carry the same hash, otherwise
 * it gets 409 OPERATION_CONFLICT.
 *
 * Only the fields that describe the Organization are hashed. operationId and
 * restartNo identify the attempt and are compared separately.
 *
 * Normalization, in this order:
 * - tenantId: trimmed. Case is kept (DIGIT tenant ids are case-sensitive).
 * - slug: trimmed, lower-cased.
 * - name: Unicode NFC, trimmed, every run of whitespace replaced by one space.
 *
 * Canonical form: a JSON object with keys in code-point order, no whitespace,
 * strings escaped as JSON.stringify does. For an object of plain strings and
 * one integer this is identical to RFC 8785 (JCS).
 *
 * Hash: lower-case hex SHA-256 of the UTF-8 canonical form.
 */

export interface OrganizationEnsurePayload {
  tenantId: string;
  slug: string;
  name: string;
}

export function normalizeOrganizationPayload(payload: OrganizationEnsurePayload): OrganizationEnsurePayload {
  return {
    tenantId: payload.tenantId.trim(),
    slug: payload.slug.trim().toLowerCase(),
    name: payload.name.normalize("NFC").trim().replace(/\s+/gu, " "),
  };
}

export function canonicalOrganizationPayload(payload: OrganizationEnsurePayload): string {
  const normalized = normalizeOrganizationPayload(payload);
  const document: Record<string, string | number> = {
    name: normalized.name,
    slug: normalized.slug,
    tenantId: normalized.tenantId,
    v: 1,
  };
  const keys = Object.keys(document).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(document[key])}`).join(",")}}`;
}

export function organizationOperationHash(payload: OrganizationEnsurePayload): string {
  return createHash("sha256").update(canonicalOrganizationPayload(payload), "utf8").digest("hex");
}
