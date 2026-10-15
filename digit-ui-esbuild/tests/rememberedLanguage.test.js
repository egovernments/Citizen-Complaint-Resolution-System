// Pins the device's memory of the language a person picks: a new tab, the next
// visit and a sign-out all keep it, and a workspace that does not offer it falls
// back to its own first language.
// Run from digit-ui-esbuild/:  node --test tests/rememberedLanguage.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/libraries/src/services/elements/Localization/rememberedLanguage.js");
const OUT = path.join(os.tmpdir(), `rememberedLanguage.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: OUT, logLevel: "error" });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const { rememberedLanguage, rememberLanguage, pickLanguage, keepRememberedLanguage } = require(OUT);

const store = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    clear: () => map.clear(),
    entries: () => Object.fromEntries(map),
  };
};

const CITIZEN_PAGE = "/digit-ui/citizen/pgr/complaints";
const EMPLOYEE_PAGE = "/beiranovu/employee/pgr/inbox";

test("a picked language is remembered for the citizen and the employee screens", () => {
  const storage = store();
  rememberLanguage("pt_BR", storage);
  assert.equal(rememberedLanguage(storage, CITIZEN_PAGE), "pt_BR");
  assert.equal(rememberedLanguage(storage, EMPLOYEE_PAGE), "pt_BR");
});

test("each screen reads its own key", () => {
  const storage = store({ "Citizen.locale": "fr_FR", "Employee.locale": "en_IN" });
  assert.equal(rememberedLanguage(storage, CITIZEN_PAGE), "fr_FR");
  assert.equal(rememberedLanguage(storage, EMPLOYEE_PAGE), "en_IN");
});

test("nothing or junk remembered reads as nothing, and junk is never written", () => {
  for (const junk of [undefined, "undefined", "null", "", "fr"]) {
    const storage = store(junk === undefined ? {} : { "Citizen.locale": junk });
    assert.equal(rememberedLanguage(storage, CITIZEN_PAGE), null, `${junk}`);
    const before = storage.entries();
    rememberLanguage(junk, storage);
    assert.deepEqual(storage.entries(), before, `${junk} written`);
  }
  assert.equal(rememberedLanguage(null, CITIZEN_PAGE), null);
});

const LANGUAGES = [
  { label: "ENGLISH", value: "en_IN" },
  { label: "FRANÇAIS", value: "fr_FR" },
  { label: "PORTUGUÊS", value: "pt_BR" },
];

test("a workspace uses the remembered language when it offers it, else its first", () => {
  assert.equal(pickLanguage(LANGUAGES, "fr_FR"), "fr_FR");
  assert.equal(pickLanguage(LANGUAGES, "sw_KE"), "en_IN");
  assert.equal(pickLanguage(LANGUAGES, null), "en_IN");
  assert.equal(pickLanguage([{ value: "pt_BR" }, { value: "en_IN" }], undefined), "pt_BR");
});

test("signing out wipes the session but keeps the language", () => {
  const storage = store({ "Citizen.locale": "fr_FR", "Employee.locale": "fr_FR", "Employee.token": "secret" });
  keepRememberedLanguage(() => storage.clear(), storage);
  assert.deepEqual(storage.entries(), { "Citizen.locale": "fr_FR", "Employee.locale": "fr_FR" });
});

test("signing out with nothing remembered leaves nothing behind", () => {
  const storage = store({ "Citizen.locale": "undefined", token: "secret" });
  keepRememberedLanguage(() => storage.clear(), storage);
  assert.deepEqual(storage.entries(), {});
});
