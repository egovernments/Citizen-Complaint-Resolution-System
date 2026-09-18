const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

let messageRows = [];

require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"),
  filename: require.resolve("node-fetch"),
  loaded: true,
  exports: async (url) => {
    // MDMS declared-locales lookup: answer "nothing declared" so the configured
    // SUPPORTED_LOCALES are used as candidates.
    if (String(url).includes("mdms")) {
      return { status: 200, ok: true, json: async () => ({}) };
    }
    return { status: 200, ok: true, json: async () => ({ messages: messageRows }) };
  },
};

const localisationService = require(p("src/machine/util/localisation-service.js"));
const { loadLocalisationOrExit } = localisationService;

test("init throws when no configured locale has any messages", async () => {
  messageRows = [];
  await assert.rejects(() => localisationService.init(), /no messages for any configured locale/);
});

test("init reports only the locales it actually loaded", async () => {
  messageRows = [{ code: "chatbot.welcome", message: "Bem-vindo" }];
  await localisationService.init();

  assert.ok(localisationService.supportedLocales.length > 0);
  assert.equal(localisationService.getMessageForCode("chatbot.welcome", localisationService.supportedLocales[0]), "Bem-vindo");
});

test("an exhausted boot exits so the orchestrator can restart the service", async () => {
  messageRows = [];
  const realExit = process.exit;
  let exitCode;
  process.exit = (code) => {
    exitCode = code;
  };

  try {
    await loadLocalisationOrExit(1); // single attempt: no backoff sleep
  } finally {
    process.exit = realExit;
  }

  assert.equal(exitCode, 1, "must not keep serving with empty message tables");
});
