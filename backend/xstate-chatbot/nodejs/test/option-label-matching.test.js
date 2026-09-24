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

const dialog = require(p("src/machine/util/dialog.js"));

function walkLevel({ goback = true } = {}) {
  const { prompt, grammer } = dialog.constructListPromptAndGrammer(
    ["SAUDE", "EDUCACAO"], {}, "pt_PT", false, goback
  );
  return { prompt, say: (input) => dialog.get_intention(grammer, { message: { input } }, true) };
}

test("a level below the root offers Voltar, and the word works as well as the number", () => {
  const { prompt, say } = walkLevel();

  assert.match(prompt, /Voltar/, "the option is displayed");
  assert.equal(say("3"), dialog.INTENTION_GOBACK, "picking its number still works");
  assert.equal(say("voltar"), dialog.INTENTION_GOBACK, "and so does typing the word");
  assert.equal(say("VOLTAR"), dialog.INTENTION_GOBACK);
});

test("the root level has no Voltar, so the word is not recognized there", () => {
  const { prompt, say } = walkLevel({ goback: false });

  assert.doesNotMatch(prompt, /Voltar/);
  assert.equal(say("voltar"), dialog.INTENTION_UNKOWN, "nothing to step back to; the state re-prompts");
});

test("any option matches by its displayed label, with or without accents", () => {
  const { say } = walkLevel();

  assert.equal(say("saude"), "SAUDE");
  assert.equal(say("SAÚDE"), "SAUDE", "typed exactly as displayed, accents included");
  assert.equal(say("educacao"), "EDUCACAO");
  assert.equal(say("2"), "EDUCACAO");
  assert.equal(say("xyz"), dialog.INTENTION_UNKOWN);
});

test("accented keyword lists still match, with and without diacritics", () => {
  const reset = [{ intention: "reset", recognize: ["começar", "reiniciar"] }];
  const say = (input) => dialog.get_intention(reset, { message: { input } }, true);

  assert.equal(say("começar"), "reset");
  assert.equal(say("comecar"), "reset", "a keyboard that drops the cedilla still resets");
  assert.equal(say("reiniciar"), "reset");
  assert.equal(say("voltar"), dialog.INTENTION_UNKOWN, "voltar is no longer a reset word");
});
