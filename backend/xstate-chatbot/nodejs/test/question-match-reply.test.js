const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

require.cache[p("src/machine/util/localisation-service.js")] = {
  id: p("src/machine/util/localisation-service.js"),
  filename: p("src/machine/util/localisation-service.js"),
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined, getLocales: () => [] },
};

const QuestionState = require(p("src/machine/flow/flow-state-question.js"));

const LOCALES = [
  { value: "pt_PT", label: "PORTUGUÊS" },
  { value: "en_IN", label: "ENGLISH" },
];

function ask(options = LOCALES) {
  const state = new QuestionState("onboardingLocale").setOptions(options);
  const context = { [state.optionsSlot]: options, user: {} };
  return (input) => state.matchReply(context, { message: { input } });
}

test("the number the citizen was shown still matches", () => {
  const reply = ask();
  assert.equal(reply("1"), "pt_PT");
  assert.equal(reply("2"), "en_IN");
});

test("the displayed label matches — the case that silently defaulted to en_IN", () => {
  const reply = ask();
  assert.equal(reply("PORTUGUÊS"), "pt_PT");
  assert.equal(reply("Português"), "pt_PT", "case-insensitive");
  assert.equal(reply("portugues"), "pt_PT", "accent-insensitive — WhatsApp keyboards drop diacritics");
  assert.equal(reply("  english  "), "en_IN", "surrounding whitespace is ignored");
});

test("the raw value still matches", () => {
  const reply = ask();
  assert.equal(reply("pt_PT"), "pt_PT");
  assert.equal(reply("en_in"), "en_IN");
});

test("an unrecognized reply returns null, so the state re-prompts", () => {
  const reply = ask();
  assert.equal(reply("espanhol"), null);
  assert.equal(reply("9"), null);
});

test("plain-string options match by label and by index", () => {
  const reply = ask(["Saúde", "Educação"]);
  assert.equal(reply("saude"), "Saúde");
  assert.equal(reply("2"), "Educação");
});

test("a reply that is only partly a number is not treated as a menu choice", () => {
  // parseInt('2.5') is 2 and parseInt('1abc') is 1, so these used to select an
  // option the citizen never typed instead of re-asking.
  const reply = ask();
  for (const input of ["1abc", "2.5", "3 4", "1)"]) {
    assert.equal(reply(input), null, `"${input}" is not a choice`);
  }
});
