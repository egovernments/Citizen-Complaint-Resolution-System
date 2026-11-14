import { withPersonLease } from "../accounts/person-lease.js";
import { writeDigitIdentifiers } from "../accounts/digit-writer.js";
import { readBindings } from "../bindings/store.js";
import { findUser, readUser } from "../../integrations/keycloak/admin-api.js";
import { splitE164 } from "../citizens/citizen-registration.js";
import { mobileValidationForRoute } from "../citizen-otp/mobile-validation.js";
import { keycloakPhoneIsAdminControlled } from "../organizations/organization-service.js";
import { accountEntries } from "./state.js";

export interface PropagationResult { written: number; unchanged: number; skipped: number }

/** D18 verified email applies to staff; verified phone applies to citizens only. */
export function propagateIdentifiers(subject: string): Promise<PropagationResult> {
  return withPersonLease(subject, async lease => {
    await lease.assertHeld();
    const bindings = await readBindings(subject);
    const user = await readUser(subject);
    const result: PropagationResult = { written: 0, unchanged: 0, skipped: 0 };
    const email = user.emailVerified === true && user.email?.trim() && !/\*{2,}/.test(user.email)
      ? user.email.trim() : undefined;
    const phoneValues = user.attributes?.phoneNumber;
    const verifiedPhone = user.attributes?.phoneNumberVerified?.length === 1 &&
      user.attributes.phoneNumberVerified[0] === "true" && phoneValues?.length === 1 ? phoneValues[0] : undefined;
    const entries = accountEntries(user);
    // Only a phone users cannot edit in Keycloak, so one a BFF code or an
    // admin put there, reaches a citizen account: pgr-services attaches an
    // employee-filed complaint to the one BFF-created citizen holding the
    // number (#2640). Elsewhere a proved number arrives at the next phone-OTP
    // `_select`.
    const phone = verifiedPhone && entries.some(entry => entry.kind === "citizen") &&
      await keycloakPhoneIsAdminControlled() ? verifiedPhone : undefined;
    const targets = [
      ...bindings.filter(binding => binding.state === "active").map(binding => ({ ...binding, kind: "staff" as const })),
      ...entries.filter(entry => entry.kind === "citizen"),
    ];
    for (const target of targets) {
      if (entries.some(entry => entry.uuid === target.uuid && entry.tenantId === target.tenantId && entry.missing)) {
        result.skipped++;
        continue;
      }
      let patch: { emailId?: string; mobileNumber?: string; countryCode?: string };
      if (target.kind === "staff" && email) patch = { emailId: email };
      else if (target.kind === "citizen" && phone) {
        const rule = await mobileValidationForRoute({ tenantId: target.tenantId, rootTenantId: target.tenantId,
          urlSlug: target.tenantId, parentTenantId: null, fallbackTenantIds: [], name: target.tenantId });
        const split = rule ? splitE164(phone, rule) : null;
        if (!split) { result.skipped++; continue; }
        patch = split;
      } else { result.skipped++; continue; }
      await lease.assertHeld();
      const write = await writeDigitIdentifiers(target, patch);
      await lease.assertHeld();
      if (write.status === "written") result.written++;
      else if (write.status === "unchanged") result.unchanged++;
      else result.skipped++;
    }
    return result;
  });
}

/**
 * Poller compatibility: failure keeps the event retryable; reconcile retries skips.
 * A person Keycloak no longer has is done, not retryable: their own DELETE event
 * revokes them, and an UPDATE recorded just before the delete (an Organization
 * removal rewrites its members) would otherwise 404 forever, stall the poller
 * and take /readyz down with it.
 */
export async function propagateVerifiedIdentifiers(subject: string): Promise<void> {
  if (!await findUser(subject)) return;
  await propagateIdentifiers(subject);
}
