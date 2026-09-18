import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import { resetDigitAdminToken } from "../../src/modules/managed-accounts/digit-admin-session.js";
import {
  ensureManagedAccount,
  ManagedAccountError,
  managedIdentity,
  managedUserLogin,
  oneTimePassword,
  revokeManagedUserLogins,
} from "../../src/modules/managed-accounts/managed-account-service.js";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";

const ISSUER = "https://issuer.example/realms/digit";
const fake = createFakeDigitUser({ tenants: ["pg", "pg.citya"] });
let run = 0;

beforeAll(async () => {
  const base = await fake.start();
  Object.assign(config as any, {
    cachePrefix: `managed-test-${process.pid}`,
    digitUserServiceUrl: `${base}/user`,
    digitAdminUsername: "BFF-ADMIN",
    digitAdminPassword: "Adm1n@Secret",
    digitAdminTenantId: "pg",
    digitManagedBaseRoles: ["EMPLOYEE"],
    digitManagedRoleAllowlist: ["EMPLOYEE", "GRO", "PGR_VIEWER"],
    digitTokenRefreshSkewSeconds: 60,
    digitUserLeaseWaitMs: 5000,
    keycloakOrganizationRealm: "managed-unit",
  });
  initCache(`redis://localhost:${process.env.REDIS_PORT || "16379"}`);
  fake.addAccount({
    userName: "BFF-ADMIN", name: "BFF admin", mobileNumber: "0700000000", emailId: null,
    tenantId: "pg", type: "EMPLOYEE", active: true, identificationMark: null,
    roles: [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }], password: "Adm1n@Secret",
  });
});

afterAll(async () => {
  const keys = await getRedis().keys(`${config.cachePrefix}:*`);
  if (keys.length) await getRedis().del(...keys);
  await closeCache();
  await fake.stop();
});

beforeEach(async () => {
  run += 1;
  fake.setTokenTtlSeconds(604800);
  await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: subject(), username: subject(), email: `${subject()}@example.org`,
      firstName: "Managed", lastName: "User", enabled: true, emailVerified: true,
    }),
  });
});

const subject = () => `subject-${run}`;
const profile = {
  name: "Tenant Admin", emailId: "tenant-admin@example.org",
  mobileNumber: "712345678", countryCode: "+254",
};

describe("managed DIGIT accounts", () => {
  it("generates policy-compliant, non-repeating one-time passwords", () => {
    const values = new Set(Array.from({ length: 200 }, () => oneTimePassword()));
    expect(values.size).toBe(200);
    for (const value of values) {
      expect(value).toMatch(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%])\S{15}$/);
    }
  });

  it("creates a marked account, logs in as that user, and never stores the password", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    const adminLogins = fake.stats.adminLogins;
    const result = await ensureManagedAccount(identity, ["GRO"], profile);
    expect(result.created).toBe(true);
    expect(result.account).toMatchObject({
      userName: identity.username, identificationMark: identity.marker, tenantId: "pg", type: "EMPLOYEE",
      mobileNumber: "712345678", countryCode: "+254",
    });
    expect(result.account!.roles.map((role) => `${role.tenantId}:${role.code}`).sort())
      .toEqual(["pg:EMPLOYEE", "pg:GRO"]);

    const login = await managedUserLogin(identity);
    expect(fake.tokens.get(login.accessToken)?.uuid).toBe(result.account!.uuid);
    expect(fake.accounts.get(result.account!.uuid)!.roles.some((role) => role.code === "ACCOUNT_ADMIN")).toBe(false);
    expect(fake.stats.passwordUpdates).toBe(0);

    const stored = await Promise.all((await getRedis().keys(`${config.cachePrefix}:*`))
      .map(async (key) => `${key}=${await getRedis().type(key) === "hash"
        ? JSON.stringify(await getRedis().hgetall(key)) : await getRedis().get(key)}`));
    for (const password of fake.receivedPasswords) {
      expect(stored.join("\n")).not.toContain(password);
    }
    expect(stored.join("\n")).not.toContain("Adm1n@Secret");
    expect(stored.join("\n")).not.toContain("must-not-leak");
    expect(Object.keys(login.user)).not.toContain("password");
    expect(fake.stats.adminLogins - adminLogins).toBeLessThanOrEqual(1);
  });

  it("reuses a cached user token and rotates the password only when it must be regenerated", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    fake.setTokenTtlSeconds(3600);
    await ensureManagedAccount(identity, [], profile);
    const first = await managedUserLogin(identity);
    const second = await managedUserLogin(identity);
    expect(second.accessToken).toBe(first.accessToken);
    const passwordsBefore = fake.receivedPasswords.length;

    fake.expireAllTokens();
    await getRedis().del(`${config.cachePrefix}:digit-user-token:${identity.key}`);
    const rotated = await managedUserLogin(identity);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    expect(fake.receivedPasswords.length).toBe(passwordsBefore + 1);
    expect(new Set(fake.receivedPasswords).size).toBe(fake.receivedPasswords.length);
  });

  it("serializes concurrent regeneration for one user behind the Redis lease", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    await ensureManagedAccount(identity, [], profile);
    fake.expireAllTokens();
    await getRedis().del(`${config.cachePrefix}:digit-user-token:${identity.key}`);
    const rotations = fake.stats.passwordUpdates;
    const logins = await Promise.all(Array.from({ length: 6 }, () => managedUserLogin(identity)));
    expect(new Set(logins.map((login) => login.accessToken)).size).toBe(1);
    expect(fake.stats.passwordUpdates - rotations).toBe(1);
  });

  it("never updates or rotates a legacy account that only shares the username", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    fake.addAccount({
      userName: identity.username, name: "Legacy", mobileNumber: "0711111111", emailId: null,
      tenantId: "pg", type: "EMPLOYEE", active: true, identificationMark: null,
      roles: [{ code: "EMPLOYEE", tenantId: "pg" }], password: "Legacy@1234",
    });
    const updates = fake.stats.updates;
    await expect(ensureManagedAccount(identity, ["GRO"], profile))
      .rejects.toBeInstanceOf(ManagedAccountError);
    await expect(managedUserLogin(identity)).rejects.toBeInstanceOf(ManagedAccountError);
    expect(fake.stats.updates).toBe(updates);
  });

  it("projects role changes, revokes the stale token, and deactivates former members", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg.citya");
    const created = await ensureManagedAccount(identity, [], profile);
    expect(created.account).toMatchObject({ tenantId: "pg.citya", userName: identity.username });
    const before = await managedUserLogin(identity);

    const changed = await ensureManagedAccount(identity, ["GRO", "PGR_VIEWER"]);
    expect(changed.changed).toBe(true);
    expect(fake.tokens.has(before.accessToken)).toBe(false);
    expect(changed.account!.roles.map((role) => `${role.tenantId}:${role.code}`).sort()).toEqual([
      "pg.citya:EMPLOYEE", "pg.citya:GRO", "pg.citya:PGR_VIEWER",
    ]);
    expect((await ensureManagedAccount(identity, ["PGR_VIEWER", "GRO", "NOT_ALLOWED"])).changed).toBe(false);

    const renewed = await managedUserLogin(identity);
    const removed = await ensureManagedAccount(identity, null);
    expect(removed.account!.active).toBe(false);
    expect(fake.tokens.has(renewed.accessToken)).toBe(false);
    await expect(managedUserLogin(identity)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps one account per tenant, each marked with subject and tenant", async () => {
    const id = subject();
    const home = managedIdentity(ISSUER, id, "pg");
    const city = managedIdentity(ISSUER, id, "pg.citya");
    expect(home.username).not.toBe(city.username);
    expect(home.marker.split(":").slice(0, 3)).toEqual(city.marker.split(":").slice(0, 3));
    const first = await ensureManagedAccount(home, [], profile);
    const second = await ensureManagedAccount(city, ["GRO"], profile);
    expect(first.account!.uuid).not.toBe(second.account!.uuid);
    expect(second.account!.roles.every((role) => role.tenantId === "pg.citya")).toBe(true);
  });

  it("requires a mobile number to create an account and does not create without a profile", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    await expect(ensureManagedAccount(identity, [], { name: "No Phone" }))
      .rejects.toBeInstanceOf(ManagedAccountError);
    expect((await ensureManagedAccount(identity, [])).account).toBeNull();
  });

  it("refreshes the cached admin token from environment credentials after DIGIT rejects it", async () => {
    resetDigitAdminToken();
    const identity = managedIdentity(ISSUER, subject(), "pg");
    await ensureManagedAccount(identity, [], profile);
    const adminLogins = fake.stats.adminLogins;
    for (const [token, entry] of fake.tokens) {
      const account = fake.accounts.get(entry.uuid);
      if (account?.roles.some((role) => role.code === "ACCOUNT_ADMIN")) fake.tokens.delete(token);
    }
    await ensureManagedAccount(identity, ["GRO"]);
    expect(fake.stats.adminLogins).toBe(adminLogins + 1);
  });

  it("reports a rejected admin credential as unavailable, not as an account conflict", async () => {
    resetDigitAdminToken();
    (config as any).digitAdminPassword = "Wrong@Pass1";
    const identity = managedIdentity(ISSUER, subject(), "pg");
    await expect(ensureManagedAccount(identity, [], profile))
      .rejects.toMatchObject({ status: 503 });
    (config as any).digitAdminPassword = "Adm1n@Secret";
    resetDigitAdminToken();
  });

  it("logout revokes the user's DIGIT token", async () => {
    const identity = managedIdentity(ISSUER, subject(), "pg");
    await ensureManagedAccount(identity, [], profile);
    const login = await managedUserLogin(identity);
    await revokeManagedUserLogins(ISSUER, identity.subject);
    expect(fake.tokens.has(login.accessToken)).toBe(false);
  });
});
