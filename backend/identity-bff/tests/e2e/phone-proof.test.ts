import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { getRedis, closeCache, initCache } from "../../src/infrastructure/redis.js";
import { createPhoneOtpSession, createIdentitySession, getIdentitySession } from "../../src/modules/sessions/session-store.js";
import { completePhoneProof, phoneSignIn } from "../../src/modules/citizen-otp/phone-service.js";
import { createChallenge, privateRef, readChallenge } from "../../src/modules/citizen-otp/otp-store.js";
import { endPhoneSessions } from "../../src/modules/revocation/index.js";
import { currentPersonLease, personLeaseKey } from "../../src/modules/accounts/person-lease.js";
const saved = { ...config };
const prefix = `phone-proof-${process.pid}`;
const tenant = { urlSlug: "county", tenantId: "ke", rootTenantId: "ke", name: "County" };
const phone = "+254712345678";
const user = (subject: string, attributes = {}) => fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: subject, username: subject, enabled: true, attributes }) });
const readUser = async (subject: string) => (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${subject}`)).json();
const effects = { endPhoneSessions, propagateIdentifiers: vi.fn().mockResolvedValue({ written: 1 }) };
beforeAll(() => { Object.assign(config, { cachePrefix: prefix, keycloakOrganizationRealm: "phone-proof", identityCitizenOtpSecret: "test-proof-secret" }); initCache(`redis://localhost:${process.env.REDIS_PORT || 16379}`); });
afterAll(async () => { const keys = await getRedis().keys(`${prefix}:*`); if (keys.length) await getRedis().del(...keys); await closeCache(); Object.assign(config, saved); });
describe("phone ownership and proof", () => {
  it("concurrent first-time sign-ins create one opaque identity with a national default name", async () => {
    const bootstrapSubjects: string[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).endsWith("/users") && init?.method === "POST") {
        expect(currentPersonLease()).not.toBeNull();
        bootstrapSubjects.push(currentPersonLease()!.subject);
      }
      return realFetch(input, init);
    });
    const results = await Promise.all([phoneSignIn(phone, tenant, "712345678"), phoneSignIn(phone, tenant, "712345678")])
      .finally(() => spy.mockRestore());
    expect(results[0].user.id).toBe(results[1].user.id);
    expect(bootstrapSubjects).toHaveLength(1);
    expect(bootstrapSubjects).not.toContain(results[0].user.id);
    expect(await getRedis().exists(personLeaseKey(bootstrapSubjects[0]))).toBe(0);
    const stored = await readUser(results[0].user.id);
    expect(stored.username).toMatch(/^phone-[0-9a-f-]{36}$/);
    expect((await getIdentitySession(results[0].session.sessionId))?.claims.name).toBe("712345678");
  });
  it("binds stored proof to purpose/person/session and serializes two people claiming a phone", async () => {
    const target = "+254722345678";
    const proofs = await Promise.all(["claimant-one", "claimant-two"].map(async subject => {
      await user(subject);
      const { sessionId } = await createIdentitySession({ accessToken: "test", accessExpiresIn: 600 }, { sub: subject, email: "" }, config.keycloakCitizenClientId, { surface: "citizen", boundTenant: tenant });
      const { challenge } = await createChallenge(target, tenant, { purpose: "stepup", subject, sessionRef: privateRef("session", sessionId) });
      expect(await readChallenge(challenge.id)).toEqual(challenge);
      return { sessionId, challenge };
    }));
    const outcomes = await Promise.allSettled(proofs.map(item => completePhoneProof(item.challenge, item.sessionId, effects)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "PHONE_IN_USE" } });
    await expect(completePhoneProof(proofs[0].challenge, proofs[1].sessionId, effects)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });
  it("changes the phone, ends old sessions, preserves the initiating session, and releases the number", async () => {
    const subject = "changing-person";
    const oldPhone = "+254733345678", newPhone = "+254744345678";
    await user(subject, { phoneNumber: [oldPhone], phoneNumberVerified: ["true"] });
    const initial = await createPhoneOtpSession({ subject, name: "Person", phoneNumber: oldPhone, boundTenant: tenant });
    const other = await createPhoneOtpSession({ subject, name: "Person", phoneNumber: oldPhone, boundTenant: tenant });
    const { challenge } = await createChallenge(newPhone, tenant, { purpose: "change_phone", subject, sessionRef: privateRef("session", initial.sessionId) });
    await completePhoneProof(challenge, initial.sessionId, effects);
    expect((await readUser(subject)).attributes.phoneNumber).toEqual([newPhone]);
    expect((await getIdentitySession(initial.sessionId))?.claims.phone_number).toBe(newPhone);
    expect(await getIdentitySession(other.sessionId)).toBeNull();
    const released = await phoneSignIn(oldPhone, tenant, "733345678");
    expect(released.user.id).not.toBe(subject);
    await expect(completePhoneProof({ ...challenge, sessionRef: privateRef("session", other.sessionId) }, other.sessionId, effects)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    expect(effects.propagateIdentifiers).toHaveBeenCalledWith(subject);
  });

  it("serializes changes from old-phone sessions so the loser cannot overwrite the winner", async () => {
    const subject = "racing-change-person", oldPhone = "+254755345678";
    await user(subject, { phoneNumber: [oldPhone], phoneNumberVerified: ["true"] });
    const proofs = await Promise.all(["+254766345678", "+254777345678"].map(async phoneNumber => {
      const { sessionId } = await createPhoneOtpSession({ subject, name: "Person", phoneNumber: oldPhone, boundTenant: tenant });
      const { challenge } = await createChallenge(phoneNumber, tenant, {
        purpose: "change_phone", subject, sessionRef: privateRef("session", sessionId),
      });
      return { sessionId, challenge };
    }));
    const results = await Promise.allSettled(proofs.map(proof => completePhoneProof(proof.challenge, proof.sessionId, effects)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "SESSION_REVOKED" } });
    const winner = proofs[results.findIndex(result => result.status === "fulfilled")];
    expect((await readUser(subject)).attributes.phoneNumber).toEqual([winner.challenge.phoneNumber]);
    expect((await getIdentitySession(winner.sessionId))?.claims.phone_number).toBe(winner.challenge.phoneNumber);
  });
});
