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
// All three seeds a tenant can be built from. The review's blocking finding was
// in the two loader templates, which this contract originally did not read —
// a fresh tenant looked healthy while every loader-updated one stayed broken.
const WORKFLOW_TEMPLATES = [
  WORKFLOW,
  path.join(REPO, "utilities/crs_dataloader/templates/PgrWorkflowConfig.json"),
  path.join(REPO, "local-setup/dataloader/templates/PgrWorkflowConfig.json"),
];
const ROLEACTIONS = path.join(DDH, "mdmsData/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json");
const ACTIONS = path.join(DDH, "mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json");
const LOCALISATION = path.join(DDH, "localisations/en_IN/rainmaker-pgr.json");
const PGR_CARD = path.join(__dirname, "../../components/PGRCard.js");
const PGR_DETAILS = path.join(__dirname, "PGRDetails.js");
const LOCALISATIONS = [
  LOCALISATION,
  path.join(DDH, "localisations/default/rainmaker-pgr.json"),
  path.join(REPO, "local-setup/dataloader/templates/localisations/rainmaker-pgr.json"),
];

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const source = (file) => fs.readFileSync(file, "utf8");

// Both assertions below have to read the ACTUAL declaration, not "does this
// literal appear anywhere in the file". A whole-file grep passes when the thing
// it checks is gone: drop "CSR" from ROLES.PGR and the `["CSR"]` argument to
// generateLink() further down keeps the token present. Same for a commented-out
// ACTION_CONFIGS entry. So: strip comments, then slice out the one declaration.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Balanced-delimiter slice of `const <name> = <open> … <close>`. */
function declaration(src, name, open, close) {
  const start = src.search(new RegExp(`const\\s+${name}\\s*=\\s*\\${open}`));
  if (start === -1) throw new Error(`could not locate declaration of ${name}`);
  let i = src.indexOf(open, start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced ${open}${close} in declaration of ${name}`);
}

/** The string members of ROLES.PGR, and nothing else in the file. */
function rolesPgr(src) {
  const roles = declaration(stripComments(src), "ROLES", "{", "}");
  const arr = roles.match(/PGR\s*:\s*\[([^\]]*)\]/);
  if (!arr) throw new Error("ROLES.PGR array not found");
  return new Set([...arr[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** The actionType values of the ACTION_CONFIGS entries, and nothing else. */
function actionConfigTypes(src) {
  const block = declaration(stripComments(src), "ACTION_CONFIGS", "[", "]");
  return new Set([...block.matchAll(/actionType\s*:\s*"([A-Z_]+)"/g)].map((m) => m[1]));
}

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
  const configured = actionConfigTypes(source(PGR_DETAILS));
  const missing = [...employeeActions()].filter((a) => !configured.has(a)).sort();
  assert.deepEqual(missing, [], `PGRDetails.ACTION_CONFIGS has no form for: ${missing.join(", ")}`);
});

test("PGRCard lists every employee role that acts in the PGR workflow", () => {
  // Root cause 1. PGRCard returns null — hiding the module entirely — unless the
  // user holds one of these. PGR_VIEWER is deliberately absent: it is a read
  // credential always granted alongside an acting role, not a route of its own.
  const listed = rolesPgr(source(PGR_CARD));
  const required = new Set();
  for (const t of transitions()) {
    for (const r of t.roles || []) {
      if (!NON_EMPLOYEE_ROLES.has(r) && r !== "PGR_VIEWER") required.add(r);
    }
  }
  // Exact equality, not containment: an extra role in ROLES.PGR grants the whole
  // module to someone the workflow never made an actor.
  assert.deepEqual([...listed].sort(), [...required].sort());
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

test("every action's currentState names the state it sits under, in every template", () => {
  // Review finding (blocking). A foreign UUID here survives the UPDATE path:
  // the loader copies the existing action uuid onto the incoming action
  // (crs_loader._merge_workflow_uuids) and the workflow enricher only rewrites
  // currentState for uuid-less actions, so the alien value is persisted. Every
  // read joins ac.currentState = st.uuid, so the action is orphaned and its
  // state comes back with zero actions — the stuck complaint #1956 reports.
  // The create path is unaffected, which is exactly what makes it easy to miss.
  for (const file of WORKFLOW_TEMPLATES) {
    const states = read(file).BusinessServices[0].states;
    const offenders = [];
    for (const state of states) {
      for (const action of state.actions || []) {
        // Start state has no name: currentState must be left unset so the
        // workflow service fills in the generated start-state uuid.
        const expected = state.state ?? null;
        if ((action.currentState ?? null) !== expected) {
          offenders.push(`${state.state}.${action.action}: currentState=${action.currentState}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `${path.basename(path.dirname(file))}/${path.basename(file)} → ${offenders.join("; ")}`);
  }
});

test("no nextState anywhere is a raw UUID", () => {
  // Same class as the above: EnrichmentService.enrichNextState accepts any
  // UUID-shaped value without checking it resolves, so a stale UUID from
  // another deployment silently persists as an unreachable transition.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const file of WORKFLOW_TEMPLATES) {
    const states = read(file).BusinessServices[0].states;
    const raw = states.flatMap((s) => (s.actions || [])
      .filter((a) => UUID.test(String(a.nextState)))
      .map((a) => `${s.state}.${a.action} -> ${a.nextState}`));
    assert.deepEqual(raw, [], `${path.basename(path.dirname(file))} → ${raw.join("; ")}`);
  }
});

test("a hand-up to the supervisor cannot be submitted without an assignee", () => {
  // Review finding. Workflow does not inherit assignees across a transition, and
  // PENDINGATSUPERVISOR is absent from pgr.visibility.unassigned.states, so an
  // assignee-less escalation is invisible in both the MINE and TEAM inbox tabs
  // while SUPERVISOR is the only role that can act on it.
  const src = stripComments(source(PGR_DETAILS));
  for (const action of ["ESCALATE", "FORWARD"]) {
    const at = src.indexOf(`actionType: "${action}"`);
    assert.notEqual(at, -1, `${action} has no ACTION_CONFIGS entry`);
    const next = src.indexOf("actionType:", at + 12);
    const block = src.slice(at, next === -1 ? src.length : next);
    const assignee = block.indexOf("PGRAssigneeComponent");
    assert.notEqual(assignee, -1, `${action} must offer an assignee picker`);
    // isMandatory sits just above the component line in the field object.
    const field = block.slice(Math.max(0, assignee - 260), assignee);
    assert.match(field, /isMandatory:\s*true/,
      `${action}'s assignee must be mandatory — an escalation with no recipient lands nowhere`);
  }
});

test("the escalation ladder notifies the citizen and the receiving supervisor", () => {
  // Review finding. RESOLVEBYSUPERVISOR reaches RESOLVED, but the legacy
  // notification path has no entry for it and NotificationService gates the
  // citizen "resolved" message on action == RESOLVE — so the citizen learned
  // nothing, where an LME RESOLVE on the same complaint sends three messages.
  // These rows drive the config-driven path (NotificationRouter matches on
  // businessService + action + toState).
  const states = read(WORKFLOW).BusinessServices[0].states;
  const audiences = (state, action) => {
    const a = (states.find((s) => s.state === state)?.actions || []).find((x) => x.action === action);
    return new Set((a?.notifications || []).map((n) => n.audience));
  };
  assert.ok(audiences("PENDINGATSUPERVISOR", "RESOLVEBYSUPERVISOR").has("CITIZEN"),
    "the citizen must be told when a supervisor closes their complaint");
  assert.ok(audiences("PENDINGATLME", "ESCALATE").has("SUPERVISOR"),
    "the receiving supervisor must be notified of an escalation");

  // Every templateRef must resolve, or the router emits a row pointing at nothing.
  const refs = new Set(read(WORKFLOW).notificationTemplates.map((t) => t.ref));
  const dangling = states.flatMap((s) => (s.actions || []).flatMap((a) =>
    (a.notifications || []).map((n) => n.templateRef).filter((r) => !refs.has(r))));
  assert.deepEqual(dangling, [], `notification templateRef(s) with no template: ${dangling.join(", ")}`);

  // NotificationRouting is keyed on (businessService, action, toState) with a
  // null fromState, so two transitions sharing an action+toState would emit
  // duplicate uniqueIdentifiers.
  const keys = states.flatMap((s) => (s.actions || []).flatMap((a) =>
    (a.notifications || []).map((n) => `${a.action}.${a.nextState}.${n.audience}.${n.channel}`)));
  assert.equal(new Set(keys).size, keys.length,
    `duplicate NotificationRouting key(s): ${keys.filter((k, i) => keys.indexOf(k) !== i).join(", ")}`);
});

test("the citizen can comment while a complaint sits with the supervisor", () => {
  // Review finding: PENDINGATSUPERVISOR was the only open state with no COMMENT
  // action for CITIZEN, so an escalated complaint went silent for the person who
  // filed it. (A de-escalate path is a separate design decision, tracked apart.)
  for (const file of WORKFLOW_TEMPLATES) {
    const sup = read(file).BusinessServices[0].states.find((s) => s.state === "PENDINGATSUPERVISOR");
    const comment = (sup.actions || []).find((a) => a.action === "COMMENT");
    assert.ok(comment, `${path.basename(path.dirname(file))}: PENDINGATSUPERVISOR has no COMMENT action`);
    assert.deepEqual(comment.roles, ["CITIZEN"]);
    assert.equal(comment.nextState, "PENDINGATSUPERVISOR", "COMMENT must be a self-loop");
  }
});

test("both status-label prefixes are seeded for every reachable state", () => {
  // Review finding. The details page renders CS_COMMON_PGR_STATE_<status> while
  // the inbox column renders CS_COMMON_<status>. Seeding only one prefix
  // reproduces the details-vs-search mismatch that is issue #1956 point 3.
  const reachable = new Set(read(WORKFLOW).BusinessServices[0].states
    .flatMap((s) => (s.actions || []).map((a) => a.nextState)).filter(Boolean));
  for (const file of LOCALISATIONS) {
    const codes = new Set(read(file).map((m) => m.code));
    const missing = [...reachable].flatMap((st) =>
      [`CS_COMMON_${st}`, `CS_COMMON_PGR_STATE_${st}`].filter((k) => !codes.has(k))).sort();
    assert.deepEqual(missing, [], `${path.basename(path.dirname(file))}/${path.basename(file)} missing: ${missing.join(", ")}`);
  }
});

test("an escalation can be undone, and the way back cannot ping-pong", () => {
  // Review finding: PENDINGATSUPERVISOR was one-way, so a mis-escalation could only
  // be closed, never undone. The target matters as much as the action: it must be a
  // state the escalation scheduler does NOT scan, or a de-escalated complaint is
  // immediately re-escalated and the loop only ends at maxDepth.
  const SCANNED = ["PENDINGATLME", "PENDINGFORASSIGNMENT"];        // EscalationScheduler:75
  const TEAM_VISIBLE = ["PENDINGFORASSIGNMENT", "PENDINGFORREASSIGNMENT"]; // pgr.visibility.unassigned.states
  for (const file of WORKFLOW_TEMPLATES) {
    const sup = read(file).BusinessServices[0].states.find((s) => s.state === "PENDINGATSUPERVISOR");
    const back = (sup.actions || []).find((a) => a.action === "REASSIGN");
    assert.ok(back, `${path.basename(path.dirname(file))}: no way back out of PENDINGATSUPERVISOR`);
    assert.deepEqual(back.roles, ["SUPERVISOR"]);
    assert.ok(!SCANNED.includes(back.nextState),
      `de-escalating to ${back.nextState} would be re-escalated on the next scan`);
    assert.ok(TEAM_VISIBLE.includes(back.nextState),
      `${back.nextState} is not in pgr.visibility.unassigned.states, so a de-escalated ` +
      `complaint with no assignee would be invisible — the bug this PR fixed for ESCALATE`);
  }
});

test("a supervisor's close notifies the citizen on the LEGACY path too", () => {
  // The config-driven rows are inert while pgr.notification.config.driven=false (the
  // default), so the legacy notifier is what actually runs. It gates on
  // "<action>_<applicationStatus>" being in NOTIFICATION_ENABLE_FOR_STATUS, and builds
  // its message key as PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE — a missing key makes
  // getCustomizedMsg return null and the notifier send nothing.
  const constants = source(path.join(REPO, "backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java"));
  const enableList = constants.match(/NOTIFICATION_ENABLE_FOR_STATUS[\s\S]*?\)\);/);
  assert.ok(enableList, "could not locate NOTIFICATION_ENABLE_FOR_STATUS");
  assert.match(enableList[0], /RESOLVEBYSUPERVISOR_RESOLVED/,
    "the supervisor's close is not registered, so the notifier early-returns");

  const notifier = source(path.join(REPO, "backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java"));
  assert.doesNotMatch(notifier, /getAction\(\)\.equals\("RESOLVE"\)/,
    "the Rate/Reopen action links are still gated on the RESOLVE literal");
  assert.match(notifier, /closesComplaintForCitizen/,
    "the citizen-close gates should share one predicate covering both resolving actions");

  for (const file of LOCALISATIONS) {
    const codes = new Set(read(file).map((m) => m.code));
    assert.ok(codes.has("PGR_CITIZEN_RESOLVEBYSUPERVISOR_RESOLVED_SMS_MESSAGE"),
      `${path.basename(path.dirname(file))}: legacy message key missing, so the fix sends nothing`);
  }
});
