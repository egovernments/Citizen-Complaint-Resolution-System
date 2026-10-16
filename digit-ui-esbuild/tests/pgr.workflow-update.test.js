// CCRS #1967: Resolve must not carry an assignee picked earlier in another action.
//
// Run from digit-ui-esbuild/:   node --test tests/pgr.workflow-update.test.js
//
// workflowUpdate.js is ESM like the rest of products/, so this bundles it to CJS with the
// repo's own esbuild, the same idiom as tests/pgr.escalate-visibility.test.js.
//
// Background: the action modal merged every form's values into one session object and
// submitted the lot. An employee picked in Assign survived a cancel, so a later Resolve
// sent workflow.assignes with that employee's uuid, and pgr-services refused the
// transition with INVALID_ASSIGNEE ("Cannot assign to the user: …").

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/pages/employee/workflowUpdate.js");
const OUT = path.join(os.tmpdir(), `workflowUpdate.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  logLevel: "silent",
});
const { buildWorkflowUpdate, formDataForAction } = require(OUT);
fs.unlinkSync(OUT);

// The shapes PGRDetails' ACTION_CONFIGS use: a form of sections, each with a body of fields.
const form = (...keys) => ({ formConfig: { form: [{ body: keys.map((key) => ({ key })) }] } });
const ASSIGN = { actionType: "ASSIGN", ...form("SelectedAssignee", "SelectedComments") };
const RESOLVE = { actionType: "RESOLVE", ...form("SelectedComments") };
const REJECT = { actionType: "REJECT", ...form("SelectedReason", "SelectedComments") };
const ESCALATE = { actionType: "ESCALATE", ...form("SelectedComments") };
const REASSIGN = { actionType: "REASSIGN", ...form("SelectedAssignee", "SelectedComments") };

const service = { serviceRequestId: "PGR-1", additionalDetail: { department: "ROADS" } };
const assignee = { uuid: "lme-2", department: "WATER" };

test("a stale assignee from an earlier Assign is not sent with Resolve", () => {
  // What the merged session held: Assign's pick, then Resolve's comment.
  const stale = { SelectedAssignee: assignee, SelectedComments: "Fixed the leak" };
  const { workflow, service: sent } = buildWorkflowUpdate({ action: "RESOLVE", actionConfig: RESOLVE, data: stale, baseService: service });
  assert.equal(workflow.action, "RESOLVE");
  assert.equal(workflow.assignes, null);
  assert.equal(workflow.hrmsAssignes, null);
  assert.equal(workflow.comments, "Fixed the leak");
  // Nor is the stale assignee's department stamped onto the complaint.
  assert.deepEqual(sent.additionalDetail, { department: "ROADS" });
});

test("Reject and Escalate send no assignee either", () => {
  for (const [action, config] of [["REJECT", REJECT], ["ESCALATE", ESCALATE]]) {
    const { workflow } = buildWorkflowUpdate({
      action,
      actionConfig: config,
      data: { SelectedAssignee: assignee, SelectedComments: "x" },
      baseService: service,
    });
    assert.equal(workflow.assignes, null, action);
    assert.equal(workflow.hrmsAssignes, null, action);
  }
});

test("Assign and Reassign still send the chosen assignee and route the complaint to their department", () => {
  for (const [action, config] of [["ASSIGN", ASSIGN], ["REASSIGN", REASSIGN]]) {
    const { workflow, service: sent } = buildWorkflowUpdate({
      action,
      actionConfig: config,
      data: { SelectedAssignee: assignee, SelectedComments: "Over to you" },
      baseService: service,
    });
    assert.deepEqual(workflow.assignes, ["lme-2"], action);
    assert.deepEqual(workflow.hrmsAssignes, ["lme-2"], action);
    assert.equal(sent.additionalDetail.department, "WATER", action);
  }
});

test("an assign-capable action with no pick sends null, not an empty list", () => {
  const { workflow } = buildWorkflowUpdate({ action: "REASSIGN", actionConfig: REASSIGN, data: { SelectedComments: "x" }, baseService: service });
  assert.equal(workflow.assignes, null);
});

test("a rejection's reason code prefixes the comment", () => {
  const data = { SelectedReason: { code: "DUPLICATE" }, SelectedComments: "Same as PGR-0" };
  assert.equal(buildWorkflowUpdate({ action: "REJECT", actionConfig: REJECT, data, baseService: service }).workflow.comments, "[DUPLICATE] Same as PGR-0");
  assert.equal(
    buildWorkflowUpdate({ action: "REJECT", actionConfig: REJECT, data: { SelectedReason: "SPAM" }, baseService: service }).workflow.comments,
    "[SPAM]"
  );
});

test("only the action's own fields are read", () => {
  assert.deepEqual(formDataForAction(RESOLVE, { SelectedAssignee: assignee, SelectedReason: "SPAM", SelectedComments: "ok" }), {
    SelectedComments: "ok",
  });
  assert.deepEqual(formDataForAction(undefined, { SelectedComments: "ok" }), {});
});
