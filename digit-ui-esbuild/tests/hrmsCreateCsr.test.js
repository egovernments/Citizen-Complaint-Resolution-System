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

test("update leaves the roles as the admin set them", () => {
  const data = { Employees: [{ tenantId: "ke", code: "E1", user: { tenantId: "ke", roles: [{ code: "GRO" }] } }] };
  assert.equal(HrmsService.update(data, "ke").data, data);
});
