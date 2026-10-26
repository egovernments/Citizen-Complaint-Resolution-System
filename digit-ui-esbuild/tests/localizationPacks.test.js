// Every key the citizen and employee UI asks for by name must ship in the
// en_IN seed (so admins can find and override it from the localisation
// screen) and in every translated pack (so switching language doesn't
// leave English behind, #2445). The onboarding packs are the ones new
// workspaces receive, so they are held to the same rule.
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
const ONBOARDING_ROOT = path.resolve(
  UI_ROOT,
  "../backend/pgr-services/src/main/resources/onboarding/l10n",
);
const MODULES = ["rainmaker-pgr", "rainmaker-common", "rainmaker-hr"];
const PACK_SETS = [
  { name: "default-data-handler", root: SEED_ROOT, locales: ["fr_FR", "pt_PT"] },
  { name: "onboarding", root: ONBOARDING_ROOT, locales: ["fr_FR", "pt_BR"] },
];
const SOURCE_DIRS = [
  "products/pgr/src",
  "packages/modules/core/src",
  "packages/libraries/src/services/auth",
  "packages/digit-ui-components-v2/src",
  "src",
  // The dashboard's own pages load rainmaker-dashboard and pass English to
  // every t(). Its card on the employee home renders before that module
  // loads, so the card's title comes from these packs.
  "products/dashboard/DashboardCard.js",
];

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
  if (fs.statSync(dir).isFile()) return [dir];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

// Ways a key reaches t(): called with it, returned as a `messageKey`, paired
// with its English in a `[KEY, "English"]` table, or listed as
// `{ key: KEY, fallback: "English" }` for a later t(step.key, step.fallback),
// or held as `const key = KEY` for a t(key) === key fallback check.
const KEY_PATTERNS = [
  /\b(?:t|tr|say|translateOr|translate|tt)\(\s*(?:t\s*,\s*)?["'`]([A-Za-z][A-Za-z0-9_.]*)["'`]/g,
  /\bmessageKey:\s*"([A-Z][A-Z0-9_]+)"/g,
  /\[\s*"([A-Z][A-Z0-9_]+)",\s*"[^"]*[a-z][^"]*"/g,
  /\bkey:\s*"([A-Z][A-Z0-9_]+)",\s*fallback:/g,
  /\bconst key = "([A-Z][A-Z0-9_]+)";/g,
];

// identityMessage(code) builds CORE_IDENTITY_<code> from its MESSAGES table.
function identityMessageKeys() {
  const file = path.join(UI_ROOT, "packages/libraries/src/services/auth/identityMessages.js");
  const table = fs.readFileSync(file, "utf8").split("const MESSAGES = {")[1].split("};")[0];
  return [...table.matchAll(/^\s+([A-Z_]+):/gm)].map((m) => `CORE_IDENTITY_${m[1]}`).concat("CORE_IDENTITY_UNAVAILABLE");
}

// Keys built from the PGR constants: t(`${LOCALIZATION_KEY.CS_REOPEN}_OPTION_ONE`),
// t(LOCALE.MY_COMPLAINTS). Resolved through constants/Localization.js, so a new
// template-built key is held to the same rules as a literal one.
const CONSTANTS = path.join(UI_ROOT, "products/pgr/src/constants/Localization.js");
function constantTable(name) {
  const body = fs.readFileSync(CONSTANTS, "utf8").split(`export const ${name} = {`)[1].split("};")[0];
  return new Map([...body.matchAll(/^\s+([A-Z_]+):\s*"([A-Z0-9_]+)"/gm)].map((m) => [m[1], m[2]]));
}
function templateKeys() {
  const prefixes = constantTable("LOCALIZATION_KEY");
  const named = constantTable("LOCALE");
  const keys = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(UI_ROOT, dir))) {
      const source = fs.readFileSync(file, "utf8");
      const where = path.relative(UI_ROOT, file);
      for (const m of source.matchAll(/`\$\{LOCALIZATION_KEY\.([A-Z_]+)\}([A-Z0-9_]+)`/g)) {
        assert.ok(prefixes.has(m[1]), `${where}: LOCALIZATION_KEY.${m[1]} is not in constants/Localization.js`);
        keys.set(prefixes.get(m[1]) + m[2], where);
      }
      for (const m of source.matchAll(/\bLOCALE\.([A-Z_]+)\b/g)) if (named.has(m[1])) keys.set(named.get(m[1]), where);
    }
  }
  return keys;
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
  for (const [key, file] of templateKeys()) if (!keys.has(key)) keys.set(key, file);
  for (const key of identityMessageKeys()) if (!keys.has(key)) keys.set(key, "identityMessages.js");
  for (const key of RUNTIME_KEYS) if (!keys.has(key)) keys.set(key, "built at runtime");
  return keys;
}

function pack(locale, root = SEED_ROOT) {
  const messages = new Map();
  for (const module of MODULES) {
    const file = path.join(root, locale, `${module}.json`);
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

for (const { name, root, locales } of PACK_SETS) {
  test(`every key the UI asks for by name is seeded in ${name} en_IN`, () => {
    const english = pack("en_IN", root);
    const missing = [...literalKeys()].filter(([key]) => !english.has(key)).map(([key, file]) => `${key} (${file})`);
    assert.deepEqual(missing, [], `missing en_IN keys:\n${missing.join("\n")}`);
  });

  for (const locale of locales) {
    test(`every key the UI asks for by name is translated in ${name} ${locale}`, () => {
      const translated = pack(locale, root);
      const missing = [...literalKeys()].filter(([key]) => !translated.has(key)).map(([key, file]) => `${key} (${file})`);
      assert.deepEqual(missing, [], `missing ${locale} keys:\n${missing.join("\n")}`);
    });

    test(`${name} ${locale} messages are non-empty and keep the English placeholders`, () => {
      const english = pack("en_IN", root);
      const problems = [];
      for (const [code, message] of pack(locale, root)) {
        if (!english.has(code)) problems.push(`${code}: not in en_IN`);
        else if (typeof message !== "string" || !message.trim()) problems.push(`${code}: empty`);
        else if (placeholders(message).join() !== placeholders(english.get(code)).join()) problems.push(`${code}: placeholders differ`);
      }
      assert.deepEqual(problems, []);
    });
  }
}

// A deployment's root and city get pg's packs for every locale in pg's
// StateInfo (tenant_bootstrap), so the pg seed must carry the onboarding packs
// those locales ship to new workspaces, word for word.
const DUMP = path.resolve(UI_ROOT, "../local-setup/db/full-dump.sql");
const unescapeCopy = (value) =>
  value.replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t", r: "\r" })[c] ?? c);

function pgSeed() {
  const lines = fs.readFileSync(DUMP, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("COPY public.message "));
  const messages = new Map();
  for (const line of lines.slice(start + 1)) {
    if (line === "\\.") break;
    const [, locale, code, message, tenantId, module] = line.split("\t");
    if (tenantId === "pg") messages.set(`${locale}|${module}|${unescapeCopy(code)}`, unescapeCopy(message));
  }
  const stateInfo = lines.find((line) => line.split("\t")[1] === "pg" && line.includes("\tcommon-masters.StateInfo\t{"));
  const languages = JSON.parse(stateInfo.split("\t")[4]).languages.map((language) => language.value);
  return { messages, languages };
}

// Complaint-type labels belong to each workspace's own hierarchy, not to the
// platform packs; pg seeds its demo categories itself.
const WORKSPACE_OWNED = /^COMPLAINT_HIERARCHY\./;
const onboarding = PACK_SETS.find((set) => set.name === "onboarding");
for (const locale of onboarding.locales) {
  test(`the pg seed lists ${locale} and carries the onboarding ${locale} packs`, () => {
    const { messages, languages } = pgSeed();
    assert.ok(languages.includes(locale), `pg StateInfo languages are ${languages.join(", ")}`);
    const problems = [];
    let packed = 0;
    for (const module of MODULES) {
      for (const m of JSON.parse(fs.readFileSync(path.join(ONBOARDING_ROOT, locale, `${module}.json`), "utf8"))) {
        packed++;
        const seeded = messages.get(`${locale}|${module}|${m.code}`);
        if (seeded !== m.message) problems.push(`${module} ${m.code}: seed ${JSON.stringify(seeded)}`);
      }
    }
    const extra = [...messages.keys()].filter((key) => key.startsWith(`${locale}|`) && !WORKSPACE_OWNED.test(key.split("|")[2])).length - packed;
    assert.deepEqual(problems, []);
    assert.equal(extra, 0, `pg carries ${extra} ${locale} messages the onboarding packs do not`);
  });

  // Without an en_IN row at pg, an English screen shows the raw code where the
  // French or Portuguese one is translated (the onboarding en_IN pack is not what
  // seeds pg's English).
  test(`every ${locale} code at pg has an en_IN row at pg`, () => {
    const { messages } = pgSeed();
    const english = new Set([...messages.keys()].filter((key) => key.startsWith("en_IN|")).map((key) => key.split("|")[2]));
    const missing = [...messages.keys()].filter((key) => key.startsWith(`${locale}|`)).map((key) => key.split("|")[2]).filter((code) => !english.has(code));
    assert.deepEqual(missing, [], `${missing.length} ${locale} codes at pg have no en_IN row`);
  });

  // The integration suite counts pg as multi-locale now, and its CCRS#42 spec wants a
  // label for every complaint category in every advertised locale.
  test(`every complaint category label at pg is translated into ${locale}`, () => {
    const { messages } = pgSeed();
    const categories = [...messages.keys()].filter((key) => key.startsWith("en_IN|") && key.split("|")[2].startsWith("COMPLAINT_HIERARCHY."));
    assert.ok(categories.length > 0, "pg seeds no COMPLAINT_HIERARCHY.* labels");
    const missing = categories.map((key) => key.replace(/^en_IN\|/, `${locale}|`)).filter((key) => !messages.get(key));
    assert.deepEqual(missing, []);
  });
}
