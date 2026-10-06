import { randomUUID } from "node:crypto";
import type { BoundTenant } from "../authentication/surfaces.js";
import { withPersonLease } from "../accounts/person-lease.js";
import { findVerifiedPhoneUsers, ensurePhoneIdentityUser, IdentityAdminError } from "../organizations/organization-service.js";
import { readUser } from "../../integrations/keycloak/admin-api.js";
import { requireCurrentSession, touchIdentitySession, SessionRevokedError, createPhoneOtpSession } from "../sessions/session-store.js";
import { updateKeycloakUser } from "../sync/keycloak-writer.js";
import { privateRef, type OtpChallenge } from "./otp-store.js";
import { withPhoneLock } from "./phone-lock.js";

export class PhoneProofError extends Error {
  constructor(readonly code: "PHONE_IN_USE" | "IDENTITY_DISABLED" | "OTP_EXPIRED", readonly status: number, message: string) { super(message); }
}
export interface PhoneEffects {
  endPhoneSessions(subject: string, oldPhoneRef: string, keepSessionId?: string): Promise<void>;
  propagateIdentifiers(subject: string): Promise<unknown>;
}
export async function assertPhoneAvailable(phone: string, subject: string): Promise<void> {
  if ((await findVerifiedPhoneUsers(phone)).some(owner => owner.id !== subject)) throw new PhoneProofError("PHONE_IN_USE", 409, "This phone number belongs to another account");
}

/** Proof changes only the bound person; all writes use a fresh read under their lease. */
export async function completePhoneProof(challenge: OtpChallenge, sessionId: string, effects: PhoneEffects): Promise<void> {
  if (!challenge.subject || challenge.sessionRef !== privateRef("session", sessionId) || challenge.purpose === "signin") throw new PhoneProofError("OTP_EXPIRED", 400, "This code belongs to another session");
  const subject = challenge.subject;
  await withPersonLease(subject, async lease => {
    const session = await requireCurrentSession(lease, sessionId);
    if (session.boundTenant?.tenantId !== challenge.tenant.tenantId) throw new PhoneProofError("OTP_EXPIRED", 400, "This code belongs to another tenant");
    await withPhoneLock(challenge.phoneNumber, async lock => {
      await assertPhoneAvailable(challenge.phoneNumber, subject);
      const user = await readUser(subject);
      if (user.enabled === false) throw new PhoneProofError("IDENTITY_DISABLED", 403, "This account is disabled");
      const freshPhone = user.attributes?.phoneNumberVerified?.includes("true") ? user.attributes?.phoneNumber?.[0] : undefined;
      // A stale session cannot overwrite a phone already changed by another session.
      if (freshPhone && session.claims.phone_number_verified && session.claims.phone_number !== freshPhone && freshPhone !== challenge.phoneNumber) throw new SessionRevokedError();
      const oldPhone = session.claims.phone_number || freshPhone;
      await lock.assertHeld();
      await updateKeycloakUser(subject, current => {
        if (current.enabled === false) throw new PhoneProofError("IDENTITY_DISABLED", 403, "This account is disabled");
        return { ...current, attributes: { ...current.attributes, phoneNumber: [challenge.phoneNumber], phoneNumberVerified: ["true"] } };
      });
      await lock.assertHeld();
      // Revocation precedes fallible propagation, so an outage cannot leave old sessions usable.
      if (oldPhone && oldPhone !== challenge.phoneNumber) await effects.endPhoneSessions(subject, privateRef("phone", oldPhone), sessionId);
      const proved = (record: typeof session) => ({ ...record, claims: { ...record.claims, phone_number: challenge.phoneNumber, phone_number_verified: true }, phoneRef: privateRef("phone", challenge.phoneNumber), identityCheckedAt: Date.now() });
      if (!await touchIdentitySession(sessionId, session, proved)) throw new SessionRevokedError();
      await effects.propagateIdentifiers(subject);
      await lock.assertHeld();
    });
  });
}

/** Anonymous creation holds a prospective lease; only the actual owner lease may issue a session. */
export async function phoneSignIn(phone: string, tenant: BoundTenant, nationalNumber: string) {
  let created = false;
  for (let retry = 0; retry < 5; retry += 1) {
    const advisory = await findVerifiedPhoneUsers(phone);
    if (advisory.length > 1) throw new IdentityAdminError("Multiple phone owners", 409);
    const subject = advisory[0]?.id || randomUUID();
    const result = await withPersonLease(subject, async () => withPhoneLock(phone, async lock => {
      const owners = await findVerifiedPhoneUsers(phone);
      if (owners.length > 1) throw new IdentityAdminError("Multiple phone owners", 409);
      if (owners[0]?.id !== subject) {
        if (owners.length) return null;
        await lock.assertHeld();
        const user = await ensurePhoneIdentityUser(phone);
        created ||= user.created;
        await lock.assertHeld();
        return null; // Release bootstrap before taking the real person's lease.
      }
      await lock.assertHeld();
      const user = await ensurePhoneIdentityUser(phone);
      const session = await createPhoneOtpSession({ subject: user.id, name: user.name || nationalNumber, phoneNumber: phone, boundTenant: tenant });
      await lock.assertHeld();
      return { user: { ...user, created }, session };
    }));
    if (result) return result;
  }
  throw new IdentityAdminError("Phone ownership changed; retry", 503);
}
