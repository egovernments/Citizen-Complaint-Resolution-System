// ours (#1857): File a Complaint at a county-layout state asks "in which county?" first and lists only the counties
// the user can enter (coordinator 2026-10-15). Run from digit-ui-esbuild/:  node --test tests/countyFirst.test.js
// Needs patch 07 (Digit.Utils.tenantScope) applied for the scope rule; the stubs below stand in for React.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// React and react-i18next stand-ins (esbuild alias): CountyFirst's helpers are plain functions
const STUBS = fs.mkdtempSync(path.join(os.tmpdir(), "county-first-stubs-"));
fs.writeFileSync(path.join(STUBS, "react.js"), "module.exports = { createElement(){return null}, useMemo(f){return f()}, useState(v){return [v,()=>{}]}, useEffect(){} };");
fs.writeFileSync(path.join(STUBS, "i18n.js"), "module.exports = { useTranslation(){ return { t: (k) => k }; } };");

function load(entry) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "county-first-")), "mod.cjs");
  esbuild.buildSync({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent",
    loader: { ".js": "jsx" }, alias: { react: path.join(STUBS, "react.js"), "react-i18next": path.join(STUBS, "i18n.js") } });
  return require(out);
}

const scopeFile = path.join(__dirname, "../packages/libraries/src/utils/tenantScope.js");

test("the picker lists only the counties the user can enter", { skip: !fs.existsSync(scopeFile) && "patch 07 not applied" }, () => {
  const tenantScope = load(scopeFile);
  const tenants = ["ke", "ke.bomet", "ke.nairobi", "pg.citya"].map((code) => ({ code }));
  let roles = [{ code: "SUPERUSER", tenantId: "ke" }];
  global.Digit = { Utils: { tenantScope }, SessionStorage: { get: (k) => (k === "initData" ? { tenants } : null) }, UserService: { getUser: () => ({ info: { roles } }) } };
  const { stateCounties, asksAtRoot } = load(path.join(__dirname, "../products/pgr/src/pages/employee/CreateComplaint/CountyFirst.js"));
  assert.deepEqual(stateCounties("ke").map((c) => c.code), ["ke.bomet", "ke.nairobi"]);
  roles = [{ code: "GRO", tenantId: "ke.nairobi" }];
  assert.deepEqual(stateCounties("ke").map((c) => c.code), ["ke.nairobi"], "a county user: their county only");
  roles = [];
  assert.deepEqual(stateCounties("ke"), []);
  // #1857 follow-up: a state root with counties asks even with a tree of its own (staging-2); below the root it does not
  assert.equal(asksAtRoot("ke", [{ code: "ke.bomet" }]), true);
  assert.equal(asksAtRoot("ke", []), false);
  assert.equal(asksAtRoot("ke.bomet", [{ code: "ke.bomet.x" }]), false);
});

test("the create-complaint route goes through CountyFirst after the access guard", () => {
  const src = fs.readFileSync(path.join(__dirname, "../products/pgr/src/pages/employee/index.js"), "utf8");
  assert.match(src, /import CountyFirst from "\.\/CreateComplaint\/CountyFirst"/);
  assert.match(src, /offersCreateComplaint\(data\?\.actions\) \|\| menuOffersCreate\(t\)\s*\? <CountyFirst component=\{Component\} \/>/);
  assert.match(src, /getPGREmployeeLinks\(t\)\.some\(\(link\) => link\.key === "create"\)/, "the same rule as the menu's File a Complaint");
  const cf = fs.readFileSync(path.join(__dirname, "../products/pgr/src/pages/employee/CreateComplaint/CountyFirst.js"), "utf8");
  assert.match(cf, /boundary-hierarchy-definition\/_search/, "a tenant with its own hierarchy keeps the form");
  assert.match(cf, /\/digit-ui\/employee\/pgr\/create-complaint/);
});
