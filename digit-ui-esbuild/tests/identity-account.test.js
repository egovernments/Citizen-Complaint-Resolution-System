const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const OUT = path.join(os.tmpdir(), `identity-account.${process.pid}.cjs`);
esbuild.buildSync({
  stdin: { contents: `export * from './identityAccount'; export * from './citizenOtp'; export * from './identityBffLogin';`,
    resolveDir: path.join(__dirname, "../packages/libraries/src/services/auth"), loader: "js" },
  bundle: true, format: "cjs", platform: "node", outfile: OUT,
});
process.on("exit", () => fs.unlinkSync(OUT));
const api = require(OUT);
const tenant = { tenantId: "ke.bomet", urlSlug: "bomet", appBasePath: "bomet/digit-ui" };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("account metadata is fetched only by an explicit account request", async () => {
  const calls = [];
  const result = await api.loadIdentityAccount({ surface: "employee", fetchImpl: async (url, init) => {
    calls.push({ url, init }); return json(200, { account: { actions: [] }, sessions: [] });
  } });
  assert.deepEqual(result.account.actions, []);
  assert.equal(calls[0].url, "/identity/v1/session?surface=employee&include=account");
  assert.equal(calls[0].init.credentials, "include");
});

test("account actions use allowlisted required actions and tenant-bound return paths without intent", () => {
  const account = { actions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "UPDATE_EMAIL", "delete_credential", "idp_link"],
    credentials: [{ id: "otp-id", type: "otp" }, { id: "pass-id", type: "password" }, { id: "pk-id", type: "webauthn-passwordless" }], providers: [{ alias: "linked" }] };
  for (const action of ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "UPDATE_EMAIL"]) {
    const url = new URL(api.buildAccountActionUrl({ surface: "employee", tenant, account, action, returnTo: "https://evil.test" }), "https://app.test");
    assert.equal(url.searchParams.get("action"), action);
    assert.equal(url.searchParams.get("surface"), "employee");
    assert.equal(url.searchParams.get("returnTo"), "/bomet/digit-ui/employee/user/account");
    assert.equal(url.searchParams.has("intent"), false);
  }
  assert.throws(() => api.buildAccountActionUrl({ surface: "employee", tenant, account: { actions: [] }, action: "UPDATE_PASSWORD" }));
  for (const credentialId of ["pass-id", "pk-id", "unknown"]) {
    assert.throws(() => api.buildAccountActionUrl({ surface: "employee", tenant, account, action: "delete_credential", credentialId }));
  }
  assert.match(api.buildAccountActionUrl({ surface: "employee", tenant, account, action: "delete_credential", credentialId: "otp-id" }), /credentialId=otp-id/);
  assert.throws(() => api.buildAccountActionUrl({ surface: "employee", tenant, account, action: "idp_link", provider: "linked" }));
  assert.match(api.buildAccountActionUrl({ surface: "employee", tenant, account, action: "idp_link", provider: "new" }), /provider=new/);
});

test("provider catalogue uses idp methods and excludes already linked providers", () => {
  assert.deepEqual(api.availableProviders([
    { id: "password", type: "password" }, { id: "google", type: "idp", idpHint: "google" }, { id: "github", type: "idp", idpHint: "github" },
  ], { providers: [{ alias: "google" }] }).map((m) => m.id), ["github"]);
});

test("provider unlink preserves the frozen body and surfaces last-method protection", async () => {
  await assert.rejects(api.unlinkIdentityProvider({ surface: "employee", alias: "google", fetchImpl: async (url, init) => {
    assert.equal(url, "/identity/v1/account/providers/_unlink?surface=employee");
    assert.deepEqual(JSON.parse(init.body), { alias: "google" });
    return json(409, { code: "LAST_SIGNIN_METHOD", error: "server copy must not be shown" });
  } }), (error) => error.code === "LAST_SIGNIN_METHOD" && /another sign-in method/.test(error.message));
});

test("accept invitation sends its exact version and employee cookie selector, then permits selection", async () => {
  const invitation = { tenantId: tenant.tenantId, invitationVersion: 4 };
  const calls = [];
  let accepted = false;
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.includes("_accept")) {
      assert.equal(url, "/identity/v1/workspace-invitations/_accept?surface=employee");
      assert.deepEqual(JSON.parse(init.body), invitation);
      assert.equal(init.credentials, "include");
      accepted = true;
      return json(200, { binding: { state: "active" } });
    }
    if (url.includes("/session")) return json(200, { authenticated: true, tenant, pendingInvitations: accepted ? [] : [invitation] });
    return accepted ? json(200, { access_token: "digit", UserRequest: { type: "EMPLOYEE", tenantId: tenant.tenantId } }) : json(403, { code: "PENDING_INVITATION" });
  };
  assert.equal((await api.establishIdentityBffSession({ surface: "employee", tenant, fetchImpl })).status, "pending-invitation");
  assert.equal(accepted, false);
  await api.acceptIdentityInvitation({ tenant, invitation, fetchImpl });
  assert.equal((await api.establishIdentityBffSession({ surface: "employee", tenant, fetchImpl })).status, "authenticated");
  assert.throws(() => api.acceptIdentityInvitation({ tenant, invitation: { ...invitation, tenantId: "ke.other" }, fetchImpl }));
});

test("stale invitations remain failed and expose a recoverable message", async () => {
  await assert.rejects(api.acceptIdentityInvitation({ tenant, invitation: { tenantId: tenant.tenantId, invitationVersion: 1 },
    fetchImpl: async () => json(409, { code: "INVITATION_STALE" }) }), (error) => error.code === "INVITATION_STALE");
  assert.match(api.identityMessage("INVITATION_STALE").message, /new invitation/);
});

for (const purpose of ["stepup", "change_phone"]) {
  test(`${purpose} binds send and verify to the same challenge/purpose without a caller tenant`, async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), credentials: init.credentials });
      return url.endsWith("_send") ? json(202, { challengeId: "challenge", expiresIn: 300, resendAfter: 60 }) :
        json(200, { phoneNumber: "+254712345678", phoneNumberVerified: true });
    };
    const sent = await api.sendCitizenOtp({ tenant, mobileNumber: "712345678", purpose, fetchImpl });
    assert.equal(sent.ok, true);
    const verified = await api.verifyCitizenOtp({ tenant, challengeId: sent.challengeId, code: "123456", purpose, fetchImpl });
    assert.deepEqual(verified, { ok: true, phoneNumber: "+254712345678" });
    assert.deepEqual(calls.map((c) => c.body), [{ mobileNumber: "712345678", purpose }, { challengeId: "challenge", code: "123456", purpose }]);
    assert.ok(calls.every((c) => c.credentials === "include"));
  });
}

test("phone rejection and invalid verification never report a changed phone", async () => {
  for (const code of ["PHONE_IN_USE", "INVALID_MOBILE_NUMBER", "OTP_INVALID", "OTP_EXPIRED"]) {
    const result = await api.verifyCitizenOtp({ purpose: "change_phone", challengeId: "c", code: "wrong", fetchImpl: async () => json(400, { code }) });
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
  }
  assert.equal((await api.verifyCitizenOtp({ purpose: "change_phone", challengeId: "c", code: "x", fetchImpl: async () => json(200, { authenticated: true }) })).ok, false);
});

test("failed scoped logout is not reported as success", async () => {
  for (const scope of ["current", "others", "all"]) {
    await assert.rejects(api.identityBffLogout({ surface: "employee", scope, fetchImpl: async () => json(503, {}) }));
  }
});
