// The #1050 authorization contract, asserted where it can silently rot: the catalog's capability
// gates, the seeded actions behind them, and the absence of any role list in dashboard code.
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/dashboardCapabilityGate.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "../../../../..");
const KPI_DEFINITIONS = path.join(REPO, "ansible/nairobi-mdms/mdms/dss/KpiDefinition.json");
const DASHBOARD_PACKS = path.join(REPO, "ansible/nairobi-mdms/mdms/dss/DashboardPack.json");
const NAIROBI_ACTIONS = path.join(REPO, "ansible/nairobi-mdms/mdms/ACCESSCONTROL-ACTIONS-TEST/actions-test.json");
const DEFAULT_ACTIONS = path.join(
  REPO,
  "utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json"
);
const EMBEDDED_CATALOG = path.join(REPO, "digit-mcp/src/tools/dashboard-catalog-seed.ts");
const DASHBOARD_DIR = path.join(__dirname, "../..");

const BASE = "/pgr-services/v2/analytics";
const CAPABILITY_ACTIONS = [
  `${BASE}/_query`,
  `${BASE}/capabilities/officer`,
  `${BASE}/capabilities/reports`,
  `${BASE}/capabilities/reports-extended`,
];

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const unwrap = (rows) => rows.map((row) => row.data || row);

test("every published tile is gated by a capability the seeds actually define", () => {
  // A tile with no gate would be the one tile visible to everyone; a tile pointing at an action
  // nobody seeded would be visible to no one, silently. Both are catalog authoring mistakes that
  // no runtime check would surface.
  const definitions = unwrap(read(KPI_DEFINITIONS)).filter((def) => def.status === "published");
  assert.ok(definitions.length > 0, "the catalog must not be empty");

  for (const def of definitions) {
    assert.ok(
      CAPABILITY_ACTIONS.includes(def.requiredActionUrl),
      `${def.id} must declare a known requiredActionUrl (got ${JSON.stringify(def.requiredActionUrl)})`
    );
    assert.ok(!def.rbac, `${def.id} must not carry a legacy rbac block`);
  }
});

test("public is an additive marker, never a capability of its own", () => {
  for (const def of unwrap(read(KPI_DEFINITIONS))) {
    if (!def.public) continue;
    // A public tile is still gated for employees; the marker only adds the anonymous audience.
    assert.equal(def.requiredActionUrl, `${BASE}/_query`,
      `${def.id} is public, so its employee gate must be the base analytics grant`);
  }
});

test("each pack is selected by a capability or by public, never by a role list", () => {
  const packs = unwrap(read(DASHBOARD_PACKS));
  assert.ok(packs.length > 0);

  for (const pack of packs) {
    assert.ok(!pack.roles, `${pack.id} must not carry a roles list`);
    const gated = CAPABILITY_ACTIONS.includes(pack.requiredActionUrl);
    assert.ok(gated || pack.public === true,
      `${pack.id} must be selected by a capability or marked public`);
    assert.ok(!(gated && pack.public), `${pack.id} must not be both an employee pack and the public one`);
  }
});

test("the analytics actions are identical in every authoritative seed", () => {
  // Nairobi's tenant masters and the default-data seed are deployed independently. If they disagree
  // on an action's url, method or policy, two deployments enforce two different rules under one id.
  const byId = (rows) =>
    new Map(unwrap(rows).filter((a) => a.id >= 2640 && a.id <= 2648).map((a) => [a.id, a]));
  const defaults = byId(read(DEFAULT_ACTIONS));
  const nairobi = read(NAIROBI_ACTIONS);

  assert.equal(defaults.size, 9, "actions 2640-2648 must all be seeded");

  const tenants = new Set(
    nairobi.filter((row) => row.data?.id >= 2640 && row.data?.id <= 2648).map((row) => row.tenantId)
  );
  assert.ok(tenants.size > 0, "the Nairobi masters must carry the analytics actions");

  for (const tenant of tenants) {
    const rows = byId(nairobi.filter((row) => row.tenantId === tenant).map((row) => row.data));
    assert.equal(rows.size, 9, `${tenant} must carry all nine analytics actions`);
    for (const [id, action] of defaults) {
      const seeded = rows.get(id);
      assert.equal(seeded.url, action.url, `${tenant} action ${id} url`);
      assert.equal(seeded.method, action.method, `${tenant} action ${id} method`);
      assert.deepEqual(seeded.resource, action.resource, `${tenant} action ${id} policy`);
      assert.equal(seeded.enabled, false, `${tenant} action ${id} must stay disabled`);
    }
  }
});

test("the capability actions carry no policy of their own", () => {
  // They are endpoint grants. Complaint row scope lives on action 2008 (Vinoth's #1441 ABAC) and
  // is evaluated separately by the backend. An action that both grants an endpoint AND carries a
  // row policy conflates two different questions — and `scopeRef`, an indirection invented to make
  // that conflation work, is not part of #1441's policy language and must not appear in any seed.
  const actions = unwrap(read(DEFAULT_ACTIONS)).filter((a) => a.id >= 2640 && a.id <= 2648);
  assert.equal(actions.length, 9);

  for (const action of actions) {
    assert.equal(action.resource, undefined, `action ${action.id} must carry no resource policy`);
    assert.equal(action.condition, undefined, `action ${action.id} must carry no condition`);
    assert.equal(action.method, "POST");
    assert.equal(action.enabled, false);
  }

  for (const file of [DEFAULT_ACTIONS, NAIROBI_ACTIONS])
    assert.ok(!fs.readFileSync(file, "utf8").includes("scopeRef"), `${file} mentions scopeRef`);
});

test("no dashboard source carries a role allow-list", () => {
  // The point of the cutover: the browser holds no opinion about who may see the dashboard. A role
  // code reappearing here means a copy of the server's answer has been made, free to disagree.
  const ROLE_CODES = [
    "SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO", "PGR_LME", "PGR_ADMIN",
    "SUPERUSER", "PGR_VIEWER", "TICKET_REPORT_VIEWER", "MDMS_ADMIN", "LOC_ADMIN",
  ];
  // Workflow STATUS keys are a different vocabulary that happens to share a word: a complaint
  // sitting at PENDINGATSUPERVISOR is a state, not a permission. This file classifies those keys
  // and grants nothing.
  const NOT_A_ROLE_GATE = new Set(["src/config/complaintsAtRiskPresentation.js"]);
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) continue;
      if (NOT_A_ROLE_GATE.has(path.relative(DASHBOARD_DIR, full))) continue;
      const source = fs.readFileSync(full, "utf8");
      for (const role of ROLE_CODES)
        if (source.includes(`"${role}"`) || source.includes(`'${role}'`))
          offenders.push(`${path.relative(DASHBOARD_DIR, full)} contains ${role}`);
    }
  };
  walk(DASHBOARD_DIR);

  assert.deepEqual(offenders, []);
});

test("the source-less tenant bootstrap embeds the capability catalog, not legacy RBAC", () => {
  const embedded = fs.readFileSync(EMBEDDED_CATALOG, "utf8");
  assert.ok(embedded.includes('"requiredActionUrl"'));
  assert.ok(!embedded.includes('"rbac"'));
  assert.ok(!embedded.includes('"visibleTo"'));
  assert.ok(!embedded.includes('"allowedRoles"'));
});
