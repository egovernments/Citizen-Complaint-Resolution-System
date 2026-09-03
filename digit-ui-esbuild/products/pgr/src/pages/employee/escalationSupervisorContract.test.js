// The #1956 contract: everything the PGR escalation ladder needs in order to be
// usable end to end, asserted against the repo's own seed data so the four ways
// it broke in production cannot silently come back.
//
// Run from digit-ui-esbuild/:
//   node --test products/pgr/src/pages/employee/escalationSupervisorContract.test.js
//
// What broke on the live `ke` tenant (all four verified there on 2026-09-03):
//   1. SUPERVISOR was absent from PGRCard's ROLES.PGR, so the whole PGR module
//      card — the only route to "Search Complaint" — was hidden from it.
//   2. SUPERVISOR held 5 role-actions and none of the ones the employee screens
//      call, so even a reachable inbox 403'd on /_count.
//   3. RESOLVEBYSUPERVISOR had no ACTION_CONFIGS entry, so PGRWorkflowModal
//      short-circuited on `if (!config) return null` and the button was dead
//      (identical to ESCALATE in #521).
//   4. PENDINGFORASSIGNMENT --ESCALATE--> PENDINGFORASSIGNMENT was a self-loop,
//      so a GRO escalation left applicationStatus on "Pending for assignment"
//      while the timeline claimed the complaint had been escalated.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "../../../../../..");
const DDH = path.join(REPO, "utilities/default-data-handler/src/main/resources");
const WORKFLOW = path.join(DDH, "PgrWorkflowConfig.json");
const ROLEACTIONS = path.join(DDH, "mdmsData/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json");
const ACTIONS = path.join(DDH, "mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json");
const LOCALISATION = path.join(DDH, "localisations/en_IN/rainmaker-pgr.json");
const PGR_CARD = path.join(__dirname, "../../components/PGRCard.js");
const PGR_DETAILS = path.join(__dirname, "PGRDetails.js");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const source = (file) => fs.readFileSync(file, "utf8");

const states = () => read(WORKFLOW).BusinessServices[0].states;
const transitions = () =>
  states().flatMap((s) => (s.actions || []).map((a) => ({ ...a, fromState: s.state })));

// Actors the workflow names that are NOT employees driving the details screen:
// the citizen portal (CITIZEN/CFC) and the escalation scheduler / workflow
// service itself.
const NON_EMPLOYEE_ROLES = new Set(["CITIZEN", "CFC", "AUTO_ESCALATE", "SYSTEM", "ANONYMOUS"]);
// APPLY is the start-state transition — it is driven by the create-complaint
// form, never by the details page's "Take action" bar, so it needs no
// ACTION_CONFIGS entry.
const NOT_A_DETAILS_ACTION = new Set(["APPLY"]);

const employeeActions = () => {
  const out = new Set();
  for (const t of transitions()) {
    if (NOT_A_DETAILS_ACTION.has(t.action)) continue;
    if ((t.roles || []).some((r) => !NON_EMPLOYEE_ROLES.has(r))) out.add(t.action);
  }
  return out;
};

test("every workflow action an employee can reach has an ACTION_CONFIGS form", () => {
  // Root cause 3. Without a config the modal renders nothing and the click is a
  // silent no-op — strictly worse than not offering the action, because the
  // operator believes they acted.
  const src = source(PGR_DETAILS);
  const configured = new Set([...src.matchAll(/actionType:\s*"([A-Z_]+)"/g)].map((m) => m[1]));
  const missing = [...employeeActions()].filter((a) => !configured.has(a)).sort();
  assert.deepEqual(missing, [], `PGRDetails.ACTION_CONFIGS has no form for: ${missing.join(", ")}`);
});

test("PGRCard lists every employee role that acts in the PGR workflow", () => {
  // Root cause 1. PGRCard returns null — hiding the module entirely — unless the
  // user holds one of these. PGR_VIEWER is deliberately absent: it is a read
  // credential always granted alongside an acting role, not a route of its own.
  const src = source(PGR_CARD);
  const listed = new Set([...src.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]));
  const required = new Set();
  for (const t of transitions()) {
    for (const r of t.roles || []) {
      if (!NON_EMPLOYEE_ROLES.has(r) && r !== "PGR_VIEWER") required.add(r);
    }
  }
  const missing = [...required].filter((r) => !listed.has(r)).sort();
  assert.deepEqual(missing, [], `PGRCard ROLES.PGR is missing: ${missing.join(", ")}`);
  assert.ok(listed.has("SUPERVISOR"), "SUPERVISOR must be able to open the PGR module card");
});

test("SUPERVISOR is granted the role-actions the employee PGR screens call", () => {
  // Root cause 2. Each URL below is fetched by the inbox or the details screen;
  // a 403 on any one of them breaks the screen, and /_count in particular is
  // fired in the same Promise.all as /_search (usePGRInboxSearch), so denying it
  // empties the whole inbox rather than degrading it.
  const NEEDED = [
    "card",                                                    // the module card itself
    "/pgr-services/v2/request/_search",
    "/pgr-services/v2/request/_count",
    "/pgr-services/v2/request/_update",
    "/egov-workflow-v2/egov-wf/process/_search",
    "/egov-workflow-v2/egov-wf/businessservice/_search",
    "/boundary-service/boundary-relationships/_search",
  ];
  const actionsById = new Map(read(ACTIONS).map((a) => [a.id, a]));
  const granted = new Set(
    read(ROLEACTIONS).filter((r) => r.rolecode === "SUPERVISOR").map((r) => r.actionid)
  );
  const grantedUrls = new Set([...granted].map((id) => actionsById.get(id)?.url).filter(Boolean));
  const missing = NEEDED.filter((u) => !grantedUrls.has(u));
  assert.deepEqual(missing, [], `SUPERVISOR has no role-action for: ${missing.join(", ")}`);

  // Every granted action must resolve in the actions master, or access-control
  // silently drops the row (x-ref-schema on actionid).
  const dangling = [...granted].filter((id) => !actionsById.has(id)).sort();
  assert.deepEqual(dangling, [], `SUPERVISOR granted unknown actionid(s): ${dangling.join(", ")}`);
});

test("ESCALATE and FORWARD always move the complaint to PENDINGATSUPERVISOR", () => {
  // Root cause 4. A self-loop leaves applicationStatus untouched, so the inbox's
  // status column and the details timeline tell the operator two different
  // stories about the same complaint.
  const escalating = transitions().filter((t) => t.action === "ESCALATE" || t.action === "FORWARD");
  assert.ok(escalating.length >= 3, "expected ESCALATE from both pending states plus FORWARD");
  for (const t of escalating) {
    assert.equal(
      t.nextState,
      "PENDINGATSUPERVISOR",
      `${t.fromState} --${t.action}--> ${t.nextState} must land at PENDINGATSUPERVISOR, not self-loop`
    );
  }
  // ...and the state it lands in must have a way out, or the complaint is stuck.
  const supervisor = states().find((s) => s.state === "PENDINGATSUPERVISOR");
  assert.ok((supervisor.actions || []).length > 0, "PENDINGATSUPERVISOR must be exitable");
});

test("RESOLVEBYSUPERVISOR belongs to SUPERVISOR alone", () => {
  // A GRO offered this action is being offered someone else's decision; on live
  // it was also a dead button, which is how the issue was reported.
  const rbs = transitions().filter((t) => t.action === "RESOLVEBYSUPERVISOR");
  assert.equal(rbs.length, 1);
  assert.deepEqual(rbs[0].roles, ["SUPERVISOR"]);
  assert.equal(rbs[0].fromState, "PENDINGATSUPERVISOR");
});

test("every employee workflow action has its three localisation keys", () => {
  // The dropdown option, the modal heading and the timeline entry are three
  // separate keys per action; an unseeded one renders the raw code, which is
  // what "WF_PGR_ESCALATE" in the reported screenshot actually was.
  const codes = new Set(read(LOCALISATION).map((m) => m.code));
  const missing = [];
  for (const action of employeeActions()) {
    for (const key of [action, `WF_PGR_${action}`]) {
      if (!codes.has(key)) missing.push(key);
    }
    // Heading key: PGR_ACTION_<A> or CS_ACTION_<A> — the file uses both prefixes.
    if (!codes.has(`PGR_ACTION_${action}`) && !codes.has(`CS_ACTION_${action}`)) {
      missing.push(`PGR_ACTION_${action}|CS_ACTION_${action}`);
    }
  }
  assert.deepEqual(missing.sort(), [], `rainmaker-pgr en_IN is missing: ${missing.join(", ")}`);
});
