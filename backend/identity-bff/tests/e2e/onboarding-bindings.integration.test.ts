import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, initCache } from "../../src/infrastructure/redis.js";
import { readBindings, remove } from "../../src/modules/bindings/store.js";
import { onboardingDependencies } from "../../src/modules/onboarding/production.js";
import { createIdentitySession, getIdentitySession, saveSelectedIdentityContext } from "../../src/modules/sessions/session-store.js";
import { onboardingAuthorization, registerOnboardingRoutes } from "../../src/modules/onboarding/routes.js";
import { clearTenantCaches } from "../../src/modules/access-context/tenant-directory.js";
import { resolveTenantOptions } from "../../src/modules/access-context/tenant-options.js";
import { staffAccess } from "../../src/modules/bindings/predicate.js";
import type { KeycloakClaims } from "../../src/modules/authentication/types.js";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";

const digitTenants = ["workspace"];
const digit = createFakeDigitUser({ tenants: digitTenants });
let server: Server, base: string;
const attempt = { operationId: "operation", restartNo: 0, tenantId: "workspace", slug: "workspace", name: "Workspace" };
let subject: string, uuid: string;
const post = (path: string, body: unknown) => fetch(`${base}/internal/identity/v1/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-onboarding" }, body: JSON.stringify(body),
});
async function person() {
  const id = randomUUID();
  const response = await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, username: id, email: `${id}@example.test`, emailVerified: true, enabled: true }),
  });
  expect(response.status).toBe(201);
  return id;
}
function employee() {
  return digit.addAccount({ userName: randomUUID(), name: "Founder", tenantId: "workspace", type: "EMPLOYEE",
    active: true, mobileNumber: "9812345678", emailId: "founder@example.test", identificationMark: null,
    roles: [{ code: "ACCOUNT_ADMIN", tenantId: "workspace" }, { code: "SUPERUSER", tenantId: "workspace" }], password: "Orig1nal@Test" });
}
beforeAll(async () => {
  const digitBase = await digit.start();
  digit.addAccount({ userName: "BFF-ADMIN", name: "Admin", tenantId: "workspace", type: "EMPLOYEE", active: true,
    mobileNumber: "9812345670", emailId: null, identificationMark: null,
    roles: [{ code: "ACCOUNT_ADMIN", tenantId: "workspace" }], password: "Adm1n@Test" });
  Object.assign(config, { digitUserServiceUrl: `${digitBase}/user`, digitMdmsSearchUrl: `${digitBase}/mdms-v2/v1/_search`,
    digitAdminUsername: "BFF-ADMIN", digitAdminPassword: "Adm1n@Test", digitAdminTenantId: "workspace", identityOnboardingToken: "test-onboarding" });
  initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16389}`);
  const app = express();
  app.use(express.json());
  app.use("/internal/identity/v1", (req, res, next) => { if (onboardingAuthorization(req, res) === true) next(); });
  registerOnboardingRoutes(app, onboardingDependencies);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  config.cachePrefix = `onboarding-bindings-${randomUUID()}`;
  config.keycloakOrganizationRealm = `onboarding-bindings-${randomUUID()}`;
  clearTenantCaches();
  subject = await person();
  uuid = employee().uuid;
  expect((await post("organizations/_ensure", attempt)).status).toBe(200);
  expect((await post("memberships/_ensure", { ...attempt, subject })).status).toBe(200);
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await closeCache(); await digit.stop(); });

describe("onboarding routes with real core binding and revocation providers", () => {
  it("reuses the founder binding and defers all credential writes", async () => {
    const updates = digit.stats.passwordUpdates;
    const creates = digit.stats.creates;
    const input = { ...attempt, subject, digitUuid: uuid };
    const first = await post("bindings/_ensure", input);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({ created: true, binding: { subject, tenantId: "workspace", digitUuid: uuid, state: "active", boundAt: expect.any(Number) } });
    const repeat = await post("bindings/_ensure", input);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ ...body, created: false });
    expect(await readBindings(subject)).toMatchObject([{ uuid, state: "active", createdBy: { kind: "workload", operationId: "operation", restartNo: 0 } }]);
    expect(digit.stats.passwordUpdates).toBe(updates);
    expect(digit.stats.creates).toBe(creates);
    const changed = await post("bindings/_ensure", { ...input, digitUuid: employee().uuid });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "BINDING_CONFLICT" });
  });
  it("keeps one UUID owner when two workload calls race", async () => {
    const second = await person();
    await post("memberships/_ensure", { ...attempt, subject: second });
    const responses = await Promise.all([subject, second].map((person) => post("bindings/_ensure", { ...attempt, subject: person, digitUuid: uuid })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({ code: "DIGIT_ACCOUNT_LINKED_ELSEWHERE" });
  });
  it("never resurrects a removed founder binding", async () => {
    const input = { ...attempt, subject, digitUuid: uuid };
    expect((await post("bindings/_ensure", input)).status).toBe(200);
    await remove({ subject, tenantId: "workspace", uuid, removedBy: { kind: "operator" } });
    const response = await post("bindings/_ensure", input);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "BINDING_CONFLICT" });
    expect(await readBindings(subject)).toMatchObject([{ state: "removed" }]);
  });
  it("lists and selects a tenant that reached MDMS after its root was cached (#2303)", async () => {
    expect((await post("bindings/_ensure", { ...attempt, subject, digitUuid: uuid })).status).toBe(200);
    expect((await post("organizations/_lifecycle", { ...attempt, state: "ACTIVE" })).status).toBe(200);
    const claims = { sub: subject } as KeycloakClaims;
    // The root is looked up (and cached) while the tenant record is not visible yet.
    digitTenants.splice(0);
    try {
      expect(await resolveTenantOptions(claims, true)).toEqual([]);
      expect(await staffAccess(subject, "workspace")).toMatchObject({ allowed: false, denial: "TENANT_INACTIVE" });
    } finally { digitTenants.push("workspace"); }
    // Provisioning finishes a few seconds later; nothing waits out the 5-minute TTL.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 6_000);
      expect((await resolveTenantOptions(claims, true)).map((option) => option.tenantId)).toEqual(["workspace"]);
      clearTenantCaches(); digitTenants.splice(0);
      expect(await staffAccess(subject, "workspace")).toMatchObject({ allowed: false, denial: "TENANT_INACTIVE" });
      digitTenants.push("workspace");
      vi.setSystemTime(Date.now() + 6_000);
      expect(await staffAccess(subject, "workspace")).toMatchObject({ allowed: true, via: "binding" });
    } finally { vi.useRealTimers(); }
  });
  it("revokes selected member sessions on FAILED and repairs publication on repeats", async () => {
    expect((await post("bindings/_ensure", { ...attempt, subject, digitUuid: uuid })).status).toBe(200);
    async function selectedSession() {
      const { sessionId } = await createIdentitySession({ accessToken: "fixture-kc-token", accessExpiresIn: 600, refreshExpiresIn: 3600 },
        { sub: subject, email: "founder@example.test" }, "fixture-client");
      await saveSelectedIdentityContext(sessionId, { tenantId: "workspace", digitUuid: uuid, accountType: "staff" } as any);
      return sessionId;
    }
    const first = await selectedSession();
    expect((await post("organizations/_lifecycle", { ...attempt, state: "FAILED" })).status).toBe(200);
    expect(await getIdentitySession(first)).toBeNull();
    const retry = await selectedSession();
    expect((await post("organizations/_lifecycle", { ...attempt, state: "FAILED" })).status).toBe(200);
    expect(await getIdentitySession(retry)).toBeNull();
  });
});
