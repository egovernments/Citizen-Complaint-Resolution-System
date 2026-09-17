const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { join } = require(path.join(__dirname, "..", "src/machine/flow/join.js"));

const say = (key) => ({ key, kind: "say", prompt: { en_IN: "x" } });

// --- the four exit forms ---------------------------------------------------

test("a string exit becomes an unconditional next", () => {
  const { steps } = join([say("a"), say("b")], { exits: { a: "b", b: "a" } });
  assert.deepEqual(steps[0].next, { to: "b" });
});

test("pair form carries the guard; a bare pair is the unconditional tail", () => {
  const guard = (context) => context.user.locale;
  const { steps } = join([say("start"), say("welcome"), say("onboarding")], {
    exits: {
      start: [["welcome", guard], ["onboarding"]],
      welcome: "start",
      onboarding: "start",
    },
  });
  assert.deepEqual(steps[0].next, [{ to: "welcome", when: guard }, { to: "onboarding" }]);
});

test("an option map becomes a choose next, and reserved keys are excluded", () => {
  const states = [
    { key: "consent", kind: "choose", options: ["Yes", "No"], prompt: { en_IN: "x" } },
    say("confidentiality"), say("declined"),
  ];
  const { steps } = join(states, {
    exits: {
      consent: { Yes: "confidentiality", No: "declined", onError: "declined" },
      confidentiality: "consent",
      declined: "consent",
    },
  });
  assert.deepEqual(steps[0].next, { Yes: "confidentiality", No: "declined" });
});

test("onAny gives every recognised option one destination, alongside onUnknown", () => {
  const states = [
    { key: "locale", kind: "choose", options: () => [], prompt: { en_IN: "x" },
      onUnknown: { set: () => {} } },
    say("welcome"),
  ];
  const { steps } = join(states, {
    exits: { locale: { onAny: "welcome", onUnknown: "welcome" }, welcome: "locale" },
  });
  assert.deepEqual(steps[0].next, { to: "welcome" });
  assert.equal(steps[0].onUnknown.to, "welcome");
  assert.equal(typeof steps[0].onUnknown.set, "function", "the state's write survives the join");
});

// --- payload stays with the state -----------------------------------------

test("a walk keeps its slot write and gains only the target", () => {
  const write = () => {};
  const states = [
    { key: "boundary", kind: "walk", pathSlot: "p", stepSlot: "s", fetch: async () => ({}),
      onLeaf: { slot: "locality", set: write }, onEmpty: { slot: "locality" } },
    say("consent"),
  ];
  const { steps } = join(states, {
    exits: { boundary: { onLeaf: "consent", onEmpty: "consent" }, consent: "boundary" },
  });
  assert.deepEqual(steps[0].onLeaf, { slot: "locality", set: write, to: "consent" });
  assert.deepEqual(steps[0].onEmpty, { slot: "locality", to: "consent" });
});

test("call outcomes join by name, not by position, and keep their message", () => {
  const guard = () => true;
  const states = [
    { key: "track", kind: "call", src: async () => [],
      onDone: {
        hasRecords: { when: guard, message: { en_IN: "list" } },
        noRecords: { message: { en_IN: "none" } },
      } },
    say("endstate"),
  ];
  const { steps } = join(states, {
    exits: { track: { hasRecords: "endstate", noRecords: "endstate" }, endstate: "track" },
  });
  assert.deepEqual(steps[0].onDone, [
    { when: guard, message: { en_IN: "list" }, to: "endstate" },
    { message: { en_IN: "none" }, to: "endstate" },
  ]);
});

test("an explicit onError overrides the generator default", () => {
  const states = [
    { key: "save", kind: "call", src: async () => ({}), onDone: { ok: {} } },
    say("welcome"),
  ];
  const { steps } = join(states, {
    exits: { save: { ok: "welcome", onError: "welcome" }, welcome: "save" },
  });
  assert.equal(steps[0].onError, "welcome");
});

// --- the checks ------------------------------------------------------------

test("an exit for a step that does not exist is rejected", () => {
  assert.throws(
    () => join([say("a")], { exits: { a: "a", tpyo: "a" } }),
    /transitions declare an exit for 'tpyo', which is not a state/
  );
});

test("a state with no exit is rejected, and the message names its kind", () => {
  assert.throws(
    () => join([say("a"), say("orphan")], { exits: { a: "a" } }),
    /state 'orphan' \(say\) has no exit in transitions/
  );
});

test("a call whose last outcome carries a guard is rejected", () => {
  const states = [
    { key: "track", kind: "call", src: async () => [],
      onDone: { empty: { message: {} }, hasRecords: { when: () => true, message: {} } } },
  ];
  assert.throws(
    () => join(states, { exits: { track: { empty: "track", hasRecords: "track" } } }),
    /declares outcome 'hasRecords' last, but it carries a guard/
  );
});

test("a group starting at a step that does not exist is rejected", () => {
  assert.throws(
    () => join([say("a")], { exits: { a: "a" }, entry: { group: "nope" } },
               { wrappers: { group: { id: "group" } } }),
    /'group' starts at 'nope', which is not a state or a group/
  );
});

test("a group may start at a nested group rather than a step", () => {
  const { layout } = join([say("institution")], { exits: { institution: "institution" }, entry: { fileComplaint: "other" } },
    { wrappers: { "fileComplaint.other": { id: "other" } }, place: { institution: ["fileComplaint", "other"] } });
  assert.equal(layout.initial.fileComplaint, "other");
});

test("an entry for a group the layout does not have is rejected", () => {
  assert.throws(
    () => join([say("a")], { exits: { a: "a" }, entry: { "fileComplaint.typo": "a" } },
               { wrappers: { "fileComplaint.type": { id: "pgrType" } } }),
    /entry declares a start for 'fileComplaint.typo', which is not a group in the layout/
  );
});

test("the journey root is a legitimate entry key", () => {
  const { layout } = join([say("menu")], { exits: { menu: "menu" }, entry: { pgr: "menu" } }, { root: "pgr" });
  assert.equal(layout.initial.pgr, "menu");
});

// --- layout passthrough ----------------------------------------------------

test("entry becomes the layout's initial map, leaving the rest of layout alone", () => {
  const { layout } = join(
    [say("institution")],
    { exits: { institution: "institution" }, entry: { "fileComplaint.other": "institution" } },
    { wrappers: { "fileComplaint.other": { id: "other" } }, place: {}, external: ["endstate"] }
  );
  assert.deepEqual(layout.initial, { "fileComplaint.other": "institution" });
  assert.deepEqual(layout.wrappers, { "fileComplaint.other": { id: "other" } });
  assert.deepEqual(layout.external, ["endstate"]);
});

test("the join does not mutate the authored states", () => {
  const states = [say("a"), say("b")];
  const before = JSON.stringify(states);
  join(states, { exits: { a: "b", b: "a" } });
  assert.equal(JSON.stringify(states), before);
});

// --- the check the split exposed ------------------------------------------

test("static options routed by onAny are accepted, not reported as unrouted", () => {
  const { generate } = require(path.join(__dirname, "..", "src/machine/flow/generate.js"));
  const states = [
    { key: "consent", kind: "choose", options: ["Yes", "No"], prompt: { en_IN: "x" } },
    say("next"),
  ];
  const { steps } = join(states, { exits: { consent: { onAny: "next" }, next: "consent" } });
  const emitted = generate(steps);
  assert.deepEqual(emitted.consent.states.process.always.map((t) => t.target), ["#next", "error"]);
});

test("an option with no destination is still reported", () => {
  const { generate } = require(path.join(__dirname, "..", "src/machine/flow/generate.js"));
  const states = [
    { key: "consent", kind: "choose", options: ["Yes", "No"], prompt: { en_IN: "x" } },
    say("next"),
  ];
  const { steps } = join(states, { exits: { consent: { Yes: "next" }, next: "consent" } });
  assert.throws(() => generate(steps), /step 'consent' offers option\(s\) No with no next target/);
});
