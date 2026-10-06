const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// D16 (amended): a root workspace route may hold an EMPLOYEE session whose
// token sits at a child tenant; citizens are unchanged.
const OUT = path.join(os.tmpdir(), `session-tenant.cjs.${process.pid}.js`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../packages/libraries/src/services/tenant/sessionTenant.js")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  logLevel: "error",
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});
const { employeeTenantForRoute, isTenantWithin, sessionBelongsToRoute } = require(OUT);

const ROOT = Object.freeze({ tenantId: "ke", rootTenantId: "ke" });
const CITY = Object.freeze({ tenantId: "ke.bomet", rootTenantId: "ke" });
const employee = (tenantId) => ({ type: "EMPLOYEE", tenantId });
const citizen = (tenantId) => ({ type: "CITIZEN", tenantId });

test("a tenant is within itself and its children, never a prefix-sharing or another root", () => {
  assert.equal(isTenantWithin("ke", "ke"), true);
  assert.equal(isTenantWithin("ke.nairobi", "ke"), true);
  assert.equal(isTenantWithin("ke.nairobi.ward1", "ke"), true);
  for (const outside of ["kex", "kex.city", "pg", "pg.ke", "", null, undefined]) assert.equal(isTenantWithin(outside, "ke"), false, String(outside));
  assert.equal(isTenantWithin("ke", "ke.nairobi"), false);
  assert.equal(isTenantWithin("ke", ""), false);
});

test("an employee session at a child of the route tenant belongs to the route", () => {
  assert.equal(sessionBelongsToRoute(employee("ke"), ROOT), true);
  assert.equal(sessionBelongsToRoute(employee("ke.nairobi"), ROOT), true);
  assert.equal(sessionBelongsToRoute(JSON.stringify(employee("ke.nairobi")), ROOT), true);
  assert.equal(sessionBelongsToRoute({ userInfo: employee("ke.nairobi") }, ROOT), true);
  assert.equal(sessionBelongsToRoute(null, ROOT), true);
});

test("an employee session outside the route tenant's subtree is cleared", () => {
  for (const tenantId of ["kex", "kex.city", "pg", "pg.city"]) assert.equal(sessionBelongsToRoute(employee(tenantId), ROOT), false, tenantId);
  // A sibling city, or the parent, is not the route's subtree.
  assert.equal(sessionBelongsToRoute(employee("ke.nairobi"), CITY), false);
  assert.equal(sessionBelongsToRoute(employee("ke"), CITY), false);
});

test("citizens are unchanged: the route tenant or its root only, never a child", () => {
  assert.equal(sessionBelongsToRoute(citizen("ke"), CITY), true);
  assert.equal(sessionBelongsToRoute(citizen("ke.bomet"), CITY), true);
  assert.equal(sessionBelongsToRoute(citizen("ke.nairobi"), ROOT), false);
  assert.equal(sessionBelongsToRoute(citizen("ke.bomet.ward1"), CITY), false);
  assert.equal(sessionBelongsToRoute({ tenantId: "ke.nairobi" }, ROOT), false);
});

test("business calls use the employee's own tenant when it is the route tenant or a child", () => {
  assert.equal(employeeTenantForRoute(employee("ke.nairobi"), "ke"), "ke.nairobi");
  assert.equal(employeeTenantForRoute(JSON.stringify(employee("ke.nairobi")), "ke"), "ke.nairobi");
  assert.equal(employeeTenantForRoute(employee("ke"), "ke"), "ke");
  // Signed out, a citizen, or a tenant outside the route: the route tenant.
  assert.equal(employeeTenantForRoute(undefined, "ke"), "ke");
  assert.equal(employeeTenantForRoute(citizen("ke"), "ke.bomet"), "ke.bomet");
  assert.equal(employeeTenantForRoute(employee("kex.city"), "ke"), "ke");
  assert.equal(employeeTenantForRoute(employee("ke"), "ke.bomet"), "ke.bomet");
});
