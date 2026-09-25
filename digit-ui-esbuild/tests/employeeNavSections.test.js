// Pins where module sections land in the employee sidebar, and that a route
// offered by a section is never listed twice.
// Run from digit-ui-esbuild/:  node --test tests/employeeNavSections.test.js
//
// navSections.js is ESM, so the test bundles it to CJS with the repo's own
// esbuild, the same idiom as the dashboard's layoutConfig tests.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(
  __dirname,
  "../packages/modules/core/src/components/TopBarSideBar/SideBar/navSections.js"
);
const OUT = path.join(os.tmpdir(), `navSections.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { insertModuleSections, isCitizenHome } = require(OUT);

const HOME = { label: "Home", navigationUrl: "/digit-ui/employee", icon: { icon: "Home" } };
const DASHBOARD = { label: "Dashboard", navigationUrl: "/digit-ui/employee/dashboard", icon: { icon: "Dashboard" } };
const COMPLAINTS = {
  key: "pgr",
  label: "Complaints",
  items: [
    { key: "create", label: "Create Complaint", navigationUrl: "/digit-ui/employee/pgr/create-complaint", icon: "NoteAdd" },
    { key: "search", label: "Search Complaint", navigationUrl: "/digit-ui/employee/pgr/inbox-v2", icon: "Search" },
  ],
};

test("a section lands directly after Home", () => {
  const out = insertModuleSections([HOME, DASHBOARD], [COMPLAINTS]);
  assert.deepEqual(out.map((i) => i.label), ["Home", "Complaints", "Dashboard"]);
  assert.equal(out[1].type, "section");
  assert.deepEqual(out[1].children.map((c) => c.navigationUrl), COMPLAINTS.items.map((r) => r.navigationUrl));
});

test("rows carry SideNav's icon shape", () => {
  const [, section] = insertModuleSections([HOME], [COMPLAINTS]);
  assert.deepEqual(section.children[0].icon, { icon: "NoteAdd", width: "1.5rem", height: "1.5rem" });
});

test("Home with a trailing slash still anchors the section", () => {
  const home = { ...HOME, navigationUrl: "/digit-ui/employee/" };
  const out = insertModuleSections([home, DASHBOARD], [COMPLAINTS]);
  assert.deepEqual(out.map((i) => i.label), ["Home", "Complaints", "Dashboard"]);
});

test("without a Home row the section goes first", () => {
  const out = insertModuleSections([DASHBOARD], [COMPLAINTS]);
  assert.deepEqual(out.map((i) => i.label), ["Complaints", "Dashboard"]);
});

test("an access-control row for a section's route is dropped, not duplicated", () => {
  const acSearch = { label: "Search Complaint", navigationUrl: "/digit-ui/employee/pgr/inbox-v2/" };
  const out = insertModuleSections([HOME, acSearch, DASHBOARD], [COMPLAINTS]);
  assert.deepEqual(out.map((i) => i.label), ["Home", "Complaints", "Dashboard"]);
});

test("a group emptied by that de-duplication is removed with it", () => {
  const group = { label: "PGR", children: [{ label: "Create", navigationUrl: "/digit-ui/employee/pgr/create-complaint" }] };
  const out = insertModuleSections([HOME, group, DASHBOARD], [COMPLAINTS]);
  assert.deepEqual(out.map((i) => i.label), ["Home", "Complaints", "Dashboard"]);
});

test("no usable sections leaves the items untouched", () => {
  const items = [HOME, DASHBOARD];
  assert.equal(insertModuleSections(items, []), items);
  assert.equal(insertModuleSections(items, [null, { key: "x", label: "X", items: [] }]), items);
});

test("the citizen app anchors on its own Home", () => {
  const home = { label: "Home", navigationUrl: "/digit-ui/citizen/all-services" };
  const helpline = { label: "Helpline", navigationUrl: "tel:0700000000" };
  const out = insertModuleSections([home, helpline], [COMPLAINTS], isCitizenHome);
  assert.deepEqual(out.map((i) => i.label), ["Home", "Complaints", "Helpline"]);
});
