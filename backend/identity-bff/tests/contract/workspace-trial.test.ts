import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";
import { config } from "../../src/infrastructure/config.js";
import { resetIdentityMethodCatalog } from "../../src/modules/authentication/methods.js";
import { ensureActive } from "../../src/modules/bindings/store.js";
import { managedIdentity } from "../../src/modules/managed-accounts/managed-account-service.js";
import { otpSender, setOtpSender, type OtpMessage } from "../../src/modules/citizen-otp/otp-sender.js";
import * as organizationService from "../../src/modules/organizations/organization-service.js";
import { clearTenantMappingCache, ensureOrganizationMembership, IdentityAdminError } from "../../src/modules/organizations/organization-service.js";
import { createIdentitySession } from "../../src/modules/sessions/session-store.js";
import { mirrorPerson } from "../../src/modules/sync/mirror.js";
import { TRIAL_ATTRIBUTES } from "../../src/modules/workspace-trial/trial.js";
import { getIdentityAppPort, startIdentityTestApp, stopIdentityTestApp } from "../e2e/identity-test-app.js";
import { contractRoute, expectContractError } from "./harness.js";

// Workspace trial lock at every sign-in gate. `acme`'s trial ended; `bravo`'s
// ended too but was approved, so it must pass every gate; `charlie` has no
// trial, like every workspace that predates trials. The real app runs over the
// Keycloak Admin mock (in a realm of its own), a fake DIGIT and Redis.

const TRUSTED = "http://localhost:5173";
const ENDED = "2020-01-01T00:00:00.000Z";
const digit = createFakeDigitUser({ tenants: ["acme", "bravo", "charlie"] });
const sent: OtpMessage[] = [];
const originalSender = otpSender();
const saved: Record<string, unknown> = {};
let base = "";

const OPS = "ops-contract-token";
const routes = {
  list: contractRoute("GET", "/internal/identity/v1/workspace-trials"),
  approve: contractRoute("POST", "/internal/identity/v1/workspace-trials/_approve"),
  extend: contractRoute("POST", "/internal/identity/v1/workspace-trials/_extend"),
  tenants: contractRoute("GET", "/identity/v1/tenants"),
  context: contractRoute("GET", "/identity/v1/tenant-contexts/:urlSlug"),
  select: contractRoute("POST", "/identity/v1/contexts/_select"),
  citizenSelect: contractRoute("POST", "/identity/v1/contexts/citizen/_select"),
  send: contractRoute("POST", "/identity/v1/citizen/otp/_send"),
  verify: contractRoute("POST", "/identity/v1/citizen/otp/_verify"),
};

const kc = (method: string, path: string, body: unknown) => fetch(
  `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}${path}`,
  { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
);
const get = (path: string, cookie = "") => fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, body: unknown, cookie = "") => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: TRUSTED, ...(cookie && { Cookie: cookie }) },
  body: JSON.stringify(body),
});
const tenantOf = (slug: string) => ({ tenantId: slug, rootTenantId: slug, urlSlug: slug, name: `${slug} workspace` });

/** An ACTIVE workspace with a founder who is a member with an active binding to a DIGIT employee. */
async function workspace(slug: string, trial: Record<string, string[]>) {
  expect((await kc("POST", "/organizations", { id: `org-${slug}`, alias: slug, name: `${slug} workspace`, enabled: true,
    attributes: { "digit.rootTenantId": [slug], "digit.urlSlug": [slug], "digit.lifecycle": ["ACTIVE"], ...trial } })).status).toBe(201);
  const subject = `founder-${slug}`;
  expect((await kc("POST", "/users", { id: subject, username: subject, email: `${subject}@example.test`, emailVerified: true, enabled: true })).status)
    .toBe(201);
  const account = digit.addAccount({ userName: `FOUNDER-${slug.toUpperCase()}`, name: "Founder", mobileNumber: "712000001",
    emailId: null, tenantId: slug, type: "EMPLOYEE", active: true, identificationMark: null, password: "Founder@123",
    roles: ["EMPLOYEE", "ACCOUNT_ADMIN"].map((code) => ({ code, tenantId: slug })) });
  await ensureActive({ subject, tenantId: slug, uuid: account.uuid, actor: { kind: "migration" } });
  await ensureOrganizationMembership({ organizationId: `org-${slug}`, userId: subject });
  await mirrorPerson(subject);
  digit.mdms.set(digit.mdmsKey(slug, "common-masters.MobileNumberValidation"), [{
    tenantId: slug, schemaCode: "common-masters.MobileNumberValidation", uniqueIdentifier: "kenya", isActive: true,
    data: { validationName: "kenya", countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$", default: true },
  }]);
}

async function staffCookie(slug: string, surface: "configurator" | "employee", subject = `founder-${slug}`): Promise<string> {
  const { sessionId } = await createIdentitySession({ accessToken: "trial-contract-token", accessExpiresIn: 3600 },
    { sub: subject, email: `${subject}@example.test` },
    surface === "employee" ? config.keycloakEmployeeClientId : config.keycloakBffClientId,
    { surface, ...(surface === "employee" && { boundTenant: tenantOf(slug) }) });
  return `${surface === "employee" ? config.identityEmployeeCookieName : config.identityCookieName}=${sessionId}`;
}

/** A Keycloak-signed-in citizen bound to the workspace route. */
async function citizenCookie(slug: string, phone: string): Promise<string> {
  const subject = `citizen-${slug}`;
  expect((await kc("POST", "/users", { id: subject, username: subject, enabled: true,
    attributes: { phoneNumber: [phone], phoneNumberVerified: ["true"] } })).status).toBe(201);
  const { sessionId } = await createIdentitySession({ accessToken: "trial-contract-token", accessExpiresIn: 3600 },
    { sub: subject, azp: config.keycloakCitizenClientId }, config.keycloakCitizenClientId,
    { surface: "citizen", boundTenant: tenantOf(slug) });
  return `${config.identityCitizenCookieName}=${sessionId}`;
}

beforeAll(async () => {
  const digitBase = await digit.start();
  digit.addAccount({ userName: "BFF-ADMIN", name: "BFF admin", mobileNumber: "0700000000", emailId: null, tenantId: "pg",
    type: "EMPLOYEE", active: true, identificationMark: null, roles: [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }], password: "Adm1n@Secret" });
  const overrides = {
    identityControlPlaneToken: OPS,
    cachePrefix: `identity-trial-contract-${process.pid}`,
    keycloakOrganizationRealm: "workspace-trial-contract",
    identityAllowedOrigins: [TRUSTED],
    keycloakCitizenClientSecret: "trial-contract-citizen-secret",
    identityCitizenOtpSecret: "trial-contract-otp-secret",
    identityCitizenOtpResendSeconds: 0,
    digitUserServiceUrl: `${digitBase}/user`,
    digitMdmsSearchUrl: `${digitBase}/mdms-v2/v1/_search`,
    digitOtpCreateUrl: `${digitBase}/otp/v1/_create`,
    digitAdminUsername: "BFF-ADMIN",
    digitAdminPassword: "Adm1n@Secret",
    digitAdminTenantId: "pg",
  };
  for (const key of Object.keys(overrides)) saved[key] = (config as any)[key];
  Object.assign(config as any, overrides);
  setOtpSender({ configured: true, async send(message) { sent.push(message); } });
  await startIdentityTestApp();
  base = `http://127.0.0.1:${getIdentityAppPort()}`;
  // Phone OTP is a citizen sign-in method only when the client offers it.
  await kc("PUT", "/clients/digit-ui-citizen-uuid", { attributes: { "digit.auth.signin.methods": "phone_otp,password" } });
  resetIdentityMethodCatalog();
  await workspace("acme", { [TRIAL_ATTRIBUTES.endsAt]: [ENDED] });
  await workspace("bravo", { [TRIAL_ATTRIBUTES.endsAt]: [ENDED], [TRIAL_ATTRIBUTES.approvedAt]: ["2020-01-15T00:00:00.000Z"],
    [TRIAL_ATTRIBUTES.approvedBy]: ["ops@example.org"] });
  await workspace("charlie", {});
  // A failed earlier attempt for the same tenant: disabled, so routing ignores it.
  expect((await kc("POST", "/organizations", { id: "org-charlie-failed", alias: "charlie-failed", name: "charlie workspace",
    enabled: false, attributes: { "digit.rootTenantId": ["charlie"], "digit.urlSlug": ["charlie"], "digit.lifecycle": ["FAILED"] } })).status)
    .toBe(201);
  clearTenantMappingCache();
});

afterAll(async () => {
  setOtpSender(originalSender);
  await stopIdentityTestApp();
  await digit.stop();
  Object.assign(config as any, saved);
});

describe("a workspace whose trial ended", () => {
  it("stays in the founder's tenant list with the lock code and the notice, so nobody is sent to signup", async () => {
    const response = await get(routes.tenants.path, await staffCookie("acme", "configurator"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ tenants: [{ tenantId: "acme", code: "WORKSPACE_TRIAL_EXPIRED", roles: [] }],
      selectionRequired: false, onboardingRequired: false, notice: config.workspaceTrialNotice });
    expect(body.notice.title).toBeTruthy();
  });

  it.each(["configurator", "employee"] as const)("refuses %s _select with the notice and mints no DIGIT token", async (surface) => {
    const tokens = digit.tokens.size;
    const response = await post(routes.select.path, { surface, tenantId: "acme" }, await staffCookie("acme", surface));
    const body = await expectContractError(response, routes.select, "WORKSPACE_TRIAL_EXPIRED");
    expect(body.notice).toEqual(config.workspaceTrialNotice);
    expect((body.notice as { message: string }).message).toBeTruthy();
    expect(digit.tokens.size).toBe(tokens);
  });

  it("locks a managed-account member too: listed with the code, refused at _select, no DIGIT token minted", async () => {
    // A pre-trial member with no binding signs in through the managed account;
    // an operator _extend can put that workspace on trial.
    const subject = "managed-acme";
    const identity = managedIdentity(config.keycloakIssuer, subject, "acme");
    expect((await kc("POST", "/users", { id: subject, username: subject, email: `${subject}@example.test`, emailVerified: true, enabled: true })).status)
      .toBe(201);
    await ensureOrganizationMembership({ organizationId: "org-acme", userId: subject });
    digit.addAccount({ userName: identity.username, name: "Managed admin", mobileNumber: "712000002", emailId: null, tenantId: "acme",
      type: "EMPLOYEE", active: true, identificationMark: identity.marker, password: "Managed@123",
      roles: ["EMPLOYEE", "ACCOUNT_ADMIN"].map((code) => ({ code, tenantId: "acme" })) });
    const listed = await (await get(routes.tenants.path, await staffCookie("acme", "configurator", subject))).json();
    expect(listed).toMatchObject({ tenants: [{ tenantId: "acme", code: "WORKSPACE_TRIAL_EXPIRED", roles: [] }],
      onboardingRequired: false, notice: config.workspaceTrialNotice });
    for (const surface of ["configurator", "employee"] as const) {
      const tokens = digit.tokens.size;
      const response = await post(routes.select.path, { surface, tenantId: "acme" }, await staffCookie("acme", surface, subject));
      expect((await expectContractError(response, routes.select, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
      expect(digit.tokens.size).toBe(tokens);
    }
  });

  it("reports the lock on its public tenant context, keeping the tenant and the cache header", async () => {
    const response = await get("/identity/v1/tenant-contexts/acme");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(await response.json()).toEqual({
      tenant: { urlSlug: "acme", tenantId: "acme", rootTenantId: "acme", parentTenantId: null, fallbackTenantIds: [], name: "acme workspace" },
      access: { state: "TRIAL_EXPIRED", notice: config.workspaceTrialNotice },
    });
  });

  it("sends no citizen OTP and verifies none", async () => {
    const before = sent.length;
    const send = await post(routes.send.path, { tenantSlug: "acme", mobileNumber: "712000201" });
    expect((await expectContractError(send, routes.send, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
    expect(sent.length).toBe(before);
    const verify = await post(routes.verify.path, { tenantSlug: "acme", challengeId: "a".repeat(32), code: "123456" });
    expect((await expectContractError(verify, routes.verify, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
  });

  it("refuses citizen _select for a session bound to it and mints no DIGIT token", async () => {
    const tokens = digit.tokens.size;
    const response = await post(routes.citizenSelect.path, {}, await citizenCookie("acme", "+254712000101"));
    const body = await expectContractError(response, routes.citizenSelect, "WORKSPACE_TRIAL_EXPIRED");
    expect(body.notice).toEqual(config.workspaceTrialNotice);
    expect(digit.tokens.size).toBe(tokens);
  });
});

describe("an approved trial workspace", () => {
  it("is listed without a code or a notice", async () => {
    const body = await (await get(routes.tenants.path, await staffCookie("bravo", "configurator"))).json();
    expect(body.tenants).toEqual([expect.objectContaining({ tenantId: "bravo", roles: ["ACCOUNT_ADMIN", "EMPLOYEE"] })]);
    expect(body.tenants[0]).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("notice");
  });

  it.each(["configurator", "employee"] as const)("selects its DIGIT account on %s", async (surface) => {
    const response = await post(routes.select.path, { surface, tenantId: "bravo" }, await staffCookie("bravo", surface));
    expect(response.status).toBe(200);
    expect((await response.json()).UserRequest).toMatchObject({ userName: "FOUNDER-BRAVO", tenantId: "bravo" });
  });

  it("has no access key on its public tenant context", async () => {
    const response = await get("/identity/v1/tenant-contexts/bravo");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tenant).toMatchObject({ urlSlug: "bravo", tenantId: "bravo" });
    expect(body).not.toHaveProperty("access");
  });

  it("answers OTP routes 503, not 500, when Keycloak fails during the trial check", async () => {
    const original = organizationService.readTenantMappingForUrlSlug;
    // The route resolves, then the trial lookup for the same slug fails.
    const spy = vi.spyOn(organizationService, "readTenantMappingForUrlSlug");
    try {
      for (const [route, body] of [[routes.send, { tenantSlug: "bravo", mobileNumber: "712000302" }],
        [routes.verify, { tenantSlug: "bravo", challengeId: "a".repeat(32), code: "123456" }]] as const) {
        spy.mockImplementationOnce(original).mockRejectedValueOnce(new IdentityAdminError("Keycloak Admin unavailable", 503));
        await expectContractError(await post(route.path, body), route, "TENANT_ROUTE_UNAVAILABLE");
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("signs a citizen in by OTP and selects the citizen context", async () => {
    const send = await post(routes.send.path, { tenantSlug: "bravo", mobileNumber: "712000301" });
    expect(send.status).toBe(202);
    const { challengeId } = await send.json();
    const verify = await post(routes.verify.path, { tenantSlug: "bravo", challengeId, code: sent[sent.length - 1].code });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ authenticated: true, tenant: { urlSlug: "bravo", tenantId: "bravo" } });
    const cookie = verify.headers.getSetCookie().find((value) => value.startsWith(`${config.identityCitizenCookieName}=`))!.split(";", 1)[0];
    const selected = await post(routes.citizenSelect.path, {}, cookie);
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({ UserRequest: { type: "CITIZEN" }, tenant: { urlSlug: "bravo", tenantId: "bravo" } });
  });
});

describe("a workspace with no trial", () => {
  it("selects a citizen context even when a disabled Organization also claims its tenant", async () => {
    const response = await post(routes.citizenSelect.path, {}, await citizenCookie("charlie", "+254712000102"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ UserRequest: { type: "CITIZEN" }, tenant: { urlSlug: "charlie", tenantId: "charlie" } });
  });
});

const ops = (path: string, body?: unknown, token = OPS) => fetch(`${base}${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});
const listed = async (slug: string) =>
  (await (await ops(routes.list.path)).json()).workspaces.find((w: { urlSlug: string }) => w.urlSlug === slug);

describe("operator trial routes", () => {
  it("require the control-plane token and are not served under /identity/v1", async () => {
    expect((await ops(routes.list.path, undefined, "wrong")).status).toBe(401);
    expect((await ops(routes.approve.path, { tenantId: "acme" }, "wrong")).status).toBe(401);
    expect((await get(routes.list.path.replace("/internal", ""))).status).toBe(404);
  });

  it("list workspaces with a trial, soonest end first", async () => {
    const response = await ops(routes.list.path);
    expect(response.status).toBe(200);
    const { workspaces } = await response.json();
    expect(workspaces.map((w: { urlSlug: string }) => w.urlSlug)).toEqual(["acme", "bravo"]);
    expect(workspaces[0]).toEqual({ tenantId: "acme", urlSlug: "acme", name: "acme workspace", trialEndsAt: ENDED,
      approvedAt: null, approvedBy: null, state: "EXPIRED" });
  });

  it("approve unlocks an expired workspace at once, for the next select and the next public read", async () => {
    // Warm the cached directory with the lock in it.
    expect((await (await get("/identity/v1/tenant-contexts/acme")).json()).access.state).toBe("TRIAL_EXPIRED");
    const response = await ops(routes.approve.path, { tenantId: "acme", actor: "ops@example.org" });
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace).toMatchObject({ tenantId: "acme", state: "APPROVED", approvedBy: "control-plane:ops@example.org" });
    expect((await post(routes.select.path, { surface: "configurator", tenantId: "acme" }, await staffCookie("acme", "configurator"))).status).toBe(200);
    expect(await (await get("/identity/v1/tenant-contexts/acme")).json()).not.toHaveProperty("access");
    expect(await listed("acme")).toMatchObject({ state: "APPROVED", approvedBy: "control-plane:ops@example.org" });
  });

  it("keeps the first approval on a second call", async () => {
    const first = (await listed("acme")).approvedAt;
    const response = await ops(routes.approve.path, { tenantId: "acme", actor: "someone-else" });
    expect(response.status).toBe(200);
    expect((await response.json()).workspace).toMatchObject({ approvedAt: first, approvedBy: "control-plane:ops@example.org" });
  });

  it("extend puts an expired trial back in TRIAL and refuses a past or invalid end", async () => {
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const response = await ops(routes.extend.path, { tenantId: "bravo", endsAt, actor: "ops@example.org" });
    expect(response.status).toBe(200);
    // bravo is approved, so its state stays APPROVED; the new end is stored.
    expect((await response.json()).workspace).toMatchObject({ trialEndsAt: endsAt, state: "APPROVED" });
    for (const bad of ["2020-01-01T00:00:00.000Z", "not a date", undefined]) {
      await expectContractError(await ops(routes.extend.path, { tenantId: "bravo", endsAt: bad }), routes.extend, "INVALID_REQUEST");
    }
  });

  it("extend on an unapproved expired trial gives state TRIAL, and works without a trial", async () => {
    expect((await kc("POST", "/organizations", { id: "org-delta", alias: "delta", name: "delta workspace", enabled: true,
      attributes: { "digit.rootTenantId": ["delta"], "digit.urlSlug": ["delta"], "digit.lifecycle": ["ACTIVE"], [TRIAL_ATTRIBUTES.endsAt]: [ENDED] } })).status).toBe(201);
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    expect((await (await ops(routes.extend.path, { tenantId: "delta", endsAt })).json()).workspace).toMatchObject({ state: "TRIAL", trialEndsAt: endsAt });
    const none = await ops(routes.extend.path, { tenantId: "charlie", endsAt });
    expect((await none.json()).workspace).toMatchObject({ tenantId: "charlie", state: "TRIAL" });
  });

  it("answer an unknown tenant with 404 and a workspace with no trial with 409 on approve", async () => {
    await expectContractError(await ops(routes.approve.path, { tenantId: "nowhere" }), routes.approve, "WORKSPACE_NOT_FOUND");
    await expectContractError(await ops(routes.extend.path, { tenantId: "nowhere", endsAt: new Date(Date.now() + 1e6).toISOString() }),
      routes.extend, "WORKSPACE_NOT_FOUND");
    // charlie got a trial from the extend above; a fresh one has none.
    expect((await kc("POST", "/organizations", { id: "org-echo", alias: "echo", name: "echo workspace", enabled: true,
      attributes: { "digit.rootTenantId": ["echo"], "digit.urlSlug": ["echo"], "digit.lifecycle": ["ACTIVE"] } })).status).toBe(201);
    await expectContractError(await ops(routes.approve.path, { tenantId: "echo" }), routes.approve, "WORKSPACE_NOT_ON_TRIAL");
  });
});
