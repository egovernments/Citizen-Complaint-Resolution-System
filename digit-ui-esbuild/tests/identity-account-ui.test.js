// Interaction tests run real UI hooks and API consumers with in-memory HTTP
// responses. Design-system primitives and localisation are lightweight doubles.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
// Load the renderer scheduler in Node before installing the browser double.
require("react-test-renderer");
require("react-dom");
const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `identity-account-ui.${process.pid}.cjs`);
let ui;
const tenant = { tenantId: "ke.bomet", urlSlug: "bomet", appBasePath: "bomet/digit-ui", name: "Bomet" };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const t = (key, options) => options?.defaultValue || key;

before(async () => {
  await esbuild.build({
    stdin: { contents: `
      export { default as React } from 'react';
      export { create, act } from 'react-test-renderer';
      export { MemoryRouter } from 'react-router-dom';
      export { default as Account, ChangePhone } from './packages/modules/core/src/components/IdentityAccount';
      export { SignInFailureCard, useIdentityBffSignIn } from './packages/modules/core/src/components/IdentityBffSignIn';
      export { default as LogoutDialog } from './packages/modules/core/src/components/Dialog/LogoutDialog';
      export { default as Profile } from './packages/modules/core/src/pages/citizen/Home/UserProfile';
      export { default as EmployeeLogin } from './packages/modules/core/src/pages/employee/IdentityBffEmployeeLogin';
      export { default as CitizenLogin } from './packages/modules/core/src/pages/citizen/IdentityBffCitizenLogin';
    `, resolveDir: root, loader: "jsx" },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, loader: { ".js": "jsx" },
    nodePaths: [path.join(root, "node_modules")],
    plugins: [{ name: "ui-boundaries", setup(build) {
      build.onResolve({ filter: /^react$|^react-test-renderer$|^react-dom$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
      build.onResolve({ filter: /^@egovernments\/|^react-i18next$/ }, (args) => ({ path: args.path, namespace: "ui-double" }));
      build.onResolve({ filter: /\/UploadDrawer$|\/ImageComponent$|^\.\.?\/Header$|^\.\.\/Background$/ }, () => ({ path: "empty", namespace: "ui-double" }));
      build.onLoad({ filter: /.*/, namespace: "ui-double" }, (args) => {
        let contents;
        if (args.path.endsWith("digit-ui-libraries")) {
          const auth = path.join(root, "packages/libraries/src/services/auth");
          contents = `export * as IdentityAccount from ${JSON.stringify(auth + "/identityAccount.js")};
            export * from ${JSON.stringify(auth + "/citizenOtp.js")};
            export * from ${JSON.stringify(auth + "/authSurface.js")};
            export { establishIdentityBffSession, buildAuthorizeUrl as buildIdentityBffAuthorizeUrl,
              surfaceBase as identityBffSurfaceBase, restrictDestination as restrictIdentityBffDestination,
              signOutIncomplete as identityBffSignOutIncomplete, clearSignOutIncomplete as clearIdentityBffSignOutIncomplete } from ${JSON.stringify(auth + "/identityBffLogin.js")};
            export { computeMobileLengths, buildMobileErrorMessage, DEFAULT_MOBILE_PATTERN }
              from ${JSON.stringify(path.join(root, "packages/libraries/src/constants/mobileValidation.js"))};
            export const fetchCitizenSigninMethods = async () => ({ ok: false });
            export const fillMessage = (value) => value;
            export const DEFAULT_MOBILE_PREFIX = '+254';`;
        } else if (args.path === "react-i18next") contents = `export const useTranslation = () => ({ t: (key, options) => options?.defaultValue || key });`;
        else if (args.path === "empty") contents = `export default ({ children }) => children ?? null;`;
        else contents = `import React from 'react';
          const Box = ({children, ...props}) => <div {...props}>{children}</div>;
          export const Button = ({children, label, ...props}) => <button {...props}>{children || label}</button>;
          export const Input = props => <input {...props}/>;
          export const TextInput = Input, MobileNumber = Input;
          export const PopUp = ({children, footerChildren}) => <div>{children}{footerChildren}</div>;
          export const Field = Box, Card = Box, CardText = Box, Dropdown = Box, LabelFieldPair = Box, CardLabelError = Box,
            BackLink = Box, Loader = Box, SubmitBar = Button, Footer = Box, CardLabel = Box, BreadCrumb = Box,
            Toast = Box, ErrorMessage = Box, ToggleSwitch = Box, CameraIcon = Box, Select = Box;
          export const SVG = new Proxy({}, {get: () => Box});`;
        return { contents, loader: "jsx", resolveDir: root };
      });
    } }],
  });
  global.Digit = { ULBService: { getStateId: () => "ke" } };
  global.window = { globalConfigs: { getConfig: () => undefined } };
  ui = require(OUT);
});
after(() => { fs.unlinkSync(OUT); delete global.window; delete global.Digit; delete global.localStorage; delete global.sessionStorage; });

function browser(surface, fetchImpl) {
  const stored = {};
  const authWrites = [];
  let user = { access_token: "old-token", info: { uuid: "same-uuid", name: "Ada", userName: "opaque", emailId: "old@example.test", mobileNumber: "711111111", tenantId: surface === "citizen" ? "ke" : "ke.bomet", type: surface.toUpperCase() } };
  const prefix = surface === "citizen" ? "Citizen" : "Employee";
  Object.assign(stored, { [`${prefix}.token`]: user.access_token, token: user.access_token,
    [`${prefix}.user-info`]: JSON.stringify(user.info), "user-info": JSON.stringify(user.info) });
  global.localStorage = { setItem: (key, value) => { authWrites.push(key); stored[key] = value; }, getItem: (key) => stored[key] || null,
    clear: () => { Object.keys(stored).forEach((key) => delete stored[key]); } };
  global.sessionStorage = { getItem: () => null };
  global.window = { __digitTenantContext: tenant, contextPath: tenant.appBasePath, fetch: fetchImpl,
    location: { pathname: `/bomet/digit-ui/${surface}/user/account`, href: `https://app.test/bomet/digit-ui/${surface}/user/account`, search: "", origin: "https://app.test", assign: (url) => { stored.redirect = url; }, replace: (url) => { stored.redirect = url; } },
    history: { replaceState: () => {} }, globalConfigs: { getConfig: () => undefined },
    innerWidth: 1024, addEventListener: () => {}, removeEventListener: () => {},
  };
  global.Digit = window.Digit = {
    ULBService: { getStateId: () => "ke", getCurrentTenantId: () => "ke.bomet" },
    UserService: { setUser: (value) => { authWrites.push("User"); user = value; }, getUser: () => user,
      userSearch: async () => ({ user: [] }), logout: async (scope) => { stored.logoutScope = scope; } },
    SessionStorage: { get: (key) => stored[key], set: (key, value) => { authWrites.push(key); stored[key] = value; } },
    StoreData: { getCurrentLanguage: () => "en_IN" },
    Utils: { getMultiRootTenant: () => false, getOTPBasedLogin: () => false, browser: { isMobile: () => false }, locale: { getTransformedLocale: (s) => s } },
    Hooks: { useCustomMDMS: () => ({}), useCustomAPIHook: () => ({}), useCustomAPIMutationHook: () => ({}), useGenderMDMS: () => ({}) },
  };
  return { stored, authWrites, getUser: () => user, replaceUser: (value) => { user = value; } };
}
const text = (node) => node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
const button = (view, label) => view.root.findAllByType("button").find((node) => text(node).includes(label));
async function render(Component, props = {}) {
  let view;
  await ui.act(async () => { view = ui.create(ui.React.createElement(ui.MemoryRouter, null, ui.React.createElement(Component, props))); });
  return view;
}
async function click(node) { await ui.act(async () => { await node.props.onClick(); }); }

test("staff account offers advertised actions, second factors, providers and scoped sessions", async () => {
  const calls = [];
  const state = browser("employee", async (url, init) => {
    calls.push({ url, init });
    if (url.includes("_unlink")) return json(409, { code: "LAST_SIGNIN_METHOD" });
    if (url.includes("auth-methods")) return json(200, { methods: [{ id: "github", type: "idp", idpHint: "github" }] });
    return json(200, { authenticated: true, user: { email: "ada@example.test" },
      account: { actions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "UPDATE_EMAIL", "delete_credential", "idp_link"],
        credentials: [{ id: "pass", type: "password" }, { id: "otp", type: "otp", label: "My authenticator" }], providers: [{ alias: "google" }] },
      sessions: [{ id: "current", current: true, surface: "employee" }, { id: "other", current: false, surface: "configurator" }] });
  });
  const view = await render(ui.Account, { surface: "employee" });
  assert.equal(calls[0].url, "/identity/v1/session?surface=employee&include=account");
  assert.ok(button(view, "Set or update password"));
  assert.ok(button(view, "Set up an authenticator"));
  assert.ok(button(view, "Change email address"));
  assert.ok(button(view, "Remove second factor: My authenticator"));
  assert.equal(button(view, "Remove second factor: password"), undefined);
  await click(button(view, "Link provider: github"));
  assert.match(state.stored.redirect, /action=idp_link/);
  assert.match(state.stored.redirect, /provider=github/);
  await click(button(view, "Unlink provider: google"));
  assert.match(text(view.root.findByProps({ role: "status" })), /another sign-in method/);
  await click(button(view, "Sign out other sessions"));
  assert.equal(state.stored.logoutScope, "others");
  await click(button(view, "Sign out everywhere"));
  assert.equal(state.stored.logoutScope, "all");
  view.unmount();
});

test("a failed sign-out everywhere is reported, not presented as success", async () => {
  browser("employee", async () => json(200, { authenticated: true, user: { email: "ada@example.test" },
    account: { actions: [], credentials: [], providers: [] }, sessions: [{ id: "current", current: true, surface: "employee" }] }));
  Digit.UserService.logout = async () => { throw new Error("Sign-out could not be completed. Please try again."); };
  const view = await render(ui.Account, { surface: "employee" });
  await click(button(view, "Sign out everywhere"));
  assert.match(text(view.root.findByProps({ role: "status" })), /could not be confirmed\. Other devices may still be signed in/);
  view.unmount();
});

test("phone-only account hides credential actions and offers phone change", async () => {
  browser("citizen", async () => json(200, { user: {}, account: { actions: [], credentials: [], providers: [] }, sessions: [] }));
  const view = await render(ui.Account, { surface: "citizen" });
  assert.equal(button(view, "Set or update password"), undefined);
  assert.ok(button(view, "Send code"));
  view.unmount();
});

test("phone change verifies before refreshing the same citizen uuid and token aliases", async () => {
  const calls = [];
  const state = browser("citizen", async (url, init) => {
    calls.push({ url, body: init?.body && JSON.parse(init.body) });
    if (url.endsWith("_send")) return json(202, { challengeId: "new-phone", resendAfter: 0, expiresIn: 300 });
    if (url.endsWith("_verify")) return json(200, { phoneNumberVerified: true, phoneNumber: "+254722222222" });
    if (url.includes("/session")) return json(200, { authenticated: true, tenant });
    return json(200, { access_token: "new-token", tenant, UserRequest: { uuid: "same-uuid", type: "CITIZEN", tenantId: "ke", mobileNumber: "722222222" } });
  });
  let changed = 0;
  const view = await render(ui.ChangePhone, { t, tenant, onChanged: () => { changed++; } });
  assert.equal(calls.length, 0, "mounting the phone form does not contact identity");
  await ui.act(async () => view.root.findByProps({ id: "account-phone" }).props.onChange({ target: { value: "722222222" } }));
  await click(button(view, "Send code"));
  assert.equal(state.getUser().info.mobileNumber, "711111111");
  assert.equal(view.root.findByProps({ id: "account-phone" }).props.disabled, true);
  await ui.act(async () => view.root.findByProps({ id: "account-code" }).props.onChange({ target: { value: "123456" } }));
  await click(button(view, "Verify and change phone"));
  assert.equal(calls[0].body.purpose, "change_phone");
  assert.deepEqual(calls[1].body, { purpose: "change_phone", challengeId: "new-phone", code: "123456" });
  assert.equal(state.getUser().info.uuid, "same-uuid");
  assert.equal(state.getUser().info.mobileNumber, "722222222");
  assert.equal(state.stored["Citizen.token"], "new-token");
  assert.equal(changed, 1);
  view.unmount();
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const stage of ["verify", "select"]) {
  for (const race of ["logout", "account switch", "same-person new session", "other-tab logout", "other-tab account switch"]) {
    test(`phone change cannot write auth state after ${race} during pending ${stage}`, async () => {
      const reached = deferred();
      const release = deferred();
      const calls = [];
      const state = browser("citizen", async (url) => {
        calls.push(url);
        if (url.endsWith("_send")) return json(202, { challengeId: "new-phone", resendAfter: 0, expiresIn: 300 });
        if ((stage === "verify" && url.endsWith("_verify")) || (stage === "select" && url.endsWith("_select"))) {
          reached.resolve();
          await release.promise;
        }
        if (url.endsWith("_verify")) return json(200, { phoneNumberVerified: true, phoneNumber: "+254722222222" });
        if (url.includes("/session")) return json(200, { authenticated: true, tenant });
        return json(200, { access_token: "new-token", tenant, UserRequest: { uuid: "same-uuid", type: "CITIZEN", tenantId: "ke", mobileNumber: "722222222" } });
      });
      let changed = 0;
      const view = await render(ui.ChangePhone, { t, tenant, onChanged: () => { changed++; } });
      await ui.act(async () => view.root.findByProps({ id: "account-phone" }).props.onChange({ target: { value: "722222222" } }));
      await click(button(view, "Send code"));
      await ui.act(async () => view.root.findByProps({ id: "account-code" }).props.onChange({ target: { value: "123456" } }));
      let expectedUser;
      let expectedAliases;
      await ui.act(async () => {
        const pending = button(view, "Verify and change phone").props.onClick();
        await reached.promise;
        if (race === "logout") {
          state.replaceUser(null);
          localStorage.clear();
        } else if (race === "account switch" || race === "same-person new session") {
          state.replaceUser({ access_token: "another-token", info: { ...state.getUser().info,
            uuid: race === "account switch" ? "another-uuid" : "same-uuid" } });
        } else if (race === "other-tab logout") {
          localStorage.clear(); // This tab's sessionStorage cache is deliberately still present.
        } else {
          state.stored.token = "employee-token";
          state.stored["user-info"] = JSON.stringify({ uuid: "employee-uuid", type: "EMPLOYEE" });
        }
        expectedUser = state.getUser();
        expectedAliases = { ...state.stored };
        release.resolve();
        await pending;
      });
      assert.deepEqual(state.authWrites, [], "no User cache or citizen/shared alias writes");
      assert.deepEqual(state.stored, expectedAliases);
      assert.deepEqual(state.getUser(), expectedUser);
      assert.equal(changed, 0);
      assert.match(text(view.root.findByProps({ role: "status" })), /signed-in account has changed/);
      if (stage === "verify") assert.equal(calls.some((url) => url.includes("/session") || url.endsWith("_select")), false);
      view.unmount();
    });
  }
}

test("phone change cannot adopt a different UUID returned by the citizen cookie", async () => {
  const state = browser("citizen", async (url) => {
    if (url.endsWith("_send")) return json(202, { challengeId: "new-phone", resendAfter: 0 });
    if (url.endsWith("_verify")) return json(200, { phoneNumberVerified: true, phoneNumber: "+254722222222" });
    if (url.includes("/session")) return json(200, { authenticated: true, tenant });
    return json(200, { access_token: "foreign-token", tenant, UserRequest: { uuid: "foreign-uuid", type: "CITIZEN", tenantId: "ke" } });
  });
  const originalUser = state.getUser();
  const originalAliases = { ...state.stored };
  const view = await render(ui.ChangePhone, { t, tenant, onChanged: () => assert.fail("must not report a foreign profile update") });
  await ui.act(async () => view.root.findByProps({ id: "account-phone" }).props.onChange({ target: { value: "722222222" } }));
  await click(button(view, "Send code"));
  await ui.act(async () => view.root.findByProps({ id: "account-code" }).props.onChange({ target: { value: "123456" } }));
  await click(button(view, "Verify and change phone"));
  assert.deepEqual(state.authWrites, []);
  assert.deepEqual(state.getUser(), originalUser);
  assert.deepEqual(state.stored, originalAliases);
  assert.match(text(view.root.findByProps({ role: "status" })), /signed-in account has changed/);
  view.unmount();
});

test("pending invitation UI waits for consent and shows stale rejection", async () => {
  const calls = [];
  browser("employee", async (url) => {
    calls.push(url);
    if (url.includes("_accept")) return json(409, { code: "INVITATION_STALE" });
    if (url.includes("/session")) return json(200, { authenticated: true, tenant, pendingInvitations: [{ tenantId: tenant.tenantId, invitationVersion: 8 }] });
    return json(403, { code: "PENDING_INVITATION" });
  });
  const Shell = ({ children }) => ui.React.createElement("section", null, children);
  const Login = () => {
    const signIn = ui.useIdentityBffSignIn({ surface: "employee", t, onAuthenticated: () => assert.fail("stale invitation cannot sign in") });
    return ui.React.createElement(ui.SignInFailureCard, { signIn, Shell });
  };
  const view = await render(Login);
  assert.equal(calls.some((url) => url.includes("_accept")), false);
  await click(button(view, "Accept invitation"));
  assert.ok(calls.includes("/identity/v1/workspace-invitations/_accept?surface=employee"));
  assert.match(text(view.root.findByProps({ role: "alert" })), /expired or changed/);
  assert.ok(button(view, "Try again"));
  view.unmount();
});

test("after an unconfirmed sign-out the login page warns instead of re-establishing the session", async () => {
  const calls = [];
  const { stored } = browser("employee", async (url) => {
    calls.push(url);
    if (url.includes("/session")) return json(200, { authenticated: true, tenant });
    return json(200, { access_token: "prev-user-token", UserRequest: { uuid: "prev", tenantId: tenant.tenantId, type: "EMPLOYEE", roles: [] } });
  });
  const flags = new Map([["identityBff.signOutIncomplete", "1"]]);
  // Set by a sign-out in another tab: localStorage reaches this one.
  window.localStorage = { getItem: (k) => flags.get(k) ?? null, setItem: (k, v) => flags.set(k, v), removeItem: (k) => flags.delete(k) };
  let signedIn = 0;
  let signedOut = 0;
  Digit.UserService.logout = async () => { signedOut += 1; };
  const Shell = ({ children }) => ui.React.createElement("section", null, children);
  const Login = () => {
    const signIn = ui.useIdentityBffSignIn({ surface: "employee", t, onAuthenticated: () => { signedIn += 1; } });
    return ui.React.createElement(ui.SignInFailureCard, { signIn, Shell });
  };
  const view = await render(Login);
  assert.deepEqual(calls, []);
  assert.equal(signedIn, 0);
  assert.match(text(view.root.findByProps({ role: "alert" })), /Sign-out may not have finished/);
  await click(button(view, "Try signing out again"));
  assert.equal(signedOut, 1);
  assert.equal(flags.has("identityBff.signOutIncomplete"), true);
  // An explicit sign-in clears the flag and goes through Keycloak (prompt=login)
  // instead of reusing a cookie the failed sign-out may have left.
  await click(button(view, "Sign in"));
  assert.equal(flags.has("identityBff.signOutIncomplete"), false);
  assert.deepEqual(calls, []);
  assert.match(stored.redirect, /\/identity\/v1\/authorize\?/);
  view.unmount();
});

for (const surface of ["employee", "citizen"]) {
  test(`${surface} profile keeps identity fields read-only and offers account settings without BFF reads`, async () => {
    browser(surface, () => assert.fail("profile page must not depend on the BFF"));
    const view = await render(ui.Profile, { userType: surface, stateCode: "ke", cityDetails: { name: "Bomet" } });
    const email = view.root.findAllByType("input").find((node) => node.props.id === "profile-email");
    assert.equal(email.props.readOnly, true);
    const phone = view.root.findAllByType("input").find((node) => node.props.id === "profile-mobile");
    if (surface === "employee") assert.equal(phone.props.readOnly, true);
    assert.ok(button(view, "Account and security"));
    assert.equal(button(view, "Change password"), undefined);
    view.unmount();
  });
}


test("logout dialog keeps a failed sign-out visible for retry", async () => {
  browser("employee", () => assert.fail("dialog delegates to UserService"));
  const view = await render(ui.LogoutDialog, { onSelect: async () => { throw new Error("offline"); } });
  await click(button(view, "CORE_LOGOUT_CONFIRM_ACTION"));
  assert.match(text(view.root.findByProps({ role: "alert" })), /could not be completed/);
  assert.equal(button(view, "CORE_LOGOUT_CONFIRM_ACTION").props.isDisabled, false);
  view.unmount();
});

// Medium 4 (Dhruv, #2271 review 2): a login page reached on a tenantless
// /digit-ui/... URL (legacy ingress, preserved vhost, Kong /digit-ui) has no
// route tenant. It used to throw a TypeError reading tenant.appBasePath.
// An unconfirmed earlier sign-out must not replace that card (Dhruv, #2271 review 4).
for (const [surface, page] of [["employee", "EmployeeLogin"], ["citizen", "CitizenLogin"]]) for (const flagged of [false, true]) {
  test(`tenantless ${surface} login asks for the organisation's link instead of crashing${flagged ? " (sign-out incomplete)" : ""}`, async () => {
    const calls = [];
    const state = browser(surface, async (url) => { calls.push(url); return json(500, {}); });
    if (flagged) state.stored["identityBff.signOutIncomplete"] = "1";
    delete window.__digitTenantContext;
    window.location.pathname = surface === "citizen" ? "/digit-ui/citizen/login" : "/digit-ui/employee/user/login";
    const view = await render(ui[page], { t });
    const shown = text(view.root);
    assert.match(shown, /Choose your organisation/);
    assert.match(shown, /your organisation's own link/);
    assert.deepEqual(calls, [], "no Identity BFF call without a route tenant");
    assert.equal(state.stored.redirect, undefined, "no sign-in redirect without a route tenant");
    view.unmount();
  });
}
