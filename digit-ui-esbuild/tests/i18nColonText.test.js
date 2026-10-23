// Pins that t() returns text with a colon whole. Citizen-written text (a
// complaint's description, a comment) reaches t() on the complaint pages, and
// with i18next's default namespace separator everything before the first ":"
// was read as a namespace and dropped: "Note: the drain is blocked" showed
// " the drain is blocked".
// Run from digit-ui-esbuild/:  node --test tests/i18nColonText.test.js

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `i18nColonText.${process.pid}.cjs`);
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

let i18next;
before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { initI18n } from ${JSON.stringify(path.join(root, "packages/libraries/src/translations/index.js"))};
        export { default as i18next } from "i18next";
      `,
      resolveDir: root,
    },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, logLevel: "error",
  });
  global.window = {};
  global.Digit = {
    StoreData: { getCurrentLanguage: () => "en_IN" },
    Utils: { getDefaultLanguage: () => "en_IN" },
  };
  const lib = require(OUT);
  await new Promise((resolve) => lib.initI18n(resolve));
  i18next = lib.i18next;
  i18next.addResources("en_IN", "translations", { CS_COMMON_SEARCH: "Search", CS_GREETING: "Hello {NAME}" });
});

test("text with a colon comes back whole", () => {
  for (const text of [
    "Note: the drain near the school is blocked",
    "Blocked since 10:30 am. Ref: KE-1234",
    "https://maps.google.com/?q=-1.31,36.78",
  ]) {
    assert.equal(i18next.t(text), text);
  }
});

test("keys still translate, and templates still fill", () => {
  assert.equal(i18next.t("CS_COMMON_SEARCH"), "Search");
  assert.equal(i18next.t("CS_GREETING", { name: "Achieng" }), "Hello Achieng");
  assert.equal(i18next.t("CS_MISSING_KEY", "Fallback: with a colon"), "Fallback: with a colon");
});
