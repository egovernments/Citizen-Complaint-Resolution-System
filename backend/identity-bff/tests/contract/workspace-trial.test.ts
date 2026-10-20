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
    expect(await response.json()).toMatchObject({ tenants: [{ tenantId: "acme", code: "WORKSPACE_TRIAL_EXPIRED", roles: [] }],
      selectionRequired: false, onboardingRequired: false, notice: config.workspaceTrialNotice });
  });

  it.each(["configurator", "employee"] as const)("refuses %s _select with the notice and mints no DIGIT token", async (surface) => {
    const tokens = digit.tokens.size;
    const response = await post(routes.select.path, { surface, tenantId: "acme" }, await staffCookie("acme", surface));
    expect((await expectContractError(response, routes.select, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
    expect(digit.tokens.size).toBe(tokens);
  });

  it("sends no citizen OTP and verifies none", async () => {
    const before = sent.length;
    const send = await post(routes.send.path, { tenantSlug: "acme", mobileNumber: "712000201" });
    expect((await expectContractError(send, routes.send, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
    expect(sent.length).toBe(before);
    const verify = await post(routes.verify.path, { tenantSlug: "acme", challengeId: "a".repeat(32), code: "123456" });
    await expectContractError(verify, routes.verify, "WORKSPACE_TRIAL_EXPIRED");
  });

  it("refuses citizen _select for a session bound to it and mints no DIGIT token", async () => {
    const tokens = digit.tokens.size;
    const response = await post(routes.citizenSelect.path, {}, await citizenCookie("acme", "+254712000101"));
    expect((await expectContractError(response, routes.citizenSelect, "WORKSPACE_TRIAL_EXPIRED")).notice).toEqual(config.workspaceTrialNotice);
    expect(digit.tokens.size).toBe(tokens);
  });
});

describe("an approved trial workspace", () => {
  it.each(["configurator", "employee"] as const)("selects its DIGIT account on %s", async (surface) => {
    const response = await post(routes.select.path, { surface, tenantId: "bravo" }, await staffCookie("bravo", surface));
    expect(response.status).toBe(200);
    expect((await response.json()).UserRequest).toMatchObject({ userName: "FOUNDER-BRAVO", tenantId: "bravo" });
  });
});

describe("a workspace with no trial", () => {
  it("selects a citizen context", async () => {
    const response = await post(routes.citizenSelect.path, {}, await citizenCookie("charlie", "+254712000102"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ UserRequest: { type: "CITIZEN" }, tenant: { urlSlug: "charlie", tenantId: "charlie" } });
  });
});

describe("operator trial routes", () => {
  const ops = (path: string, body?: unknown) => fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPS}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  it("approve unlocks an expired workspace at once and keeps the first approval", async () => {
    const response = await ops(routes.approve.path, { tenantId: "acme", actor: "ops@example.org" });
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace).toMatchObject({ tenantId: "acme", state: "APPROVED", approvedBy: "control-plane:ops@example.org" });
    expect((await post(routes.select.path, { surface: "configurator", tenantId: "acme" }, await staffCookie("acme", "configurator"))).status).toBe(200);
    const again = await (await ops(routes.approve.path, { tenantId: "acme", actor: "someone-else" })).json();
    expect(again.workspace).toMatchObject({ approvedAt: workspace.approvedAt, approvedBy: "control-plane:ops@example.org" });
    const { workspaces } = await (await ops(routes.list.path)).json();
    expect(workspaces.find((w: { urlSlug: string }) => w.urlSlug === "acme")).toMatchObject({ state: "APPROVED", trialEndsAt: ENDED });
  });

  it("extend stores the new end and refuses an invalid one", async () => {
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const response = await ops(routes.extend.path, { tenantId: "charlie", endsAt, actor: "ops@example.org" });
    expect(response.status).toBe(200);
    expect((await response.json()).workspace).toMatchObject({ tenantId: "charlie", trialEndsAt: endsAt, state: "TRIAL" });
    await expectContractError(await ops(routes.extend.path, { tenantId: "charlie", endsAt: "not a date" }), routes.extend, "INVALID_REQUEST");
  });

  it("answers an unknown tenant with 404", async () => {
    await expectContractError(await ops(routes.approve.path, { tenantId: "nowhere" }), routes.approve, "WORKSPACE_NOT_FOUND");
  });
});
