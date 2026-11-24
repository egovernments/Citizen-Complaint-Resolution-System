// #224 (VAPT "Insecure Session Management"): an employee's login lives in THIS
// browser tab only. Closing the tab or the browser must end it, and no token or
// personal detail may be left in localStorage, which every tab shares and which
// survives a browser restart. A citizen's login follows the same rule
// (citizenSession.test.js); the employee purge itself still leaves a citizen's
// keys to the citizen purge.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/employeeSession.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports });
const { saveEmployeeLogin, purgeLegacyEmployeeAuth, bootUserFromLocal, EMPLOYEE_TAB_KEYS } = mod.exports;

const store = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
};

const EMPLOYEE = { uuid: "e-1", userName: "GRO1", type: "EMPLOYEE", tenantId: "ke.bomet", mobileNumber: "0700000001", emailId: "gro@x.ke" };
const CITIZEN = { uuid: "c-1", userName: "0711111111", type: "CITIZEN", tenantId: "ke" };
const read = (s) => path.join(ROOT, s);
const src = (s) => fs.readFileSync(read(s), "utf8");

/* ---------------- saving a login ---------------- */

test("employee login: no token or personal data is written to localStorage", () => {
  const tab = store();
  const local = store();
  saveEmployeeLogin({ tab, local, userObject: EMPLOYEE, token: "emp-tok", locale: "en_IN" });
  const keys = Object.keys(local.dump());
  for (const k of ["token", "Employee.token", "user-info", "Employee.user-info", "citizen.userRequestObject"]) {
    assert.ok(!keys.includes(k), `${k} must not be in localStorage`);
  }
  assert.ok(!JSON.stringify(local.dump()).includes("emp-tok"), "the token value must not appear anywhere in localStorage");
  assert.ok(!JSON.stringify(local.dump()).includes("0700000001"), "the mobile number must not appear in localStorage");
});

test("employee login: token and user details are kept in the tab (sessionStorage)", () => {
  const tab = store();
  saveEmployeeLogin({ tab, local: store(), userObject: EMPLOYEE, token: "emp-tok", locale: "en_IN" });
  assert.strictEqual(tab.getItem("Employee.token"), "emp-tok");
  assert.strictEqual(tab.getItem("token"), "emp-tok");
  assert.strictEqual(JSON.parse(tab.getItem("Employee.user-info")).uuid, "e-1");
  assert.strictEqual(JSON.parse(tab.getItem("user-info")).uuid, "e-1");
  assert.deepStrictEqual([...EMPLOYEE_TAB_KEYS].sort(), ["Employee.token", "Employee.user-info", "token", "user-info"]);
});

test("employee login: non-secret preferences (tenant, language) still persist", () => {
  const local = store();
  saveEmployeeLogin({ tab: store(), local, userObject: EMPLOYEE, token: "emp-tok", locale: "sw_KE" });
  assert.strictEqual(local.getItem("Employee.tenant-id"), "ke.bomet");
  assert.strictEqual(local.getItem("tenant-id"), "ke.bomet");
  assert.strictEqual(local.getItem("Employee.locale"), "sw_KE");
  assert.strictEqual(local.getItem("locale"), "sw_KE");
});

test("employee login: resets the idle clock shared by the employee's tabs (a timestamp, no credential)", () => {
  const local = store({ "Digit.EmployeeLastActivity": "1" });
  const before = Date.now();
  saveEmployeeLogin({ tab: store(), local, userObject: EMPLOYEE, token: "emp-tok", locale: "en_IN" });
  const t = Number(local.getItem("Digit.EmployeeLastActivity"));
  assert.ok(t >= before && t <= Date.now(), "login counts as activity, so a new session never starts out stale");
});

test("employee login: a token left behind by an older build is removed", () => {
  const local = store({ "Employee.token": "old", "Employee.user-info": JSON.stringify(EMPLOYEE), token: "old", "user-info": JSON.stringify(EMPLOYEE), "Employee.refresh-token": "r" });
  saveEmployeeLogin({ tab: store(), local, userObject: EMPLOYEE, token: "new", locale: "en_IN" });
  for (const k of ["Employee.token", "Employee.user-info", "Employee.refresh-token", "token", "user-info"]) {
    assert.strictEqual(local.getItem(k), null, `${k} should be gone`);
  }
});

/* ---------------- cleaning up old builds' leftovers ---------------- */

test("purge: removes every employee credential from localStorage", () => {
  const local = store({
    "Employee.token": "t", "Employee.user-info": JSON.stringify(EMPLOYEE), "Employee.refresh-token": "r",
    token: "t", "user-info": JSON.stringify(EMPLOYEE), "citizen.userRequestObject": JSON.stringify(EMPLOYEE),
    "Employee.tenant-id": "ke.bomet", locale: "en_IN",
  });
  purgeLegacyEmployeeAuth(local);
  assert.deepStrictEqual(Object.keys(local.dump()).sort(), ["Employee.tenant-id", "locale"]);
});

test("purge: a signed-in citizen's localStorage session is untouched", () => {
  const seed = { token: "cit", "Citizen.token": "cit", "user-info": JSON.stringify(CITIZEN), "Citizen.user-info": JSON.stringify(CITIZEN), "citizen.userRequestObject": JSON.stringify(CITIZEN) };
  const local = store(seed);
  purgeLegacyEmployeeAuth(local);
  assert.deepStrictEqual(local.dump(), seed);
});

test("purge: employee keys go even while a citizen is signed in, and the citizen stays", () => {
  const local = store({ token: "cit", "Citizen.token": "cit", "user-info": JSON.stringify(CITIZEN), "Employee.token": "emp", "Employee.user-info": JSON.stringify(EMPLOYEE) });
  purgeLegacyEmployeeAuth(local);
  assert.strictEqual(local.getItem("Employee.token"), null);
  assert.strictEqual(local.getItem("Employee.user-info"), null);
  assert.strictEqual(local.getItem("token"), "cit");
  assert.strictEqual(JSON.parse(local.getItem("user-info")).type, "CITIZEN");
});

test("purge: an empty or blocked store never throws", () => {
  assert.doesNotThrow(() => purgeLegacyEmployeeAuth(store()));
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => purgeLegacyEmployeeAuth(blocked));
});

/* ---------------- what a NEW tab starts with ---------------- */

test("new tab: an employee is never restored from localStorage (closing the tab ends the login)", () => {
  const local = store({ token: "emp", "Employee.token": "emp", "Employee.user-info": JSON.stringify(EMPLOYEE) });
  const boot = bootUserFromLocal(local);
  assert.strictEqual(boot.user.access_token, null);
  assert.strictEqual(boot.user.token, null);
  assert.strictEqual(boot.user.info, null);
});

test("new tab: a citizen is not restored from localStorage either", () => {
  const local = store({ token: "cit", "Citizen.token": "cit", "Citizen.user-info": JSON.stringify(CITIZEN) });
  const boot = bootUserFromLocal(local);
  assert.strictEqual(boot.userType, "citizen");
  assert.strictEqual(boot.user.access_token, null);
  assert.strictEqual(boot.user.info, null);
});

test("new tab: a fresh browser keeps the old empty-session shape", () => {
  const boot = bootUserFromLocal(store());
  assert.strictEqual(boot.userType, "citizen");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(boot.user)), { token: null, access_token: null, info: null });
});

/* ---------------- the code that uses it ---------------- */

const LOGIN_FILES = ["packages/modules/core/src/pages/employee/Login/login.js", "packages/modules/core/src/pages/employee/Otp/index.js"];

for (const f of LOGIN_FILES) {
  test(`${path.basename(path.dirname(f))}: employee login goes through saveEmployeeLogin, not localStorage`, () => {
    const s = src(f);
    assert.match(s, /saveEmployeeLogin\(/);
    assert.doesNotMatch(s, /localStorage\.setItem\(\s*["'](token|Employee\.token|user-info|Employee\.user-info|citizen\.userRequestObject)["']/);
  });
}

test("app start-up (DIGIT login): uses bootUserFromLocal and purges leftovers, never reads Employee.token from localStorage", () => {
  const s = src("src/index.js");
  const digitBranch = s.slice(s.indexOf("} else {", s.indexOf("if (isKeycloakAuth())")), s.indexOf("normalizeLocale();", s.indexOf("if (isKeycloakAuth())")));
  assert.match(digitBranch, /bootUserFromLocal\(/);
  assert.match(digitBranch, /purgeLegacyEmployeeAuth\(/);
  assert.doesNotMatch(digitBranch, /getFromStorage\("Employee\.(token|user-info)"\)/);
});
