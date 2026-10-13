// Every key the citizen and employee UI asks for by name must ship in the
// en_IN seed (so admins can find and override it from the localisation
// screen) and in the fr_FR and pt_PT packs (so switching language doesn't
// leave English behind, #2445).
// Run from digit-ui-esbuild/:  node --test tests/localizationPacks.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const UI_ROOT = path.resolve(__dirname, "..");
const SEED_ROOT = path.resolve(
  UI_ROOT,
  "../utilities/default-data-handler/src/main/resources/localisations",
);
const MODULES = ["rainmaker-pgr", "rainmaker-common", "rainmaker-hr"];
const LOCALES = ["fr_FR", "pt_PT"];
const SOURCE_DIRS = ["products/pgr/src", "packages/modules/core/src", "packages/libraries/src/services/auth", "src"];

// Keys from upstream DIGIT screens that CCRS bundles but never routes to
// (microplan, water and sewerage, audit history, sandbox sign-up).
const UPSTREAM_ONLY =
  /^(MP_|WBH_|HCM_|WS_|PAY_|BUILDING_|APPLICATION_PROCESSING_|OF_BILL_|AUDIT_|ACTION_TEST_WATER|SB_FORGOTORGANIZATION_|CASE_NOT_HANDLED$|FAILED_TO_(UN)?ASSIGN_CAMPAIGN$|ASSIGNED_SUCCESSFULLY$|UNASSIGN(ED_SUCCESSFULLY)?$|VIEW_AUDIT_LOGS$|NO_DRAFT_FILE_FOUND$|PLEASE_(FINISH|UPDATE)_|GUIDE_TO_SETUP$|ES_INBOX_APPLICATION_NO$|START$|TAKE_ACTION$|PT_COMMON_GENDER_MALE$|NEXT$|SUBMIT$|FORM_STEP$)/;

// Keys built at runtime or picked in a ternary, which the patterns below
// can't see: the employee action menu (t(action), t(`${action}_SUCCESSFULLY`)),
// the timeline (t(`CS_COMMON_${status}`)), the account page
// (`CORE_IDENTITY_${name}`), the employee side bar (ACTION_TEST_<NAME>) and
// texts chosen by a condition.
const WORKFLOW_ACTIONS = ["ASSIGN", "REASSIGN", "REJECT", "RESOLVE", "REOPEN", "ESCALATE"];
const RUNTIME_KEYS = [
  ...WORKFLOW_ACTIONS,
  ...WORKFLOW_ACTIONS.map((action) => `${action}_SUCCESSFULLY`),
  "CS_COMMON_PENDINGFORASSIGNMENT_AFTERREOPEN",
  "CORE_IDENTITY_UPDATE_PASSWORD",
  "CORE_IDENTITY_CONFIGURE_TOTP",
  "CORE_IDENTITY_UPDATE_EMAIL",
  "CORE_IDENTITY_SURFACE_CITIZEN",
  "CORE_IDENTITY_SURFACE_EMPLOYEE",
  "ACTION_TEST_HOME",
  "BACK",
  "CORE_COMMON_HOME",
  "CORE_COMMON_PROFILE_UPDATE_ERROR",
  "CORE_COMMON_PROFILE_PREFERENCE_UPDATE_ERROR",
  "CS_COMMON_COMPLAINT_SUBMIT_RETRY",
  "CS_FILE_ONE_PHOTO",
  "CS_FILE_N_PHOTOS",
];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

// Ways a key reaches t(): called with it, returned as a `messageKey`, paired
// with its English in a `[KEY, "English"]` table, or listed as
// `{ key: KEY, fallback: "English" }` for a later t(step.key, step.fallback).
const KEY_PATTERNS = [
  /\b(?:t|tr|say|translateOr|translate|tt)\(\s*(?:t\s*,\s*)?["'`]([A-Za-z][A-Za-z0-9_.]*)["'`]/g,
  /\bmessageKey:\s*"([A-Z][A-Z0-9_]+)"/g,
  /\[\s*"([A-Z][A-Z0-9_]+)",\s*"[^"]*[a-z][^"]*"/g,
  /\bkey:\s*"([A-Z][A-Z0-9_]+)",\s*fallback:/g,
];

// identityMessage(code) builds CORE_IDENTITY_<code> from its MESSAGES table.
function identityMessageKeys() {
  const file = path.join(UI_ROOT, "packages/libraries/src/services/auth/identityMessages.js");
  const table = fs.readFileSync(file, "utf8").split("const MESSAGES = {")[1].split("};")[0];
  return [...table.matchAll(/^\s+([A-Z_]+):/gm)].map((m) => `CORE_IDENTITY_${m[1]}`).concat("CORE_IDENTITY_UNAVAILABLE");
}

function literalKeys() {
  const keys = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(UI_ROOT, dir))) {
      const source = fs.readFileSync(file, "utf8");
      for (const pattern of KEY_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const key = match[1];
          if (key.endsWith("_") || key.endsWith(".") || UPSTREAM_ONLY.test(key)) continue;
          if (!keys.has(key)) keys.set(key, path.relative(UI_ROOT, file));
        }
      }
    }
  }
  for (const key of identityMessageKeys()) if (!keys.has(key)) keys.set(key, "identityMessages.js");
  for (const key of RUNTIME_KEYS) if (!keys.has(key)) keys.set(key, "built at runtime");
  return keys;
}

function pack(locale) {
  const messages = new Map();
  for (const module of MODULES) {
    const file = path.join(SEED_ROOT, locale, `${module}.json`);
    if (!fs.existsSync(file)) continue;
    for (const m of JSON.parse(fs.readFileSync(file, "utf8"))) {
      assert.equal(m.locale, locale, `${locale}/${module}.json: ${m.code} has locale ${m.locale}`);
      assert.equal(m.module, module, `${locale}/${module}.json: ${m.code} has module ${m.module}`);
      if (!messages.has(m.code)) messages.set(m.code, m.message);
    }
  }
  return messages;
}

const placeholders = (text) => (String(text).match(/\{[^{}]*\}|%s|<\/?[a-z]+>/g) || []).sort();

test("every key the UI asks for by name is seeded in en_IN", () => {
  const english = pack("en_IN");
  const missing = [...literalKeys()].filter(([key]) => !english.has(key)).map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(missing, [], `missing en_IN keys:\n${missing.join("\n")}`);
});

for (const locale of LOCALES) {
  test(`every key the UI asks for by name is translated in ${locale}`, () => {
    const translated = pack(locale);
    const missing = [...literalKeys()].filter(([key]) => !translated.has(key)).map(([key, file]) => `${key} (${file})`);
    assert.deepEqual(missing, [], `missing ${locale} keys:\n${missing.join("\n")}`);
  });

  test(`${locale} messages are non-empty and keep the English placeholders`, () => {
    const english = pack("en_IN");
    const problems = [];
    for (const [code, message] of pack(locale)) {
      if (!english.has(code)) problems.push(`${code}: not in en_IN`);
      else if (typeof message !== "string" || !message.trim()) problems.push(`${code}: empty`);
      else if (placeholders(message).join() !== placeholders(english.get(code)).join()) problems.push(`${code}: placeholders differ`);
    }
    assert.deepEqual(problems, []);
  });
}
