import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";
import { config } from "../../src/infrastructure/config.js";
import { resetIdentityMethodCatalog } from "../../src/modules/authentication/methods.js";
import { ensureActive } from "../../src/modules/bindings/store.js";
import { otpSender, setOtpSender, type OtpMessage } from "../../src/modules/citizen-otp/otp-sender.js";
import { clearTenantMappingCache, ensureOrganizationMembership } from "../../src/modules/organizations/organization-service.js";
import { createIdentitySession } from "../../src/modules/sessions/session-store.js";
import { mirrorPerson } from "../../src/modules/sync/mirror.js";
import { TRIAL_ATTRIBUTES } from "../../src/modules/workspace-trial/trial.js";
import { getIdentityAppPort, startIdentityTestApp, stopIdentityTestApp } from "../e2e/identity-test-app.js";
import { contractRoute, expectContractError } from "./harness.js";

// Workspace trial lock at every sign-in gate. `acme`'s trial ended; `bravo`'s
// ended too but was approved, so it must pass every gate. The real app runs
// over the Keycloak Admin mock (in a realm of its own), a fake DIGIT and Redis.

const TRUSTED = "http://localhost:5173";
const ENDED = "2020-01-01T00:00:00.000Z";
const digit = createFakeDigitUser({ tenants: ["acme", "bravo"] });
const sent: OtpMessage[] = [];
const originalSender = otpSender();
const saved: Record<string, unknown> = {};
let base = "";

const routes = {
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
  await kc("POST", "/users", { id: subject, username: subject, email: `${subject}@example.test`, emailVerified: true, enabled: true });
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

async function staffCookie(slug: string, surface: "configurator" | "employee"): Promise<string> {
  const subject = `founder-${slug}`;
  const { sessionId } = await createIdentitySession({ accessToken: "trial-contract-token", accessExpiresIn: 3600 },
    { sub: subject, email: `${subject}@example.test` },
    surface === "employee" ? config.keycloakEmployeeClientId : config.keycloakBffClientId,
    { surface, ...(surface === "employee" && { boundTenant: tenantOf(slug) }) });
  return `${surface === "employee" ? config.identityEmployeeCookieName : config.identityCookieName}=${sessionId}`;
}

/** A Keycloak-signed-in citizen bound to the workspace route. */
async function citizenCookie(slug: string): Promise<string> {
  const subject = `citizen-${slug}`;
  await kc("POST", "/users", { id: subject, username: subject, enabled: true,
    attributes: { phoneNumber: ["+254712000101"], phoneNumberVerified: ["true"] } });
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
    const response = await post(routes.citizenSelect.path, {}, await citizenCookie("acme"));
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
