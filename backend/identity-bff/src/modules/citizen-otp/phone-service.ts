import { randomUUID } from "node:crypto";
import type { BoundTenant } from "../authentication/surfaces.js";
import { withPersonLease } from "../accounts/person-lease.js";
import { staffAccess } from "../bindings/predicate.js";
import { ownersOf } from "../bindings/store.js";
import { BindingError } from "../bindings/types.js";
import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { DigitUnavailableError, searchAccounts } from "../managed-accounts/digit-user-client.js";
import { OnboardingError } from "../onboarding/errors.js";
import { findVerifiedPhoneUsers, ensurePhoneIdentityUser, IdentityAdminError, phoneIdentityUser } from "../organizations/organization-service.js";
import { config } from "../../infrastructure/config.js";
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

/**
 * The staff person a sign-in with a number nobody has proved yet really is (#2595): the one person
 * actively bound, at this tenant, to the one active employee record carrying the number, while they
 * may still use the tenant and have proved no phone of their own. The code proves the number and the
 * record says whose it is. Anything missing or ambiguous gives null, and the number gets its own
 * phone identity as before.
 */
async function staffPhoneOwner(tenantId: string, mobileNumber: string): Promise<string | null> {
  try {
    const employees = (await withDigitAdmin(token => searchAccounts(token, { tenantId, userType: "EMPLOYEE", active: true, mobileNumber })))
      .filter(account => account.type === "EMPLOYEE" && account.active && account.tenantId === tenantId);
    if (employees.length !== 1) return null;
    const owners = await ownersOf(tenantId, employees[0].uuid);
    if (owners.length !== 1) return null;
    const access = await staffAccess(owners[0], tenantId);
    if (!access.allowed || access.binding?.uuid !== employees[0].uuid) return null;
    return (await readUser(owners[0])).attributes?.phoneNumberVerified?.includes("true") ? null : owners[0];
  } catch (error) {
    // A failed lookup is an outage, never "no staff owner": null would split the person for good.
    if (error instanceof BindingError || error instanceof OnboardingError || error instanceof DigitUnavailableError) {
      throw new IdentityAdminError(`Employee lookup failed: ${error.message}`);
    }
    throw error;
  }
}

/** One line at startup says whether an employee's own number joins their staff identity (#2595). */
export function logStaffPhoneJoinMode(): void {
  console.info(JSON.stringify({ identity: "identity.citizen_otp.staff_phone_join", enabled: config.identityStaffPhoneJoin }));
}

/** Anonymous creation holds a prospective lease; only the actual owner lease may issue a session. */
export async function phoneSignIn(phone: string, tenant: BoundTenant, nationalNumber: string) {
  let created = false;
  for (let retry = 0; retry < 5; retry += 1) {
    const advisory = await findVerifiedPhoneUsers(phone);
    if (advisory.length > 1) throw new IdentityAdminError("Multiple phone owners", 409);
    // Off by default (IDENTITY_STAFF_PHONE_JOIN): the number then gets its own identity, with no DIGIT call.
    const staff = advisory.length || !config.identityStaffPhoneJoin ? null : await staffPhoneOwner(tenant.tenantId, nationalNumber);
    const subject = advisory[0]?.id || staff || randomUUID();
    const result = await withPersonLease(subject, async () => withPhoneLock(phone, async lock => {
      const owners = await findVerifiedPhoneUsers(phone);
      if (owners.length > 1) throw new IdentityAdminError("Multiple phone owners", 409);
      const staffProved = !owners.length && subject === staff && await staffPhoneOwner(tenant.tenantId, nationalNumber) === subject;
      if (owners[0]?.id !== subject && !staffProved) {
        if (owners.length) return null;
        await lock.assertHeld();
        const user = await ensurePhoneIdentityUser(phone);
        created ||= user.created;
        await lock.assertHeld();
        return null; // Release bootstrap before taking the real person's lease.
      }
      await lock.assertHeld();
      // The staff person keeps their own identity and now holds the number they proved.
      if (staffProved) {
        await updateKeycloakUser(subject, current => ({ ...current, attributes: { ...current.attributes, phoneNumber: [phone], phoneNumberVerified: ["true"] } }));
        await lock.assertHeld();
      }
      // The staff person is the user just written: a search could miss that write and create a new one.
      const user = staffProved ? phoneIdentityUser(await readUser(subject), false) : await ensurePhoneIdentityUser(phone);
      if (user.id !== subject) throw new IdentityAdminError("Phone ownership changed; retry", 503);
      const session = await createPhoneOtpSession({ subject: user.id, name: user.name || nationalNumber, phoneNumber: phone, boundTenant: tenant });
      await lock.assertHeld();
      return { user: { ...user, created, staffProved }, session };
    }));
    if (result) return result;
  }
  throw new IdentityAdminError("Phone ownership changed; retry", 503);
}
