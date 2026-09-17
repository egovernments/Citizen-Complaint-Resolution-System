const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const flowDir = path.join(projectRoot, "src/machine/flow");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

// One bundle deliberately lacks pt_PT: the old check looked only at
// onboardingWelcome, so it would have offered pt_PT anyway and left this
// message in English.
stub("./shell-messages", flowDir, {
  onboarding: {
    localeMenu: { code: "x", en_IN: "menu", pt_PT: "menu pt" },
    onboardingWelcome: { code: "y", en_IN: "welcome", pt_PT: "bem-vindo" },
    nameInformation: { code: "z", en_IN: "name" },
  },
  welcome: { code: "w", en_IN: "hi", pt_PT: "ola" },
});

const platform = { locales: [] };
stub("../util/localisation-service", flowDir, {
  getLocales: () => platform.locales,
});

const { offeredLocales, localesWithFullFallback } = require(path.join(flowDir, "offered-locales.js"));

test("a locale missing from any one bundle is not offered", () => {
  assert.deepEqual([...localesWithFullFallback()].sort(), ["en_IN"]);
});

test("only locales the platform declares AND the bot can speak are offered", () => {
  platform.locales = [
    { value: "en_IN", label: "ENGLISH" },
    { value: "pt_PT", label: "PORTUGUÊS" },
  ];
  assert.deepEqual(offeredLocales(), [{ value: "en_IN", label: "ENGLISH" }]);
});

test("a locale the bot can speak but the platform does not declare is not offered", () => {
  platform.locales = [{ value: "pt_PT", label: "PORTUGUÊS" }];
  // pt_PT is not speakable here (nameInformation lacks it), so nothing matches
  assert.deepEqual(offeredLocales(), [{ value: "pt_PT", label: "PORTUGUÊS" }]);
});

test("the menu is never empty", () => {
  platform.locales = [];
  assert.deepEqual(offeredLocales(), [{ value: "pt_PT", label: "PORTUGUÊS" }]);
});
