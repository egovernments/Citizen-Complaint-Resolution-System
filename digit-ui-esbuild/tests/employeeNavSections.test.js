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
const { insertModuleSections, isCitizenHome, mdmsLinkRows, publicDashboardEnabled, withTenantSegment } = require(OUT);

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

// The shape processLinkData reads: rows grouped by parentModule, the first row
// carrying the sidebar marker and URL.
const LINK_DATA = {
  PGR: [{ sidebar: "digit-ui-links", sidebarURL: "/digit-ui/citizen/pgr-home", leftIcon: "PGRIcon" }],
  WS: [{ sidebar: "digit-ui-links", sidebarURL: "/digit-ui/citizen/ws-home" }],
  FAQ: [{ sidebar: "digit-ui-links", sidebarURL: "https://example.org/faq" }],
  TL: [{ sidebar: "digit-ui-card", sidebarURL: "/digit-ui/citizen/tl-home" }],
};

test("MDMS sidebar links become rows, skipping modules with their own section", () => {
  const rows = mdmsLinkRows(LINK_DATA, {
    contextPath: "digit-ui",
    labelFor: (code) => `ACTION_TEST_${code}`,
    hasOwnSection: (code) => code === "PGR",
  });
  assert.deepEqual(
    rows.map((r) => [r.label, r.navigationUrl]),
    [
      ["ACTION_TEST_WS", "/digit-ui/citizen/ws-home"],
      ["ACTION_TEST_FAQ", "https://example.org/faq"],
    ]
  );
});

test("MDMS rows keep a configured icon and fall back by kind", () => {
  const icons = Object.fromEntries(
    mdmsLinkRows(LINK_DATA, { contextPath: "digit-ui" }).map((r) => [r.navigationUrl, r.icon.icon])
  );
  assert.equal(icons["/digit-ui/citizen/pgr-home"], "PGRIcon");
  assert.equal(icons["/digit-ui/citizen/ws-home"], "Apps");
  assert.equal(icons["https://example.org/faq"], "OpenInNew");
});

test("no link data gives no rows", () => {
  assert.deepEqual(mdmsLinkRows(undefined, { contextPath: "digit-ui" }), []);
});

test("multi-root puts the tenant into citizen and employee routes", () => {
  assert.equal(withTenantSegment("/sandbox-ui/citizen/pgr/complaints", "sandbox-ui", "pg"), "/sandbox-ui/pg/citizen/pgr/complaints");
  assert.equal(withTenantSegment("/sandbox-ui/employee/pgr/inbox-v2", "sandbox-ui", "pg"), "/sandbox-ui/pg/employee/pgr/inbox-v2");
  assert.equal(withTenantSegment("/sandbox-ui/citizen", "sandbox-ui", "pg"), "/sandbox-ui/pg/citizen");
});

test("a route that already has the tenant, or is not an app route, is left alone", () => {
  assert.equal(withTenantSegment("/sandbox-ui/pg/citizen/pgr/complaints", "sandbox-ui", "pg"), "/sandbox-ui/pg/citizen/pgr/complaints");
  assert.equal(withTenantSegment("/sandbox-ui/citizenship", "sandbox-ui", "pg"), "/sandbox-ui/citizenship");
  assert.equal(withTenantSegment("/other/citizen/x", "sandbox-ui", "pg"), "/other/citizen/x");
  assert.equal(withTenantSegment("/sandbox-ui/citizen/x", "sandbox-ui", undefined), "/sandbox-ui/citizen/x");
});

test("the citizen rail offers the public dashboard only once it is published", () => {
  assert.equal(publicDashboardEnabled([{ id: "default", publicDashboardEnabled: true }]), true);
  // Never published, switched off, or anything short of an explicit true.
  assert.equal(publicDashboardEnabled([{ id: "default" }]), false);
  assert.equal(publicDashboardEnabled([{ id: "default", publicDashboardEnabled: false }]), false);
  assert.equal(publicDashboardEnabled([{ id: "default", publicDashboardEnabled: "true" }]), false);
  assert.equal(publicDashboardEnabled([]), false);
  assert.equal(publicDashboardEnabled(undefined), false);
  // The "default" record decides, as it does for pgr-services, wherever it sits.
  assert.equal(
    publicDashboardEnabled([{ id: "other", publicDashboardEnabled: false }, { id: "default", publicDashboardEnabled: true }]),
    true
  );
  assert.equal(publicDashboardEnabled([{ id: "other", publicDashboardEnabled: true }, null]), true);
});

test("on a tenant route MDMS rows match the app id and move onto the tenant route", () => {
  const rows = mdmsLinkRows(LINK_DATA, {
    contextPath: "digit-ui",
    rebaseUrl: (url) => url.replace(/^\/digit-ui\//, "/kd/digit-ui/"),
  });
  assert.deepEqual(rows.map((r) => r.navigationUrl), [
    "/kd/digit-ui/citizen/ws-home",
    "/kd/digit-ui/citizen/pgr-home",
    "https://example.org/faq",
  ]);
});

// useEmployeeNavItems builds the rows from MDMS actions that carry
// `/digit-ui/employee/...`. On a tenant route they must stay on the route.
const NAV_OUT = path.join(os.tmpdir(), `employeeNavItems.cjs.${process.pid}.js`);
process.on("exit", () => {
  try {
    fs.unlinkSync(NAV_OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
// Plugins need the async API, so this bundle is built inside its test.
const loadEmployeeNav = async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { useEmployeeNavItems } from "./modules/core/src/components/TopBarSideBar/SideBar/employeeNavItems.js";
        export { rebaseAppUrl } from "./libraries/src/services/tenant/tenantRoute.js";
      `,
      resolveDir: path.join(__dirname, "../packages"),
      loader: "js",
    },
    bundle: true,
    format: "cjs",
    platform: "neutral",
    outfile: NAV_OUT,
    plugins: [{ name: "i18n-double", setup(build) {
      build.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "double" }));
      build.onLoad({ filter: /.*/, namespace: "double" }, () => ({ contents: "export const useTranslation = () => ({ t: (k) => k });" }));
    } }],
  });
  return require(NAV_OUT);
};

test("on a tenant route the employee rows and section stay on the tenant route", async () => {
  const nav = await loadEmployeeNav();
  const action = (path, navigationURL, orderNumber) => ({ url: "url", path, displayName: path, navigationURL, orderNumber, leftIcon: "" });
  global.window = { __digitTenantContext: { appBasePath: "kd/digit-ui" }, contextPath: "kd/digit-ui", globalConfigs: { getConfig: () => undefined } };
  global.Digit = {
    Hooks: {
      useAccessControl: () => ({ isLoading: false, data: { actions: [
        action("Home", "/digit-ui/employee/", 1),
        action("Dashboard", "/digit-ui/employee/dashboard", 2),
        // The PGR section offers this route too, so the row is dropped.
        action("PGR.Search", "/digit-ui/employee/pgr/inbox-v2", 3),
      ] } }),
      useStore: { getInitData: () => ({ data: { modules: [{ code: "PGR" }] } }) },
    },
    ComponentRegistryService: { getComponent: (name) => (name === "PGRSidebarSection" ? () => ({
      key: "pgr",
      label: "Complaints",
      items: [{ key: "search", label: "Search", navigationUrl: "/kd/digit-ui/employee/pgr/inbox-v2", icon: "Search" }],
    }) : undefined) },
    Utils: { rebaseAppUrl: nav.rebaseAppUrl },
  };
  try {
    const { items } = nav.useEmployeeNavItems();
    const urls = (list) => list.flatMap((i) => (i.children ? urls(i.children) : [i.navigationUrl]));
    assert.deepEqual(items.map((i) => i.label), ["Home", "Complaints", "Dashboard"]);
    assert.deepEqual(urls(items).sort(), [
      "/kd/digit-ui/employee/",
      "/kd/digit-ui/employee/dashboard",
      "/kd/digit-ui/employee/pgr/inbox-v2",
    ]);
  } finally {
    delete global.window;
    delete global.Digit;
  }
});
