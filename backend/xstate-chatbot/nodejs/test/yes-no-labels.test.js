const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/machine/util/localisation-service.js", {
  getMessageBundleForCode: () => undefined,
  getLocales: () => [],
});
stub("src/machine/service/egov-user-profile.js", { updateUser: async () => ({}) });
stub("src/machine/service/service-loader.js", { pgrService: {} });

const shell = require(p("src/machine/shell-machine.js"));
const pgr = require(p("src/machine/pgr-machine.js"));

/** What this QuestionState makes of a reply, for a citizen in `locale`. */
function reply(state, input, locale = "pt_PT") {
  const context = { user: { locale } };
  context[state.optionsSlot] = state.resolveOptions(context);
  return state.matchReply(context, { message: { input } });
}

// Each pair is the word the prompt actually prints. Typing it used to hit the
// retry path, because the options were the literals ['Yes','No'].
const SHOWN = [
  [shell.states.onboardingNameConfirmation, "Confirmar", "Alterar"],
  [shell.states.onBoardingUserProfileConfirmation, "Confirmar", "Alterar"],
  [pgr.states.consent, "Aceitar", "Rejeitar"],
  [pgr.states.confirmSubmission, "Submeter", "Cancelar"],
];

test("typing the word the prompt printed works", () => {
  for (const [state, yes, no] of SHOWN) {
    assert.equal(reply(state, yes), "Yes", `${state.key}: ${yes}`);
    assert.equal(reply(state, no), "No", `${state.key}: ${no}`);
  }
});

test("case and missing accents do not matter — WhatsApp keyboards drop them", () => {
  const state = pgr.states.confirmSubmission;
  assert.equal(reply(state, "SUBMETER"), "Yes");
  assert.equal(reply(state, "  submeter  "), "Yes");
  assert.equal(reply(state, "nao"), "No", "não without the tilde");
});

test("sim and não are accepted on every yes-or-no prompt", () => {
  // Whatever the buttons are called, a citizen answers a yes-or-no question
  // with yes or no. The confidentiality prompt prints two full sentences, so
  // its own labels are not something anyone would type.
  for (const [state] of SHOWN.concat([[pgr.states.confidentiality]])) {
    assert.equal(reply(state, "sim"), "Yes", state.key);
    assert.equal(reply(state, "não"), "No", state.key);
  }
});

test("the digits still work, and nothing else does", () => {
  const state = pgr.states.consent;
  assert.equal(reply(state, "1"), "Yes");
  assert.equal(reply(state, "2"), "No");
  assert.equal(reply(state, "talvez"), null, "an unrecognized reply still retries");
  assert.equal(reply(state, "3"), null);
});

test("an English-speaking citizen matches the English words", () => {
  const state = pgr.states.confirmSubmission;
  assert.equal(reply(state, "Submit", "en_IN"), "Yes");
  assert.equal(reply(state, "Cancel", "en_IN"), "No");
});
