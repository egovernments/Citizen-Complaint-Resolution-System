const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);
const { Machine, interpret } = require(p("node_modules/xstate"));
const ChatState = require(p("src/session/chat-state.js"));

// The SHARED service-account token. It can call user/_search,
// users/_createnovalidate and _updatenovalidate until it expires, so a copy
// sitting in eg_chat_state_v2.state is a credential at rest.
const TOKEN = "service-account-token-that-must-not-persist";

function inboundEvent() {
  return {
    type: "USER_MESSAGE",
    user: { userId: "u-1", locale: "pt_PT", mobileNumber: "258840000000", authToken: TOKEN },
    extraInfo: { tenantId: "mz" },
  };
}

/** confirm -> submitting -> receipt, the shape the reviewer reproduced with. */
function drive(turns) {
  const machine = Machine({
    id: "probe",
    initial: "confirm",
    context: {
      user: { userId: "u-1", locale: "pt_PT", mobileNumber: "258840000000", authToken: TOKEN },
      slots: { pgr: {} },
    },
    states: {
      confirm: { on: { USER_MESSAGE: "submitting" } },
      submitting: { on: { USER_MESSAGE: "receipt" } },
      receipt: {},
    },
  });

  const service = interpret(machine).start();
  for (let i = 0; i < turns; i += 1) service.send(inboundEvent());
  return service.state;
}

test("the token reaches history before anything strips it", () => {
  // Establishes the leak this guards against, so a future reader can see the
  // test is not asserting something vacuous.
  const raw = JSON.parse(JSON.stringify(drive(2)));
  assert.ok(
    JSON.stringify(raw.history).includes(TOKEN),
    "history._event carries the event that produced it, token and all"
  );
});

test("the persisted blob carries no token — not on the event, not in history", () => {
  for (const turns of [0, 1, 2, 3]) {
    const persisted = ChatState.create(drive(turns)).toPersistableState().state;
    assert.doesNotMatch(persisted, new RegExp(TOKEN), `after ${turns} turn(s)`);
  }
});

test("history is emptied rather than left half-cleared", () => {
  // withoutUserData cleared history.context.user but not history's own event,
  // which is where the inbound model actually sits.
  const persisted = JSON.parse(ChatState.create(drive(2)).toPersistableState().state);

  assert.deepEqual(persisted.event, {});
  assert.deepEqual(persisted._event, {});
  assert.deepEqual(persisted.history.event, {});
  assert.deepEqual(persisted.history._event, {});
  assert.deepEqual(persisted.history.context.user, {});
});

test("what a session needs to resume still survives", () => {
  const persisted = JSON.parse(ChatState.create(drive(2)).toPersistableState().state);

  assert.equal(persisted.value, "receipt");
  assert.deepEqual(persisted.context.user, {
    userId: "u-1",
    locale: "pt_PT",
    mobileNumber: "258840000000",
  });
});

test("persisting does not strip the live state the interpreter is still using", () => {
  const live = drive(2);
  ChatState.create(live).toPersistableState();

  assert.equal(live.context.user.authToken, TOKEN, "the clone is what gets stripped");
});
