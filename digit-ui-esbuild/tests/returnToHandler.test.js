// Tests for products/pgr/src/utils/returnToHandler.js — FC-0002.
//
// Run from digit-ui-esbuild/:   node --test tests/returnToHandler.test.js
//
// The module is dependency-free ESM; this package is CommonJS, so it is
// evaluated in a vm context with `export` stripped (same approach as the
// analytics shim test) rather than pulling esbuild into a unit test.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../products/pgr/src/utils/returnToHandler.js"), "utf8");
// `const` bindings made by runInNewContext are lexical, not context properties,
// so the module is wrapped to return its exports explicitly.
const { returnToHandlerRole, RETURN_TO_HANDLER } = vm.runInNewContext(
  `(() => { ${src.replace(/^export /gm, "")}; return { returnToHandlerRole, RETURN_TO_HANDLER }; })()`
);

test("recording the citizen's answer routes back to the case manager", () => {
  assert.equal(returnToHandlerRole("COMMENT", "INFOFROMCITIZEN"), "CMS_CASE_MANAGER");
});

test("COMMENT elsewhere is not a return-to-handler transition", () => {
  // COMMENT is a self-loop on REJECTED and RESOLVED — picker behaviour must not change there
  assert.equal(returnToHandlerRole("COMMENT", "REJECTED"), null);
  assert.equal(returnToHandlerRole("COMMENT", "RESOLVED"), null);
  assert.equal(returnToHandlerRole("COMMENT", "PENDINGATLME"), null);
});

test("other actions out of INFOFROMCITIZEN keep their picker semantics", () => {
  assert.equal(returnToHandlerRole("ASSIGN", "INFOFROMCITIZEN"), null);
  assert.equal(returnToHandlerRole("REJECT", "INFOFROMCITIZEN"), null);
});

test("missing state (standard PGR workflow, or an option without fromState) is a no-op", () => {
  assert.equal(returnToHandlerRole("COMMENT", undefined), null);
  assert.equal(returnToHandlerRole("COMMENT", null), null);
  assert.equal(returnToHandlerRole(undefined, "INFOFROMCITIZEN"), null);
});

test("the rule table is frozen so a stray write cannot widen it at runtime", () => {
  assert.ok(Object.isFrozen(RETURN_TO_HANDLER));
  assert.ok(Object.isFrozen(RETURN_TO_HANDLER.INFOFROMCITIZEN));
});
