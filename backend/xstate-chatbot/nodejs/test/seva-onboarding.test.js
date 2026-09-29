const test = require("node:test");
const assert = require("node:assert/strict");
const { State } = require("xstate");

const sevaMachine = require("../src/machine/seva");
const dialog = require("../src/machine/util/dialog");

const CONFIRMATION = { onboarding: { onBoardingUserProfileConfirmation: "question" } };

function atProfileConfirmation(outputs) {
  const context = {
    user: { locale: "en_IN", name: "Citizen" },
    extraInfo: {},
    chatInterface: { toUser: (user, messages) => outputs.push(...messages) },
  };
  return sevaMachine.resolveState(State.from(CONFIRMATION, context));
}

function textMessage(input) {
  return { type: "USER_MESSAGE", message: { type: "text", input } };
}

test("REGRESSION: an unrecognised reply to the profile confirmation retries instead of wedging", (t) => {
  // The question state sends its prompt after a 3s delay; keep that off the clock.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const asked = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("maybe"));

  // Previously `process` had no default transition, so the session sat in it for good
  // and every later message, including "hi", was swallowed.
  assert.deepEqual(asked.value, CONFIRMATION);
  assert.deepEqual(outputs, [dialog.global_messages.error.retry.en_IN]);
});

test("a non-text reply to the profile confirmation also retries", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const image = { type: "USER_MESSAGE", message: { type: "image", input: "file-id" } };
  const asked = sevaMachine.transition(atProfileConfirmation(outputs), image);
  assert.deepEqual(asked.value, CONFIRMATION);
});

test("'no' to the profile confirmation still leads to changing the name", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const next = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("no"));
  assert.deepEqual(next.value, { onboarding: { changeName: "invoke" } });
});
