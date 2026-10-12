// Pins speech recognition language mapping for Web Speech API (#2367).
// Run from digit-ui-esbuild/:  node --test tests/voiceLocale.test.js

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/pages/citizen/Create/VoiceInput.tsx");
const OUT = path.join(os.tmpdir(), `voiceInput.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  alias: {
    "@egovernments/digit-ui-components-v2": path.resolve(__dirname, "../packages/digit-ui-components-v2/src/index.ts"),
  },
});

process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort cleanup.
  }
});

const { speechRecognitionLocale } = require(OUT);

test("maps standard app locales directly to BCP-47 speech tags", () => {
  assert.equal(speechRecognitionLocale("en_IN"), "en-IN");
  assert.equal(speechRecognitionLocale("fr_FR"), "fr-FR");
  assert.equal(speechRecognitionLocale("pt_PT"), "pt-PT");
  assert.equal(speechRecognitionLocale("pt_BR"), "pt-BR");
  assert.equal(speechRecognitionLocale("sw_KE"), "sw-KE");
});

test("maps generic or non-standard speech regions to supported dialects", () => {
  // fr_KE is not a standard speech model; defaults to fr-FR
  assert.equal(speechRecognitionLocale("fr_KE"), "fr-FR");
  assert.equal(speechRecognitionLocale("fr"), "fr-FR");

  // pt_MZ (Mozambique) maps to standard European Portuguese
  assert.equal(speechRecognitionLocale("pt_MZ"), "pt-PT");
  assert.equal(speechRecognitionLocale("pt"), "pt-PT");
});

test("respects browser's regional dialect when available for better accent recognition", () => {
  const origNav = global.navigator;
  try {
    global.navigator = { languages: ["en-KE", "sw-KE"] };
    assert.equal(speechRecognitionLocale("en_IN"), "en-KE");

    global.navigator = { languages: ["fr-CA", "en-US"] };
    assert.equal(speechRecognitionLocale("fr"), "fr-CA");

    global.navigator = { languages: ["pt-BR", "en-US"] };
    assert.equal(speechRecognitionLocale("pt"), "pt-BR");
  } finally {
    global.navigator = origNav;
  }
});

test("dynamically resolves active locale from Digit.SessionStorage when no argument is passed", () => {
  const origWindow = global.window;
  const origNav = global.navigator;
  try {
    delete global.navigator;
    global.window = {
      Digit: {
        SessionStorage: {
          get: (k) => (k === "locale" ? "fr_FR" : null),
        },
      },
    };
    assert.equal(speechRecognitionLocale(), "fr-FR");

    global.window.Digit.SessionStorage.get = (k) => (k === "locale" ? "pt_PT" : null);
    assert.equal(speechRecognitionLocale(), "pt-PT");
  } finally {
    global.window = origWindow;
    global.navigator = origNav;
  }
});
