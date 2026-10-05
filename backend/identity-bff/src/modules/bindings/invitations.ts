import { config } from "../../infrastructure/config.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { bindingsFromUser, effectiveBinding, readBindingUser } from "./store.js";

/**
 * Read-only: an expired invitation is shown as gone without taking the person
 * lease to record its expiry (writers record it under the lease), so
 * `GET /session` never waits on a write.
 */
export async function pendingInvitationsFor(subject: string) {
  const result: Array<{ tenantId: string; invitationVersion: number; name: string; invitedAt: number; expiresAt: number }> = [];
  const now = Date.now();
  for (const binding of bindingsFromUser(await readBindingUser(subject)).map(b => effectiveBinding(b, now))) {
    if (binding.state !== "pending") continue;
    const org = await readOrganizationByTenant(binding.tenantId);
    if (!org?.enabled || (org.lifecycle !== null && org.lifecycle !== "ACTIVE")) continue;
    result.push({ tenantId: binding.tenantId, invitationVersion: binding.invitationVersion,
      name: org.name, invitedAt: binding.createdAt, expiresAt: binding.expiresAt! });
  }
  return result.sort((a, b) => a.invitedAt - b.invitedAt || a.tenantId.localeCompare(b.tenantId));
}

/** A missing/out-of-range master uses 14 days; dependency failures do not. */
export async function invitationExpiryHours(tenantId: string): Promise<number> {
  if (!config.digitMdmsSearchUrl) throw new DigitUnavailableError("Invitation policy lookup is not configured");
  let response: Response;
  try {
    response = await fetch(config.digitMdmsSearchUrl, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RequestInfo: { apiId: "digit-identity-bff" }, MdmsCriteria: {
        tenantId, moduleDetails: [{ moduleName: "identity", masterDetails: [{ name: "invitationPolicy" }] }],
      } }), signal: AbortSignal.timeout(config.digitTimeoutMs) });
  } catch { throw new DigitUnavailableError("Invitation policy lookup failed"); }
  if (!response.ok) throw new DigitUnavailableError("Invitation policy lookup failed");
  const body = await response.json() as { MdmsRes?: { identity?: { invitationPolicy?: Array<{ id?: string; uniqueIdentifier?: string; invitationExpiryHours?: number }> } } };
  const value = body.MdmsRes?.identity?.invitationPolicy?.find((r) => r.id === "default" || r.uniqueIdentifier === "default")?.invitationExpiryHours;
  return Number.isInteger(value) && value! >= 1 && value! <= 2160 ? value! : 336;
}
