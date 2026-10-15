// Pins that every employee created from the employee UI gets CSR, so they can
// file a complaint on a citizen's behalf (#2239).
// Run from digit-ui-esbuild/:  node --test tests/hrmsCreateCsr.test.js
//
// HRMS.js is ESM and posts through Request, so the test bundles it to CJS with
// the repo's own esbuild and swaps Request for a stub that returns its options.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/libraries/src/services/elements/HRMS.js");
const OUT = path.join(os.tmpdir(), `hrmsCreateCsr.cjs.${process.pid}.js`);
const stubRequest = {
  name: "stub-request",
  setup(build) {
    build.onResolve({ filter: /Utils\/Request$/ }, () => ({ path: "request-stub", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const Request = (options) => options;", loader: "js" }));
  },
};
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

let HrmsService;
before(async () => {
  await esbuild.build({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: OUT, logLevel: "silent", plugins: [stubRequest] });
  // urls.js reads window.globalConfigs when it loads.
  global.window = {};
  HrmsService = require(OUT).default;
});

const sentRoles = (roles) =>
  HrmsService.create({ Employees: [{ tenantId: "ke", code: "E1", user: { tenantId: "ke", roles } }] }, "ke").data.Employees[0].user.roles;

test("create adds CSR to the roles the admin picked", () => {
  const roles = sentRoles([{ code: "GRO", name: "Complaint Assessor", tenantId: "ke" }]);
  assert.deepEqual(roles.map((role) => role.code), ["GRO", "CSR"]);
  assert.equal(roles[1].tenantId, "ke");
});

test("create does not add CSR twice", () => {
  assert.deepEqual(sentRoles([{ code: "CSR", name: "Complainant", tenantId: "ke" }]).map((role) => role.code), ["CSR"]);
});

test("create adds CSR on each jurisdiction tenant the roles are tagged with", () => {
  const roles = sentRoles([
    { code: "GRO", name: "Complaint Assessor", tenantId: "pg.cityb" },
    { code: "PGR_LME", name: "Last Mile Employee", tenantId: "pg.cityc" },
  ]);
  assert.deepEqual(roles.map((role) => `${role.code}@${role.tenantId}`), ["GRO@pg.cityb", "PGR_LME@pg.cityc", "CSR@pg.cityb", "CSR@pg.cityc"]);
});

test("CSR on another tenant does not count", () => {
  const roles = sentRoles([{ code: "CSR", name: "Complainant", tenantId: "pg.cityb" }, { code: "GRO", name: "Complaint Assessor", tenantId: "ke" }]);
  assert.deepEqual(roles.map((role) => `${role.code}@${role.tenantId}`), ["CSR@pg.cityb", "GRO@ke", "CSR@ke"]);
});

test("the edit form keeps CSR: it loads each jurisdiction's roles by tenant", () => {
  // EditForm.js builds each jurisdiction's roles as user.roles.filter((r) => r.tenantId == boundary)
  // and saves only those, so a role on any other tenant is dropped on the next edit.
  const created = HrmsService.create(
    { Employees: [{ tenantId: "pg.citya", jurisdictions: [{ boundary: "pg.cityb" }], user: { tenantId: "pg.citya", roles: [{ code: "GRO", name: "Complaint Assessor", tenantId: "pg.cityb" }] } }] },
    "pg.citya"
  ).data.Employees[0];
  const kept = created.jurisdictions.flatMap((j) => created.user.roles.filter((role) => role.tenantId == j.boundary));
  assert.ok(kept.some((role) => role.code === "CSR"));
});

test("an employee with no roles gets CSR on their own tenant", () => {
  assert.deepEqual(sentRoles([]).map((role) => `${role.code}@${role.tenantId}`), ["CSR@ke"]);
});

test("update leaves the roles as the admin set them", () => {
  const data = { Employees: [{ tenantId: "ke", code: "E1", user: { tenantId: "ke", roles: [{ code: "GRO" }] } }] };
  assert.equal(HrmsService.update(data, "ke").data, data);
});
