const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/env-variables.js", { defaultLocale: "pt_PT" });
stub("src/machine/util/localisation-service.js", { getMessageBundleForCode: () => undefined });

const State = require(p("src/machine/flow/flow-state.js"));

/** Captures what enter() hands the chat interface, without any real sending. */
function harness() {
  const sends = [];
  const context = {
    user: { userId: "u-1", locale: "pt_PT" },
    extraInfo: {},
    chatInterface: {
      toUser: (user, messages, extraInfo, opts = {}) =>
        sends.push({ messages: [...messages], delayMs: opts.delayMs ?? 0 }),
    },
  };
  return { context, sends };
}

const bundle = (text) => ({ pt_PT: text, en_IN: text });

test("a delayed prompt is handed to the send queue immediately, with its wait", () => {
  // It used to sit on a setTimeout and enqueue only when the timer fired —
  // after dispatch had snapshotted the queue and released the citizen's lock,
  // so the next message's reply could overtake it.
  const { context, sends } = harness();
  new State("ask").setPrompt([{ bundle: bundle("what is your name?"), delay: 3000 }]).enter(context, {}, {});

  assert.equal(sends.length, 1, "queued during enter(), not 3s later");
  assert.deepEqual(sends[0].messages, ["what is your name?"]);
  assert.equal(sends[0].delayMs, 3000, "the wait travels with it");
});

test("absolute offsets become incremental waits, preserving the wall clock", () => {
  // askForName is [2000, 3000]. Run in sequence, the second must wait 1000 more
  // or the pair drifts to 5s.
  const { context, sends } = harness();
  new State("ask")
    .setPrompt([
      { bundle: bundle("one moment"), delay: 2000 },
      { bundle: bundle("what is your name?"), delay: 3000 },
    ])
    .enter(context, {}, {});

  assert.deepEqual(sends.map((s) => s.delayMs), [2000, 1000]);
});

test("a buffered prompt consumes no wait of its own", () => {
  // askToConfirmProfile is [{1000, immediate:false}, {2000}]: the first only
  // accumulates, so the flush must still happen at 2000, not 1000.
  const { context, sends } = harness();
  new State("confirm")
    .setPrompt([
      { bundle: bundle("one moment"), delay: 1000, immediate: false },
      { bundle: bundle("confirm your name"), delay: 2000 },
    ])
    .enter(context, {}, {});

  assert.equal(sends.length, 1, "buffered, then flushed together");
  assert.deepEqual(sends[0].messages, ["one moment", "confirm your name"]);
  assert.equal(sends[0].delayMs, 2000);
});

test("lastPrompt is set during the turn, not when the timer fires", () => {
  // The delayed closure used to write lastPrompt after the state had already
  // been persisted, so resuming replayed the prompt before this one.
  const { context } = harness();
  new State("ask").setPrompt([{ bundle: bundle("what is your name?"), delay: 3000 }]).enter(context, {}, {});

  assert.equal(context.lastPrompt, "what is your name?");
});

test("an undelayed prompt still goes out with no wait", () => {
  const { context, sends } = harness();
  new State("menu").setPrompt(bundle("choose an option")).enter(context, {}, {});

  assert.equal(sends.length, 1);
  assert.equal(sends[0].delayMs, 0);
});
