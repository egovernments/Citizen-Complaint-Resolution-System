// The header's working context counts and lists the roles the person HOLDS, not the role contexts (ours, 2026-10-15:
// a state admin with 12 roles read "2 roles" - the two contexts Resolver and Admin).
// Run from digit-ui-esbuild/:  node --test tests/workingContextRoles.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/modules/core/src/components/TopBarSideBar/workingContextRoles.js");

function load() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wc-roles-")), "mod.cjs");
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent" });
  return require(out);
}

// GET pgr-services/v2/employee/_context for digit-3's state admin test persona, 2026-10-15 04:5xZ
const STATE_ADMIN = {
  tenantId: "ke",
  roles: ["ACCOUNT_ADMIN", "CSR", "DGRO", "EMPLOYEE", "GRO", "HRMS_ADMIN", "LOC_ADMIN", "MDMS_ADMIN", "PGR_LME", "PGR_VIEWER", "SUPERUSER", "SUPERVISOR"].map((code) => ({ code })),
  roleContexts: ["RESOLVER", "ADMIN"],
};

test("a state admin's roles are the 11 it holds (EMPLOYEE aside), not its 2 role contexts", () => {
  const { heldRoleCodes, workingContexts } = load();
  const roles = heldRoleCodes(STATE_ADMIN);
  assert.equal(roles.length, 11);
  for (const r of ["ACCOUNT_ADMIN", "MDMS_ADMIN", "SUPERUSER", "GRO", "CSR", "PGR_LME", "HRMS_ADMIN"]) assert.ok(roles.includes(r), r);
  assert.ok(!roles.includes("EMPLOYEE"));
  assert.deepEqual(workingContexts(STATE_ADMIN), ["RESOLVER", "ADMIN"]);
});

test("never an assignment: EMPLOYEE, CITIZEN, the service role; duplicates once; string or {code} roles", () => {
  const { heldRoleCodes, workingContexts } = load();
  assert.deepEqual(heldRoleCodes({ roles: ["EMPLOYEE", { code: "CITIZEN" }, { code: "INTERNAL_MICROSERVICE_ROLE" }, { code: "gro" }, "GRO"] }), ["GRO"]);
  assert.deepEqual(heldRoleCodes({}), []);
  assert.deepEqual(workingContexts({ roleContexts: ["CITIZEN", "RESOLVER"] }), ["RESOLVER"]);
});

test("the component counts and lists heldRoleCodes, and shows the contexts as their own row", () => {
  const src = fs.readFileSync(path.join(__dirname, "../packages/modules/core/src/components/TopBarSideBar/EmployeeWorkingContext.js"), "utf8");
  assert.match(src, /from "\.\/workingContextRoles"/);
  assert.match(src, /const roles = assignedRoleLabels\(t, context\);/);
  assert.match(src, /CS_WORKING_CONTEXT_WORKS_AS/);
  assert.doesNotMatch(src, /const contexts = \(context\?\.roleContexts/, "contexts no longer stand in for roles");
});
