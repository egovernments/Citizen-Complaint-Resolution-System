// Pins speech recognition language mapping for Web Speech API (#2367).
// Run from digit-ui-esbuild/:  node --test tests/voiceLocale.test.js

const { test } = require("node:test");
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

const { speechRecognitionLocale, speechLanguageLabel } = require(OUT);

// Node 21+ exposes globalThis.navigator as a configurable, getter-only property.
// Use Object.defineProperty to safely stub and restore navigator across all Node versions.
const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function stubNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreNavigator() {
  if (origNavDescriptor) {
    Object.defineProperty(globalThis, "navigator", origNavDescriptor);
  } else {
    delete globalThis.navigator;
  }
}

test("English: defaults to en-US when browser has no regional English, even with DIGIT en_IN", () => {
  stubNavigator({ languages: [] });
  try {
    assert.equal(speechRecognitionLocale("en_IN"), "en-US");
    assert.equal(speechRecognitionLocale("en"), "en-US");
    assert.equal(speechRecognitionLocale("en_US"), "en-US");
  } finally {
    restoreNavigator();
  }
});

test("English: respects browser's regional English variant when available", () => {
  stubNavigator({ languages: ["en-KE", "sw-KE"] });
  try {
    assert.equal(speechRecognitionLocale("en_IN"), "en-KE");
    assert.equal(speechRecognitionLocale("en"), "en-KE");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["en-GB"] });
  try {
    assert.equal(speechRecognitionLocale("en_IN"), "en-GB");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["en-IN"] });
  try {
    assert.equal(speechRecognitionLocale("en_IN"), "en-IN");
  } finally {
    restoreNavigator();
  }
});

test("maps French and Portuguese to canonical tags, falling back from non-standard regions", () => {
  stubNavigator({ languages: [] });
  try {
    assert.equal(speechRecognitionLocale("fr_FR"), "fr-FR");
    assert.equal(speechRecognitionLocale("fr"), "fr-FR");
    // fr_KE (Kenya French) is not a standard speech model; defaults to fr-FR
    assert.equal(speechRecognitionLocale("fr_KE"), "fr-FR");

    assert.equal(speechRecognitionLocale("pt_PT"), "pt-PT");
    assert.equal(speechRecognitionLocale("pt"), "pt-PT");
    // pt_MZ (Mozambique) maps to standard European Portuguese
    assert.equal(speechRecognitionLocale("pt_MZ"), "pt-PT");
    // pt_BR explicitly specified
    assert.equal(speechRecognitionLocale("pt_BR"), "pt-BR");
  } finally {
    restoreNavigator();
  }
});

test("only English, French and Portuguese get their own speech language; others (e.g. Swahili sw_KE) listen in English", () => {
  stubNavigator({ languages: [] });
  try {
    assert.equal(speechRecognitionLocale("sw_KE"), "en-US");
    assert.equal(speechRecognitionLocale("sw"), "en-US");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["en-KE", "sw-KE"] });
  try {
    assert.equal(speechRecognitionLocale("sw_KE"), "en-KE");
    assert.equal(speechRecognitionLocale("sw"), "en-KE");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["en-GB"] });
  try {
    assert.equal(speechRecognitionLocale("sw_KE"), "en-GB");
  } finally {
    restoreNavigator();
  }
});

test("speechLanguageLabel returns the autonym: English, Français, Português, and defaults to English for others", () => {
  assert.equal(speechLanguageLabel("en"), "English");
  assert.equal(speechLanguageLabel("en_IN"), "English");
  assert.equal(speechLanguageLabel("en_US"), "English");
  assert.equal(speechLanguageLabel("fr"), "Français");
  assert.equal(speechLanguageLabel("fr_FR"), "Français");
  assert.equal(speechLanguageLabel("pt"), "Português");
  assert.equal(speechLanguageLabel("pt_PT"), "Português");
  assert.equal(speechLanguageLabel("pt_BR"), "Português");
  assert.equal(speechLanguageLabel("sw_KE"), "English");
  assert.equal(speechLanguageLabel("sw"), "English");
});

test("respects browser's regional dialect for French and Portuguese", () => {
  stubNavigator({ languages: ["fr-CA", "en-US"] });
  try {
    assert.equal(speechRecognitionLocale("fr"), "fr-CA");
    assert.equal(speechRecognitionLocale("fr_FR"), "fr-CA");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["pt-BR", "en-US"] });
  try {
    assert.equal(speechRecognitionLocale("pt"), "pt-BR");
    assert.equal(speechRecognitionLocale("pt_PT"), "pt-BR");
  } finally {
    restoreNavigator();
  }
});

test("dynamically resolves active locale from Digit.StoreData.getCurrentLanguage when no argument passed", () => {
  stubNavigator({ languages: [] });
  const origWindow = global.window;
  try {
    global.window = {
      Digit: {
        StoreData: {
          getCurrentLanguage: () => "fr_FR",
        },
      },
    };
    assert.equal(speechRecognitionLocale(), "fr-FR");

    global.window.Digit.StoreData.getCurrentLanguage = () => "pt_PT";
    assert.equal(speechRecognitionLocale(), "pt-PT");

    global.window.Digit.StoreData.getCurrentLanguage = () => "en_IN";
    assert.equal(speechRecognitionLocale(), "en-US");
  } finally {
    global.window = origWindow;
    restoreNavigator();
  }
});

test("prioritises regional dialect over bare language tags (e.g. ['en', 'en-KE'] or ['pt', 'pt-BR'])", () => {
  stubNavigator({ languages: ["en", "en-KE"] });
  try {
    assert.equal(speechRecognitionLocale("en"), "en-KE");
    assert.equal(speechRecognitionLocale("en_IN"), "en-KE");
    assert.equal(speechRecognitionLocale("sw_KE"), "en-KE");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["pt", "pt-BR"] });
  try {
    assert.equal(speechRecognitionLocale("pt"), "pt-BR");
    assert.equal(speechRecognitionLocale("pt_PT"), "pt-BR");
  } finally {
    restoreNavigator();
  }

  stubNavigator({ languages: ["fr", "fr-CA"] });
  try {
    assert.equal(speechRecognitionLocale("fr"), "fr-CA");
    assert.equal(speechRecognitionLocale("fr_FR"), "fr-CA");
  } finally {
    restoreNavigator();
  }
});
