// #224 for citizens: a citizen's login lives in THIS browser tab only, like an
// employee's. Closing the tab or the browser must end it, and no token or
// personal detail may be left in localStorage, which every tab shares and which
// survives a browser restart. City and language preferences stay.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const load = (file) => {
  const { outputFiles } = esbuild.buildSync({ entryPoints: [path.join(ROOT, file)], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });
  const mod = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports });
  return mod.exports;
};
const { saveCitizenLogin, purgeLegacyCitizenAuth, CITIZEN_TAB_KEYS } = load("packages/libraries/src/services/atoms/Utils/citizenSession.js");
const { purgeLegacyEmployeeAuth, bootUserFromLocal } = load("packages/libraries/src/services/atoms/Utils/employeeSession.js");

const store = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
};
const CITIZEN = { uuid: "c-1", userName: "0711111111", name: "Asha", mobileNumber: "0711111111", type: "CITIZEN", tenantId: "ke" };
const EMPLOYEE = { uuid: "e-1", userName: "GRO1", type: "EMPLOYEE", tenantId: "ke.bomet" };
const src = (s) => fs.readFileSync(path.join(ROOT, s), "utf8");
const CREDENTIAL_KEYS = ["token", "Citizen.token", "user-info", "Citizen.user-info", "Citizen.refresh-token", "citizen.userRequestObject"];

/* ---------------- saving a login ---------------- */

test("citizen login: no token or personal data is written to localStorage", () => {
  const tab = store();
  const local = store();
  saveCitizenLogin({ tab, local, userObject: CITIZEN, token: "cit", tenantId: "ke", locale: "en_IN" });
  for (const k of CREDENTIAL_KEYS) assert.strictEqual(local.getItem(k), null, `${k} must not be in localStorage`);
  assert.ok(!JSON.stringify(local.dump()).includes("0711111111"), "no mobile number in localStorage");
});

test("citizen login: the token and details are kept in the tab", () => {
  const tab = store();
  saveCitizenLogin({ tab, local: store(), userObject: CITIZEN, token: "cit", tenantId: "ke", locale: "en_IN" });
  assert.strictEqual(tab.getItem("token"), "cit");
  assert.strictEqual(tab.getItem("Citizen.token"), "cit");
  assert.strictEqual(JSON.parse(tab.getItem("Citizen.user-info")).uuid, "c-1");
  assert.strictEqual(JSON.parse(tab.getItem("user-info")).uuid, "c-1");
  assert.deepStrictEqual([...CITIZEN_TAB_KEYS].sort(), ["Citizen.token", "Citizen.user-info", "token", "user-info"]);
});

test("citizen login: city and language preferences stay in localStorage", () => {
  const local = store();
  saveCitizenLogin({ tab: store(), local, userObject: CITIZEN, token: "cit", tenantId: "ke", locale: "sw_KE" });
  assert.strictEqual(local.getItem("Citizen.tenant-id"), "ke");
  assert.strictEqual(local.getItem("tenant-id"), "ke");
  assert.strictEqual(local.getItem("locale"), "sw_KE");
  assert.strictEqual(local.getItem("Citizen.locale"), "sw_KE");
});

test("citizen login: removes the credential an older build left in localStorage", () => {
  const local = store({
    token: "old", "Citizen.token": "old", "Citizen.refresh-token": "r", "user-info": JSON.stringify(CITIZEN),
    "Citizen.user-info": JSON.stringify(CITIZEN), "citizen.userRequestObject": JSON.stringify(CITIZEN), "Citizen.tenant-id": "ke",
  });
  saveCitizenLogin({ tab: store(), local, userObject: CITIZEN, token: "new", tenantId: "ke", locale: "en_IN" });
  for (const k of CREDENTIAL_KEYS) assert.strictEqual(local.getItem(k), null, k);
});

/* ---------------- cleaning up after older builds ---------------- */

test("purge: removes a citizen's leftover login and returns what it removed", () => {
  const local = store({ token: "cit", "Citizen.token": "cit", "user-info": JSON.stringify(CITIZEN), "Citizen.user-info": JSON.stringify(CITIZEN), "citizen.userRequestObject": "{}", locale: "en_IN" });
  const removed = purgeLegacyCitizenAuth(local);
  assert.deepStrictEqual([...removed].sort(), ["Citizen.token", "Citizen.user-info", "citizen.userRequestObject", "token", "user-info"]);
  assert.strictEqual(local.getItem("locale"), "en_IN");
});

test("purge: the shared aliases are left alone when they are not the citizen's", () => {
  const local = store({ token: "emp", "user-info": JSON.stringify(EMPLOYEE), "Citizen.token": "cit" });
  purgeLegacyCitizenAuth(local);
  assert.strictEqual(local.getItem("token"), "emp");
  assert.strictEqual(JSON.parse(local.getItem("user-info")).uuid, "e-1");
  assert.strictEqual(local.getItem("Citizen.token"), null);
});

test("purge: together with the employee purge, no credential of either kind is left", () => {
  const local = store({
    token: "cit", "Citizen.token": "cit", "user-info": JSON.stringify(CITIZEN), "Citizen.user-info": JSON.stringify(CITIZEN),
    "Employee.token": "emp", "Employee.user-info": JSON.stringify(EMPLOYEE), "Employee.tenant-id": "ke.bomet",
  });
  purgeLegacyEmployeeAuth(local);
  purgeLegacyCitizenAuth(local);
  assert.deepStrictEqual(local.dump(), { "Employee.tenant-id": "ke.bomet" });
});

test("purge: never throws, even when storage is blocked", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => purgeLegacyCitizenAuth(blocked));
});

/* ---------------- a new tab ---------------- */

test("new tab: a citizen is not restored from localStorage", () => {
  const local = store({ token: "cit", "Citizen.token": "cit", "Citizen.user-info": JSON.stringify(CITIZEN) });
  const boot = bootUserFromLocal(local);
  assert.strictEqual(boot.userType, "citizen");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(boot.user)), { token: null, access_token: null, info: null });
});

/* ---------------- the code that uses it ---------------- */

test("citizen login page goes through saveCitizenLogin, not localStorage", () => {
  const s = src("packages/modules/core/src/pages/citizen/Login/index.js");
  assert.match(s, /saveCitizenLogin\(/);
  assert.doesNotMatch(s, /localStorage\.setItem\(\s*["'](token|Citizen\.token|user-info|Citizen\.user-info|citizen\.userRequestObject)["']/);
});

test("app start-up (DIGIT login): purges a citizen's leftover login and never reads it back", () => {
  const s = src("src/index.js");
  const start = s.indexOf("if (isKeycloakAuth())");
  const digitBranch = s.slice(s.indexOf("} else {", start), s.indexOf("normalizeLocale();", start));
  assert.match(digitBranch, /purgeLegacyCitizenAuth\(/);
  assert.doesNotMatch(digitBranch, /getFromStorage\("(Citizen\.token|Citizen\.user-info|token)"\)/);
});
