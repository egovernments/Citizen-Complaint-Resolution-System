// #224: once the employee login lives in the tab (sessionStorage), every piece of
// code that used to read it from localStorage must read the tab instead, or it
// silently sees "not signed in". These tests pin that, plus the matching
// server-side setting (token life 8 hours) and the logout clean-up.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------------- no employee credential is read from localStorage ---------------- */

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === "node_modules" || d.name === "build" || d.name === "dist") return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(js|jsx|ts|tsx)$/.test(d.name) && !/\.test\./.test(d.name) ? [p] : [];
  });

// Keycloak mode keeps its own adapter (out of scope for #224, DIGIT login only);
// sessionCollision only compares the shared citizen/legacy keys and never trusts them.
const ALLOWED = ["packages/libraries/src/services/auth/KeycloakAuthAdapter.js", "packages/libraries/src/services/atoms/Utils/sessionCollision.js"];

// A localStorage read of the employee token/identity is only allowed as a
// Keycloak fallback AFTER the tab copy, on the same line:
//   sessionStorage.getItem("Employee.token") || localStorage.getItem("Employee.token")
// (In DIGIT mode start-up has already removed any localStorage copy.)
const LOCAL_READ = /localStorage\??\.getItem\(\s*(["'`]Employee\.(token|user-info)["'`]|localStorageKey)\s*\)/;
const isTabFirst = (line) => /sessionStorage\??\.getItem\([^)]*\)\s*\|\|\s*(window\.)?localStorage/.test(line);

test("no app code reads Employee.token / Employee.user-info from localStorage except as a fallback after the tab", () => {
  const offenders = [];
  for (const dir of ["packages", "products", "src"]) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.includes(rel)) continue;
      const s = fs.readFileSync(file, "utf8");
      if (/localStorageKey/.test(s) && !/localStorageKey\s*=\s*["']Employee\.token["']/.test(s)) continue;
      s.split("\n").forEach((line, i) => {
        if (LOCAL_READ.test(line) && !isTabFirst(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepStrictEqual(offenders, []);
});

// The same for a citizen's login (tab-only too): Citizen.token, Citizen.user-info
// and the shared user-info alias are read from the tab first.
const CITIZEN_LOCAL_READ = /localStorage\??\.getItem\(\s*["'`](Citizen\.(token|user-info)|user-info)["'`]\s*\)/;

test("no app code reads Citizen.token / Citizen.user-info / user-info from localStorage except as a fallback after the tab", () => {
  const offenders = [];
  for (const dir of ["packages", "products", "src"]) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.includes(rel)) continue;
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (CITIZEN_LOCAL_READ.test(line) && !isTabFirst(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test("dashboard sidebar, catalog and locale runtime read the employee from the tab", () => {
  for (const f of ["products/dashboard/src/components/Sidebar.jsx", "products/dashboard/src/hooks/useCatalog.js", "products/dashboard/src/i18n/localeRuntime.js"]) {
    assert.match(read(f), /sessionStorage\??\.getItem\(\s*["']Employee\.(user-info|token)["']/, f);
  }
});

test("utilities IFrame pages take the employee token from the tab first (Keycloak falls back)", () => {
  for (const f of ["packages/modules/utilities/src/pages/employee/IFrameInterface/index.js", "packages/modules/utilities/src/pages/employee/IFrameInterface/RenderCustom.js"]) {
    const s = read(f);
    const reads = s.split("\n").filter((l) => /getItem\(localStorageKey\)/.test(l));
    assert.ok(reads.length > 0, f);
    for (const l of reads) assert.ok(isTabFirst(l), `${f}: ${l.trim()}`);
  }
});

test("the side menu still shows Logout for an employee signed in this tab", () => {
  assert.match(read("packages/digit-ui-components/src/atoms/Hamburger.js"), /sessionStorage\.getItem\("token"\)\s*\|\|\s*localStorage\.getItem\("token"\)/);
});

/* ---------------- dashboard session lives in the tab ---------------- */

function loadDashboardAuth() {
  const out = path.join(os.tmpdir(), `authService.224.${process.pid}.js`);
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "products/dashboard/src/services/authService.js")],
    bundle: true, format: "cjs", platform: "neutral", outfile: out,
    define: { "process.env.NODE_ENV": '"production"', "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""' },
  });
  const mk = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) }; };
  const localStorage = mk();
  const sessionStorage = mk();
  let user;
  global.window = { localStorage, sessionStorage, dispatchEvent: () => {}, Digit: { SessionStorage: { get: (k) => (k === "User" ? user : undefined), set: (k, v) => { if (k === "User") user = v; } } } };
  delete require.cache[out];
  const mod = require(out);
  fs.unlinkSync(out);
  return { mod, localStorage, sessionStorage };
}

test("dashboard sign-in stores its session in the tab, not in localStorage", () => {
  const { mod, localStorage, sessionStorage } = loadDashboardAuth();
  mod.persistSession({ accessToken: "dash-tok", refreshToken: "dash-ref", userInfo: { uuid: "e-1", roles: [] }, tenantId: "ke.bomet", claimAliases: true });
  assert.deepStrictEqual(localStorage.dump(), {});
  assert.strictEqual(mod.getEmployeeToken(), "dash-tok");
  assert.ok(sessionStorage.getItem("Employee.token"));
  assert.ok(sessionStorage.getItem("Employee.refresh-token"));
});

test("dashboard sees an employee signed in by the main login in this tab", () => {
  const { mod, sessionStorage } = loadDashboardAuth();
  sessionStorage.setItem("Employee.token", "main-tok");
  sessionStorage.setItem("Employee.user-info", JSON.stringify({ uuid: "e-1" }));
  assert.strictEqual(mod.getEmployeeToken(), "main-tok");
  assert.strictEqual(mod.getEmployeeInfo().uuid, "e-1");
  assert.ok(mod.hasAuth());
});

test("dashboard in Keycloak mode still finds the employee token Keycloak wrote to localStorage", () => {
  const { mod, localStorage } = loadDashboardAuth();
  localStorage.setItem("Employee.token", JSON.stringify("kc-tok"));
  localStorage.setItem("Employee.user-info", JSON.stringify({ uuid: "e-kc" }));
  assert.strictEqual(mod.getEmployeeToken(), "kc-tok");
  assert.strictEqual(mod.getEmployeeInfo().uuid, "e-kc");
});

test("dashboard never treats the citizen's localStorage aliases as its own, and sign-out leaves them alone", () => {
  const { mod, localStorage, sessionStorage } = loadDashboardAuth();
  localStorage.setItem("token", "cit");
  localStorage.setItem("Citizen.token", "cit");
  localStorage.setItem("user-info", JSON.stringify({ uuid: "c-1", type: "CITIZEN" }));
  mod.persistSession({ accessToken: "dash-tok", refreshToken: "r", userInfo: { uuid: "e-1", roles: [] }, claimAliases: true });
  mod.clearSession({ force: true });
  assert.strictEqual(localStorage.getItem("token"), "cit");
  assert.strictEqual(localStorage.getItem("Citizen.token"), "cit");
  assert.strictEqual(JSON.parse(localStorage.getItem("user-info")).uuid, "c-1");
  assert.strictEqual(sessionStorage.getItem("Employee.token"), null);
});

test("dashboard sign-out clears the tab session", () => {
  const { mod, sessionStorage } = loadDashboardAuth();
  mod.persistSession({ accessToken: "dash-tok", refreshToken: "r", userInfo: { uuid: "e-1", roles: [] }, claimAliases: true });
  mod.clearSession({ force: true });
  for (const k of ["Employee.token", "Employee.refresh-token", "Employee.user-info", "token", "user-info"]) assert.strictEqual(sessionStorage.getItem(k), null, k);
});

/* ---------------- an expired session clears the tab copy too ---------------- */

test("redirect-to-login clean-up removes this tab's employee keys", () => {
  const s = read("packages/libraries/src/services/atoms/Utils/authSession.js");
  const list = s.match(/const AUTH_SESSION_KEYS = \[([^\]]*)\]/);
  assert.ok(list, "AUTH_SESSION_KEYS list exists");
  for (const k of ["Employee.token", "Employee.user-info", "Employee.refresh-token", "token", "user-info", "Citizen.token", "Citizen.user-info", "Digit.citizen.userRequestObject"]) assert.ok(list[1].includes(`"${k}"`), k);
});

/* ---------------- server: token valid 8 hours, not 7 days ---------------- */

test("deploy config: access token valid for 480 minutes (8 hours)", () => {
  const env = fs.readFileSync(path.join(REPO, "devops/deploy-as-code/charts/environments/env.yaml"), "utf8");
  assert.match(env, /access-token-validity:\s*"?480"?/);
  assert.doesNotMatch(env, /access-token-validity:\s*"?10080"?/);
  for (const v of ["devops/deploy-as-code/charts/core-services/egov-user/values.yaml", "devops/deploy-as-code/charts/core-services/egov-user/egov-user-enc-values.yaml"]) {
    assert.match(fs.readFileSync(path.join(REPO, v), "utf8"), /^access-token-validity:\s*"480"/m, v);
  }
  // Every local compose file that DEFINES egov-user (has an image); override
  // files that only tweak it inherit the setting from the base file.
  const egovUserBlock = (s) => {
    const i = s.indexOf("\n  egov-user:\n");
    if (i < 0) return "";
    const next = s.slice(i + 14).search(/\n  [a-z][\w-]*:\n/);
    return next < 0 ? s.slice(i) : s.slice(i, i + 14 + next);
  };
  const composeFiles = fs.readdirSync(path.join(REPO, "local-setup")).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).map((f) => `local-setup/${f}`)
    .filter((f) => /\n    image:/.test(egovUserBlock(fs.readFileSync(path.join(REPO, f), "utf8"))));
  assert.ok(composeFiles.length >= 4, `found ${composeFiles}`);
  for (const f of composeFiles) {
    const user = egovUserBlock(fs.readFileSync(path.join(REPO, f), "utf8"));
    assert.match(user,/ACCESS_TOKEN_VALIDITY_IN_MINUTES:\s*"?\$?\{?[A-Z_]*:?-?480"?\}?"?/, f);
  }
});
