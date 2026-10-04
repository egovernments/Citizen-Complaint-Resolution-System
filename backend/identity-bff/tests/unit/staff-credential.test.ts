import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";
import { resetDigitAdminToken } from "../../src/modules/managed-accounts/digit-admin-session.js";
import { passwordLogin } from "../../src/modules/managed-accounts/digit-user-client.js";
import { activateStaffCredential, findLiveStaffToken, staffLogin } from "../../src/modules/accounts/credential-service.js";
import { derivedStaffPassword } from "../../src/modules/accounts/credential.js";
import { LeaseLostError, withPersonLease, type PersonLease } from "../../src/modules/accounts/person-lease.js";

const fake = createFakeDigitUser({ tenants: ["pg"] });
const key = Buffer.alloc(32, 0xab);
const { mirror } = vi.hoisted(() => ({ mirror: vi.fn(async () => {}) }));
vi.mock("../../src/modules/sync/mirror.js", () => ({ mirrorPerson: mirror }));
let sequence = 0;
let account: ReturnType<typeof fake.addAccount>;
const ref = () => ({ tenantId: account.tenantId, uuid: account.uuid, userName: account.userName, keyVersion: 1 });
const nativePassword = "Native2@Secret";
const hash = (password: string) => createHash("sha256").update(password).digest("hex");
const run = <T>(fn: (lease: PersonLease) => Promise<T>) => withPersonLease(`credential-subject-${sequence}`, fn);

beforeAll(async () => {
  const url = await fake.start();
  Object.assign(config, {
    cachePrefix: `credential-test-${process.pid}`, digitUserServiceUrl: `${url}/user`,
    digitAdminUsername: "CREDENTIAL-ADMIN", digitAdminPassword: "Test2@Admin", digitAdminTenantId: "pg",
    identityCredentialKeys: new Map([[1, key]]), identityCredentialKeyCurrent: 1,
  });
  initCache(`redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "16385"}`);
  fake.addAccount({ userName: "CREDENTIAL-ADMIN", name: "Admin", mobileNumber: "700000000", emailId: null,
    tenantId: "pg", type: "EMPLOYEE", active: true, identificationMark: null,
    roles: [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }], password: "Test2@Admin" });
});
beforeEach(() => {
  sequence += 1;
  resetDigitAdminToken();
  Object.assign(config, { identityStaffCredentialMode: "derived", identityCredentialKeyCurrent: 1,
    identityCredentialKeys: new Map([[1, key]]) });
  mirror.mockClear();
  account = fake.addAccount({ userName: `staff-${sequence}`, name: "Staff Member", mobileNumber: "712345678",
    emailId: "staff@example.org", tenantId: "pg", type: "EMPLOYEE", active: true, identificationMark: null,
    roles: [{ code: "EMPLOYEE", tenantId: "pg" }], password: nativePassword, gender: "FEMALE", pan: "TESTPAN" });
});
afterAll(async () => {
  const keys = await getRedis().keys(`${config.cachePrefix}:*`);
  if (keys.length) await getRedis().del(...keys);
  await closeCache();
  await fake.stop();
});

describe("derived staff credentials", () => {
  it("activation logs out the existing native token once before issuing a fresh token", async () => {
    const native = await passwordLogin({ username: account.userName, tenantId: "pg", userType: "EMPLOYEE", password: nativePassword });
    const logouts = fake.stats.logouts;
    const writes = fake.stats.passwordUpdates;
    const login = await run((lease) => staffLogin({ ...ref(), keyVersion: undefined }, lease));
    expect(fake.tokens.has(native.accessToken)).toBe(false);
    expect(login.accessToken).not.toBe(native.accessToken);
    expect(fake.tokens.has(login.accessToken)).toBe(true);
    expect(fake.stats.logouts - logouts).toBe(1);
    expect(fake.stats.passwordUpdates - writes).toBe(1);
    expect(account.passwordHash).toBe(hash(derivedStaffPassword(key, account.uuid, "pg")));
    expect(mirror).toHaveBeenCalledWith(`credential-subject-${sequence}`, { credential: {
      tenantId: "pg", keyVersion: 1, setAt: expect.any(Number),
    } });
    expect(account.pan).toBe("TESTPAN");
    expect(account.gender).toBe("FEMALE");
  });
  it("an out-of-band password change gets exactly one repair per lease object", async () => {
    const writes = fake.stats.passwordUpdates;
    await run(async (lease) => {
      await staffLogin(ref(), lease);
      account.passwordHash = hash("out-of-band-change");
      await expect(staffLogin(ref(), lease)).rejects.toMatchObject({ reason: "INVALID_CREDENTIALS" });
    });
    expect(fake.stats.passwordUpdates - writes).toBe(1);
    await run((lease) => staffLogin(ref(), lease));
    expect(fake.stats.passwordUpdates - writes).toBe(2);
  });
  it.each([
    ["accountLocked", true, "ACCOUNT_LOCKED"], ["active", false, "DIGIT_ACCOUNT_INACTIVE"],
  ] as const)("%s refusal never repairs and exposes %s", async (field, value, code) => {
    account[field] = value;
    const writes = fake.stats.passwordUpdates;
    await expect(run((lease) => staffLogin(ref(), lease))).rejects.toMatchObject({ code });
    await expect(run((lease) => activateStaffCredential(ref(), lease))).rejects.toMatchObject({ code });
    expect(fake.stats.passwordUpdates).toBe(writes);
    expect(await findLiveStaffToken(ref())).toBeNull();
  });
  it("masked copied fields prevent activation and return DIGIT_PII_MASKED", async () => {
    account.name = "***masked***";
    const writes = fake.stats.passwordUpdates;
    await expect(run((lease) => activateStaffCredential(ref(), lease))).rejects.toMatchObject({ code: "DIGIT_PII_MASKED" });
    expect(fake.stats.passwordUpdates).toBe(writes);
  });
  it("a failed mirror is logged without rolling back successful activation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mirror.mockRejectedValueOnce(new Error("sensitive provider text"));
    expect(await run((lease) => activateStaffCredential(ref(), lease))).toEqual({ keyVersion: 1 });
    expect(account.passwordHash).toBe(hash(derivedStaffPassword(key, account.uuid, "pg")));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("sensitive provider text");
    warn.mockRestore();
  });
  it("finds only the recorded key without repairing or probing retired versions", async () => {
    await run((lease) => activateStaffCredential(ref(), lease));
    const writes = fake.stats.passwordUpdates;
    const token = await findLiveStaffToken(ref());
    expect(token?.accessToken).toBeTruthy();
    const logins = fake.stats.userLogins;
    expect(await findLiveStaffToken({ ...ref(), keyVersion: 99 })).toBeNull();
    expect(await findLiveStaffToken({ ...ref(), keyVersion: undefined })).toBeNull();
    expect(fake.stats.userLogins).toBe(logins);
    account.passwordHash = hash("out-of-band-change");
    expect(await findLiveStaffToken(ref())).toBeNull();
    expect(fake.stats.passwordUpdates).toBe(writes);
  });
  it("adopts the current key first on rollover, including a retired recorded key", async () => {
    const writes = fake.stats.passwordUpdates;
    Object.assign(config, { identityCredentialKeys: new Map([[2, Buffer.alloc(32, 0xcd)]]), identityCredentialKeyCurrent: 2 });
    const result = await run((lease) => staffLogin(ref(), lease));
    expect(result.keyVersion).toBe(2);
    expect(fake.stats.passwordUpdates - writes).toBe(1);
    expect(account.passwordHash).toBe(hash(derivedStaffPassword(Buffer.alloc(32, 0xcd), account.uuid, "pg")));
  });
  it("supports derived → rotate → derived without a stored plaintext credential", async () => {
    await run((lease) => staffLogin({ ...ref(), keyVersion: undefined }, lease));
    const derivedHash = account.passwordHash;
    config.identityStaffCredentialMode = "rotate";
    const rotated = await run((lease) => staffLogin(ref(), lease));
    expect(rotated).not.toHaveProperty("keyVersion");
    expect(account.passwordHash).not.toBe(derivedHash);
    expect(await findLiveStaffToken(ref())).toBeNull();
    await expect(run((lease) => activateStaffCredential(ref(), lease))).rejects.toMatchObject({ reason: "DEPENDENCY" });
    config.identityStaffCredentialMode = "derived";
    expect((await run((lease) => staffLogin(ref(), lease))).keyVersion).toBe(1);
    expect(account.passwordHash).toBe(derivedHash);
    for (const storedKey of await getRedis().keys(`${config.cachePrefix}:*`)) {
      expect(await getRedis().get(storedKey)).not.toContain(derivedStaffPassword(key, account.uuid, "pg"));
    }
  });
  it("revokes a token if the lease is lost immediately after minting", async () => {
    account.passwordHash = hash(derivedStaffPassword(key, account.uuid, "pg"));
    const logouts = fake.stats.logouts;
    const lease: PersonLease = { subject: "lost", token: "lease", fencedSet: async () => false,
      assertHeld: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new LeaseLostError()) };
    await expect(staffLogin(ref(), lease)).rejects.toBeInstanceOf(LeaseLostError);
    expect(fake.stats.logouts - logouts).toBe(1);
    expect([...fake.tokens.values()].filter((entry) => entry.uuid === account.uuid)).toHaveLength(0);
  });
});
