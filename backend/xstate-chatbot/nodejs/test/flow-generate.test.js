const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Machine, interpret, State } = require("xstate");

const projectRoot = path.resolve(__dirname, "..");
const localisationServicePath = path.join(
  projectRoot,
  "src/machine/util/localisation-service.js"
);
const generatePath = path.join(projectRoot, "src/machine/flow/generate.js");

require.cache[localisationServicePath] = {
  id: localisationServicePath,
  filename: localisationServicePath,
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined },
};

const { generate, assertTargets, mergeStates } = require(generatePath);

const PROMPT = { en_IN: "PROMPT" };
const RETRY = { en_IN: "RETRY" };

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await flush();
  }
}

function textMessage(input) {
  return { type: "USER_MESSAGE", message: { type: "text", input } };
}

function imageMessage() {
  return { type: "USER_MESSAGE", message: { type: "image", input: "file-1" } };
}

function run(steps, initial) {
  const outputs = [];
  const machine = Machine({
    id: "root",
    initial,
    context: {
      user: { locale: "en_IN", userId: "u1" },
      extraInfo: { tenantId: "pg" },
      slots: { pgr: {} },
      chatInterface: {
        toUser(user, messages) {
          outputs.push(...messages);
        },
      },
    },
    states: Object.assign(generate(steps), {
      endstate: { id: "endstate", type: "final" },
      system_error: { id: "system_error" },
    }),
  });
  return { outputs, service: interpret(machine) };
}

test("say emits one node with an entry action and an always transition", () => {
  const states = generate([
    { key: "notice", kind: "say", prompt: PROMPT, next: "#endstate" },
  ]);
  assert.equal(states.notice.states, undefined);
  assert.ok(states.notice.onEntry);
  assert.deepEqual(states.notice.always.map((t) => t.target), ["#endstate"]);
});

test("ask emits the triplet and falls through to error", () => {
  const states = generate([
    { key: "name", kind: "ask", accept: "text", prompt: PROMPT, slot: "n", next: "#endstate" },
  ]);
  assert.deepEqual(Object.keys(states.name.states), ["question", "process", "error"]);
  assert.equal(states.name.states.question.on.USER_MESSAGE, "process");
  const always = states.name.states.process.always;
  assert.equal(always[always.length - 1].target, "error");
  assert.equal(always[always.length - 1].cond, undefined);
  assert.equal(states.name.states.error.always, "question");
});

test("choose recognises both the number and the lowercased option", () => {
  const states = generate([
    {
      key: "confirm",
      kind: "choose",
      prompt: PROMPT,
      options: ["Yes", "No"],
      next: { Yes: "#endstate", No: "#endstate" },
    },
  ]);
  const always = states.confirm.states.process.always;
  assert.equal(always.length, 3);
  assert.equal(always[2].target, "error");
  assert.equal(always[2].cond, undefined);
});

test("walk emits five states and orders guards go-back, leaf, descend, error", () => {
  const states = generate([
    {
      key: "tree",
      kind: "walk",
      pathSlot: "treePath",
      stepSlot: "treeStep",
      fetch: async () => ({}),
      preamble: PROMPT,
      onLeaf: { slot: "leaf", to: "#endstate" },
    },
  ]);
  assert.deepEqual(Object.keys(states.tree.states), [
    "fetch",
    "evaluate",
    "question",
    "process",
    "error",
  ]);
  assert.deepEqual(
    states.tree.states.process.always.map((t) => t.target),
    ["fetch", "fetch", "#endstate", "fetch", "error"]
  );
  // tier 0 is the resume guard: no fetched step data in context -> re-fetch, never crash
  assert.equal(states.tree.states.process.always[0].cond({}), true);
  assert.equal(states.tree.states.process.always[0].cond({ treeStep: {} }), false);
  assert.equal(states.tree.states.fetch.invoke.onDone.target, "evaluate");
  assert.equal(states.tree.states.fetch.invoke.onError.target, "#system_error");
});

test("call emits an invoke with one transition per onDone branch", () => {
  const states = generate([
    {
      key: "persist",
      kind: "call",
      src: async () => ({}),
      onDone: [
        { when: () => true, message: PROMPT, to: "#endstate" },
        { message: PROMPT, to: "#endstate" },
      ],
    },
  ]);
  assert.equal(states.persist.invoke.onDone.length, 2);
  assert.ok(states.persist.invoke.onDone[0].cond);
  assert.equal(states.persist.invoke.onDone[1].cond, undefined);
  assert.equal(states.persist.invoke.onError.target, "#system_error");
});

test("layout places a step, names the group and sets its initial", () => {
  const states = generate(
    [{ key: "leafStep", kind: "say", prompt: PROMPT, next: "endstate" }],
    {
      wrappers: { outer: { id: "outerId" } },
      place: { leafStep: ["outer"] },
      initial: { outer: "leafStep" },
      external: ["endstate"],
    }
  );
  assert.equal(states.outer.id, "outerId");
  assert.equal(states.outer.initial, "leafStep");
  assert.ok(states.outer.states.leafStep);
  // the step itself says nothing about where it sits
  assert.equal(states.outer.states.leafStep.always[0].target, "#endstate");
});

test("a step naming another step resolves to that step's id", () => {
  const states = generate([
    { key: "first", kind: "say", prompt: PROMPT, next: "second" },
    { key: "second", id: "customId", kind: "say", prompt: PROMPT, next: "first" },
  ]);
  assert.equal(states.first.always[0].target, "#customId");
  assert.equal(states.second.always[0].target, "#first");
});

test("a step naming something that is not a step fails at generate time", () => {
  assert.throws(
    () => generate([{ key: "a", kind: "say", prompt: PROMPT, next: "confidentialty" }]),
    /step 'a' points at 'confidentialty', which is not a step, a group or a declared external state/
  );
});

test("a group name resolves to the group's id", () => {
  const states = generate(
    [{ key: "jump", kind: "say", prompt: PROMPT, next: "other" },
     { key: "inner", kind: "say", prompt: PROMPT, next: "jump" }],
    {
      wrappers: { "outer.other": { id: "other" } },
      place: { inner: ["outer", "other"] },
      initial: { "outer.other": "inner" },
    }
  );
  assert.equal(states.jump.always[0].target, "#other");
});

test("assertTargets rejects an unknown target and a duplicate id", () => {
  const orphan = generate([{ key: "a", kind: "say", prompt: PROMPT, next: "#nowhere" }]);
  assert.throws(() => assertTargets({ states: orphan }), /unknown transition target '#nowhere'/);

  const twins = generate([
    { key: "a", id: "same", kind: "say", prompt: PROMPT, next: "#same" },
    { key: "b", id: "same", kind: "say", prompt: PROMPT, next: "#same" },
  ]);
  assert.throws(() => assertTargets({ states: twins }), /duplicate state id '#same'/);
});

test("assertTargets accepts targets declared outside the generated tree", () => {
  const states = generate([{ key: "a", kind: "say", prompt: PROMPT, next: "#welcome" }]);
  assert.doesNotThrow(() => assertTargets({ states }, ["welcome"]));
});

test("an unexpected input type retries instead of throwing", async () => {
  const { outputs, service } = run(
    [
      {
        key: "name",
        kind: "ask",
        accept: "text",
        prompt: PROMPT,
        slot: "n",
        next: "#endstate",
        retry: RETRY,
      },
    ],
    "name"
  );
  service.start();
  await settle();
  service.send(imageMessage());
  await settle();
  assert.deepEqual(outputs, ["PROMPT", "RETRY", "PROMPT"]);
  assert.equal(service.state.done, false);
});

test("a validate verdict bundle is used as the retry message", async () => {
  const { outputs, service } = run(
    [
      {
        key: "name",
        kind: "ask",
        accept: "text",
        prompt: PROMPT,
        slot: "n",
        next: "#endstate",
        validate: (input) => (input.length >= 3 ? true : RETRY),
      },
    ],
    "name"
  );
  service.start();
  await settle();
  service.send(textMessage("ab"));
  await settle();
  assert.deepEqual(outputs, ["PROMPT", "RETRY", "PROMPT"]);
  service.send(textMessage("abc"));
  await settle();
  assert.equal(service.state.done, true);
});

test("choose accepts the word form and writes a derived slot value", async () => {
  const { service } = run(
    [
      {
        key: "confirm",
        kind: "choose",
        prompt: PROMPT,
        options: ["Yes", "No"],
        slot: "isConfidential",
        value: (intention) => intention === "Yes",
        next: { Yes: "#endstate", No: "#endstate" },
      },
    ],
    "confirm"
  );
  service.start();
  await settle();
  service.send(textMessage("yes"));
  await settle();
  assert.equal(service.state.done, true);
  assert.equal(service.state.context.slots.pgr.isConfidential, true);
});

test("an optional ask accepts the skip token without writing its slot", async () => {
  const { service } = run(
    [
      {
        key: "upload",
        kind: "ask",
        accept: ["image", "document"],
        optional: true,
        prompt: PROMPT,
        slot: "image",
        next: "#endstate",
      },
    ],
    "upload"
  );
  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();
  assert.equal(service.state.done, true);
  assert.equal(service.state.context.slots.pgr.image, undefined);
});

test("a choose step survives a resume with a stale or absent grammar", async () => {
  const steps = [
    {
      key: "confirm",
      kind: "choose",
      prompt: PROMPT,
      options: ["Yes", "No"],
      slot: "flag",
      value: (intention) => intention === "Yes",
      next: { Yes: "#endstate", No: "#endstate" },
    },
  ];
  const machine = Machine({
    id: "root",
    initial: "confirm",
    context: {
      user: { locale: "en_IN", userId: "u1" },
      extraInfo: { tenantId: "pg" },
      slots: { pgr: {} },
      chatInterface: { toUser: () => {} },
    },
    states: Object.assign(generate(steps), { endstate: { id: "endstate", type: "final" } }),
  });

  const opened = interpret(machine).start();
  await settle();
  const persisted = JSON.parse(JSON.stringify(opened.state));
  opened.stop();

  for (const grammer of [undefined, [{ intention: "somethingElse", recognize: ["1"] }]]) {
    const restored = JSON.parse(JSON.stringify(persisted));
    if (grammer) restored.context.grammer = grammer;
    else delete restored.context.grammer;
    restored.context.chatInterface = { toUser: () => {} };

    const resolved = machine.withContext(restored.context).resolveState(State.create(restored));
    const service = interpret(machine).start(resolved);
    service.send(textMessage("1"));
    await settle();
    assert.equal(service.state.done, true);
    assert.equal(service.state.context.slots.pgr.flag, true);
  }
});

test("choose accepts an interactive button reply", async () => {
  const { service } = run(
    [
      {
        key: "confirm",
        kind: "choose",
        prompt: PROMPT,
        options: ["Yes", "No"],
        next: { Yes: "#endstate", No: "#endstate" },
      },
    ],
    "confirm"
  );
  service.start();
  await settle();
  service.send({ type: "USER_MESSAGE", message: { type: "button", input: "1" } });
  await settle();
  assert.equal(service.state.done, true);
});

test("a fill value that resolves to nothing renders as empty, not a comma", async () => {
  const { outputs, service } = run(
    [
      {
        key: "notice",
        kind: "say",
        prompt: { en_IN: "before[{{who}}]after" },
        fill: { who: () => undefined },
        next: "#endstate",
      },
    ],
    "notice"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, ["before[]after"]);
});

test("a fill whose token is absent from the message is never resolved", async () => {
  let calls = 0;
  const { outputs, service } = run(
    [
      {
        key: "notice",
        kind: "say",
        prompt: { en_IN: "no tokens here" },
        fill: {
          who: () => {
            calls += 1;
            return "x";
          },
        },
        next: "#endstate",
      },
    ],
    "notice"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, ["no tokens here"]);
  assert.equal(calls, 0);
});

test("an option with no next target is rejected at generate time", () => {
  assert.throws(
    () =>
      generate([
        {
          key: "pick",
          kind: "choose",
          prompt: PROMPT,
          options: ["Yes", "No", "Later"],
          next: { Yes: "#endstate", No: "#endstate" },
        },
      ]),
    /offers option\(s\) Later with no next target/
  );
});

test("mergeStates overlays the incoming node's own keys instead of dropping them", () => {
  const target = {
    consent: {
      id: "consentOld",
      initial: "question",
      on: { USER_RESET: "#endstate" },
      states: { question: {}, legacyExtra: {} },
    },
  };
  mergeStates(target, {
    consent: { id: "consentNew", initial: "question", states: { process: {} } },
  });
  assert.equal(target.consent.id, "consentNew");
  assert.equal(target.consent.on.USER_RESET, "#endstate");
  assert.deepEqual(Object.keys(target.consent.states), ["question", "legacyExtra", "process"]);
});

test("assertTargets rejects a compound state with no initial", () => {
  assert.throws(
    () => assertTargets({ states: { outer: { states: { inner: {} } } } }),
    /compound state 'outer' has no initial state/
  );
});

test("a prompt sequence sends each bundle with its own delay and immediacy", async () => {
  const { outputs, service } = run(
    [
      {
        key: "greet",
        kind: "say",
        prompt: [
          { bundle: { en_IN: "FIRST" }, delay: 20, immediate: false },
          { bundle: { en_IN: "SECOND" }, delay: 40 },
        ],
        next: "#endstate",
      },
    ],
    "greet"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, [], "deferred prompts must not have flushed yet");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(outputs, ["FIRST", "SECOND"]);
});

test("an ask step can write outside the pgr slot bag", async () => {
  const { service } = run(
    [
      {
        key: "name",
        kind: "ask",
        accept: "text",
        prompt: PROMPT,
        set: (context, value) => {
          context.onboarding = { name: value };
        },
        next: "#endstate",
      },
    ],
    "name"
  );
  service.start();
  await settle();
  service.send(textMessage("Ana"));
  await settle();
  assert.equal(service.state.context.onboarding.name, "Ana");
  assert.deepEqual(service.state.context.slots.pgr, {});
});

test("a guarded ask next still routes invalid input to error", async () => {
  const states = generate([
    {
      key: "name",
      kind: "ask",
      accept: "text",
      prompt: PROMPT,
      set: () => {},
      next: [{ when: () => true, to: "#endstate" }, { to: "#endstate" }],
    },
  ]);
  const always = states.name.states.process.always;
  assert.equal(always.length, 3);
  assert.equal(always[always.length - 1].target, "error");
  assert.equal(always[always.length - 1].cond, undefined);
  // every declared branch is gated on validity, so bad input cannot take one
  assert.equal(always[0].cond({ message: { isValid: false } }), false);
  assert.equal(always[1].cond({ message: { isValid: false } }), false);
});

test("a choose branch can carry its own write", async () => {
  const { service } = run(
    [
      {
        key: "confirm",
        kind: "choose",
        prompt: PROMPT,
        options: ["Yes", "No"],
        next: {
          Yes: {
            to: "#endstate",
            set: (context) => {
              context.accepted = true;
            },
          },
          No: "#endstate",
        },
      },
    ],
    "confirm"
  );
  service.start();
  await settle();
  service.send(textMessage("2"));
  await settle();
  assert.equal(service.state.context.accepted, undefined, "the No branch must not run the Yes write");
});

test("a call branch may carry a write and no message", async () => {
  const { outputs, service } = run(
    [
      {
        key: "update",
        kind: "call",
        src: async () => ({ id: 7 }),
        onDone: [
          {
            to: "#endstate",
            set: (context, event) => {
              context.savedId = event.data.id;
            },
          },
        ],
      },
    ],
    "update"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, [], "a branch with no message must send nothing");
  assert.equal(service.state.context.savedId, 7);
});

test("goto emits an atomic node with no entry action", () => {
  const states = generate([
    { key: "endstate", id: "endstate", kind: "goto", next: "start" },
    { key: "start", id: "start", kind: "gate", next: "endstate" },
  ]);
  assert.equal(states.endstate.states, undefined, "must stay atomic");
  assert.equal(states.endstate.onEntry, undefined, "must not emit a no-op entry action");
  assert.equal(states.endstate.on, undefined, "must not wait for input");
  assert.deepEqual(states.endstate.always.map((t) => t.target), ["#start"]);
});

test("goto carries guards and per-branch writes", () => {
  const states = generate([
    {
      key: "fork",
      kind: "goto",
      next: [
        { when: (c) => c.user.locale, to: "landing", set: (c) => { c.tookGuard = true; } },
        { to: "onboard" },
      ],
    },
    { key: "landing", kind: "goto", next: "fork" },
    { key: "onboard", kind: "goto", next: "fork" },
  ]);
  const always = states.fork.always;
  assert.equal(always.length, 2);
  assert.ok(always[0].cond);
  assert.ok(always[0].actions, "a guarded branch may carry a write");
  assert.equal(always[1].cond, undefined, "the last branch is unconditional");
  assert.deepEqual(always.map((t) => t.target), ["#landing", "#onboard"]);
});

test("gate blocks on USER_MESSAGE, sends nothing, and stays atomic", () => {
  const states = generate([
    { key: "start", id: "start", kind: "gate",
      next: [{ when: (c) => c.user.locale, to: "landing" }, { to: "onboard" }] },
    { key: "landing", kind: "goto", next: "start" },
    { key: "onboard", kind: "goto", next: "start" },
  ]);
  assert.equal(states.start.states, undefined, "must stay atomic — state.value is compared as a string");
  assert.equal(states.start.onEntry, undefined, "must send nothing");
  assert.equal(states.start.always, undefined, "must not transition on its own");
  assert.deepEqual(states.start.on.USER_MESSAGE.map((t) => t.target), ["#landing", "#onboard"]);
  assert.equal(states.start.on.USER_MESSAGE[1].cond, undefined);
});

test("a gate accepts any message type and never routes to an error state", async () => {
  const { outputs, service } = run(
    [
      { key: "start", id: "start", kind: "gate", next: "done" },
      { key: "done", kind: "say", prompt: PROMPT, next: "#endstate" },
    ],
    "start"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, [], "a gate sends nothing on entry");
  // a location pin carries an object input, which the ask/choose kinds reject
  service.send({ type: "USER_MESSAGE", message: { type: "location", input: { lat: 1, lng: 2 } } });
  await settle();
  assert.deepEqual(outputs, ["PROMPT"], "any type passes the gate");
  assert.equal(service.state.done, true);
});

test("assertTargets validates the machine root's own event handlers", () => {
  const states = generate([{ key: "welcome", kind: "goto", next: "welcome" }]);

  // the root's USER_RESET is a transition like any other
  assert.throws(
    () => assertTargets({ states, on: { USER_RESET: { target: "#welcomee" } } }),
    /unknown transition target '#welcomee'/
  );
  assert.doesNotThrow(() =>
    assertTargets({ states, on: { USER_RESET: { target: "#welcome" } } })
  );
});

test("a say step's effect runs at entry, so it sees the triggering event", async () => {
  const seen = [];
  const { outputs, service } = run(
    [
      {
        key: "boom",
        kind: "call",
        src: async () => { throw new Error("backend down"); },
        onDone: [{ to: "#endstate" }],
        onError: "reporter",
      },
      {
        key: "reporter",
        kind: "say",
        prompt: PROMPT,
        effect: (context, event) => seen.push(event.data ? String(event.data) : "<undefined>"),
        next: "#endstate",
      },
    ],
    "boom"
  );
  service.start();
  await settle();
  assert.deepEqual(outputs, ["PROMPT"], "the prompt is still sent");
  assert.deepEqual(seen, ["Error: backend down"], "the error payload reaches the effect");
});

test("effect runs after the prompt, preserving send-then-report order", async () => {
  // sends and the effect append to the SAME list, so the order is observable
  const order = [];
  const machine = Machine({
    id: "root",
    initial: "notice",
    context: {
      user: { locale: "en_IN", userId: "u1" },
      extraInfo: { tenantId: "pg" },
      slots: { pgr: {} },
      chatInterface: { toUser: (user, messages) => order.push(...messages.map((m) => `send:${m}`)) },
    },
    states: Object.assign(
      generate([
        {
          key: "notice",
          kind: "say",
          prompt: { en_IN: "MSG" },
          effect: () => order.push("effect"),
          next: "#done",
        },
      ]),
      { done: { id: "done", type: "final" } }
    ),
  });
  interpret(machine).start();
  await settle();
  assert.deepEqual(order, ["send:MSG", "effect"], "the message goes out before the report");
});
