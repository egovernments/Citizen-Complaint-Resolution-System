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

const RETRY_STATE = { onboarding: { onBoardingUserProfileConfirmation: "error" } };

test("REGRESSION: an unrecognised reply to the profile confirmation retries instead of wedging", (t) => {
  // The question state sends its prompt after a 3s delay; keep that off the clock.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const asked = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("maybe"));

  // Previously `process` had no default transition, so the session sat in it for good
  // and every later message, including "hi", was swallowed.
  assert.deepEqual(asked.value, RETRY_STATE);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0], dialog.global_messages.error.retry.en_IN);
  assert.match(outputs[1], /Citizen/);
});

test("REGRESSION: repeated invalid replies re-ask only the question, never the preamble", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  let state = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("maybe"));
  state = sevaMachine.transition(state, textMessage("perhaps"));
  state = sevaMachine.transition(state, textMessage("hmm"));
  // Going back to `question` used to queue nameInformation + the question behind a
  // 3s + 1s delay on every retry. Nothing may be scheduled, and each retry sends
  // exactly the retry notice and the question.
  t.mock.timers.tick(10000);
  assert.deepEqual(state.value, RETRY_STATE);
  assert.equal(outputs.length, 6);
  for (let i = 0; i < 6; i += 2) {
    assert.equal(outputs[i], dialog.global_messages.error.retry.en_IN);
    assert.equal(outputs[i + 1], outputs[1]);
  }
});

test("a valid reply after a retry is still understood", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const retried = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("maybe"));
  const next = sevaMachine.transition(retried, textMessage("no"));
  assert.deepEqual(next.value, { onboarding: { changeName: "invoke" } });
});

test("a non-text reply to the profile confirmation also retries", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const image = { type: "USER_MESSAGE", message: { type: "image", input: "file-id" } };
  const asked = sevaMachine.transition(atProfileConfirmation(outputs), image);
  assert.deepEqual(asked.value, RETRY_STATE);
});

test("'no' to the profile confirmation still leads to changing the name", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const outputs = [];
  const next = sevaMachine.transition(atProfileConfirmation(outputs), textMessage("no"));
  assert.deepEqual(next.value, { onboarding: { changeName: "invoke" } });
});
