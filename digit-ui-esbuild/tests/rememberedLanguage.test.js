// Pins the device's memory of the language a person picks: a new tab, the next
// visit, signing in and every storage wipe keep it, a workspace that does not offer
// it falls back to its own first language without forgetting it, and a partial pack
// still has the default language's messages to fall back on.
// Run from digit-ui-esbuild/:  node --test tests/rememberedLanguage.test.js

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `rememberedLanguage.${process.pid}.cjs`);
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

let lib;
before(async () => {
  const src = (p) => JSON.stringify(path.join(root, p));
  await esbuild.build({
    stdin: {
      contents: `
        export * from ${src("packages/libraries/src/services/elements/Localization/rememberedLanguage.js")};
        export * from ${src("packages/libraries/src/services/atoms/Utils/deviceStorage.js")};
        export { LocalizationService } from ${src("packages/libraries/src/services/elements/Localization/service.js")};
        export { setCitizenDetail } from ${src("packages/modules/core/src/components/citizenSession.js")};
        export { setEmployeeDetail } from ${src("packages/modules/core/src/components/employeeSession.js")};
      `,
      resolveDir: root,
    },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, logLevel: "error",
    // The localization service's network, cache and i18next edges are in-memory doubles.
    plugins: [{ name: "doubles", setup(build) {
      build.onResolve({ filter: /\/atoms\/Utils\/Request$|\/atoms\/Utils\/Storage$|\/atoms\/ApiCacheService$|\/atoms\/urls$|^i18next$/ },
        (args) => ({ path: path.basename(args.path), namespace: "double" }));
      build.onLoad({ filter: /.*/, namespace: "double" }, (args) => ({ contents: {
        Request: `export const Request = async ({ params }) => {
          globalThis.__requests.push(params.locale + ":" + params.module);
          return { messages: params.module.split(",").map((module) => ({ module, code: "CS_COMMON_SEARCH", message: params.locale })) };
        };`,
        Storage: `const map = new Map();
          export const PersistantStorage = { get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) };`,
        ApiCacheService: `export const ApiCacheService = { getSettingByServiceUrl: () => ({ cacheTimeInSecs: 60 }) };`,
        urls: `export default { localization: "/localization/messages/v1/_search" };`,
        i18next: `export default { addResources: (locale) => globalThis.__loaded.add(locale), changeLanguage: () => {} };`,
      }[args.path] }));
    } }],
  });
  global.window = { location: { pathname: "/digit-ui/citizen" } };
  lib = require(OUT);
});

const store = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    clear: () => map.clear(),
    entries: () => Object.fromEntries(map),
  };
};
const broken = () => ({
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  clear: () => {},
});

const CITIZEN_PAGE = "/digit-ui/citizen/pgr/complaints";
const EMPLOYEE_PAGE = "/beiranovu/employee/pgr/inbox";
const LANGUAGES = [
  { label: "ENGLISH", value: "en_IN" },
  { label: "FRANÇAIS", value: "fr_FR" },
  { label: "PORTUGUÊS", value: "pt_BR" },
];
const ENGLISH_ONLY = [{ label: "ENGLISH", value: "en_IN" }];

test("a picked language is remembered for the citizen and the employee screens", () => {
  const storage = store();
  lib.rememberLanguage("pt_BR", storage);
  assert.equal(lib.rememberedLanguage(storage, CITIZEN_PAGE), "pt_BR");
  assert.equal(lib.rememberedLanguage(storage, EMPLOYEE_PAGE), "pt_BR");
});

test("each screen reads its own key", () => {
  const storage = store({ "Citizen.locale": "fr_FR", "Employee.locale": "en_IN" });
  assert.equal(lib.rememberedLanguage(storage, CITIZEN_PAGE), "fr_FR");
  assert.equal(lib.rememberedLanguage(storage, EMPLOYEE_PAGE), "en_IN");
});

test("nothing or junk remembered reads as nothing, and junk is never written", () => {
  for (const junk of [undefined, "undefined", "null", "", "fr"]) {
    const storage = store(junk === undefined ? {} : { "Citizen.locale": junk });
    assert.equal(lib.rememberedLanguage(storage, CITIZEN_PAGE), null, `${junk}`);
    const before = storage.entries();
    lib.rememberLanguage(junk, storage);
    assert.deepEqual(storage.entries(), before, `${junk} written`);
  }
  assert.equal(lib.rememberedLanguage(null, CITIZEN_PAGE), null);
});

test("storage that refuses reads or writes is treated as nothing remembered", () => {
  assert.equal(lib.rememberedLanguage(broken(), CITIZEN_PAGE), null);
  assert.doesNotThrow(() => lib.rememberLanguage("fr_FR", broken()));
  assert.doesNotThrow(() => lib.rememberLanguage("fr_FR", null));
});

test("a workspace uses the first wanted language it offers, else its first, else the default", () => {
  assert.equal(lib.pickLanguage(LANGUAGES, ["fr_FR"]), "fr_FR");
  assert.equal(lib.pickLanguage(LANGUAGES, "fr_FR"), "fr_FR");
  assert.equal(lib.pickLanguage(LANGUAGES, ["sw_KE", "pt_BR"]), "pt_BR");
  assert.equal(lib.pickLanguage(LANGUAGES, ["sw_KE"]), "en_IN");
  assert.equal(lib.pickLanguage(LANGUAGES, [null, undefined]), "en_IN");
  assert.equal(lib.pickLanguage([{ value: "pt_BR" }, { value: "en_IN" }], []), "pt_BR");
});

test("a workspace with no language list opens in the deployment default", () => {
  for (const languages of [[], null, undefined]) {
    assert.equal(lib.pickLanguage(languages, ["fr_FR"], "en_IN"), "en_IN", `${languages}`);
  }
});

test("a new tab opens in the remembered language when the workspace offers it", () => {
  const storage = store({ "Citizen.locale": "fr_FR" });
  assert.equal(lib.openingLanguage(LANGUAGES, null, "en_IN", storage, CITIZEN_PAGE), "fr_FR");
});

test("a fallback in the tab's session does not stick once a workspace offers the remembered language", () => {
  // Workspace A (English only) put its fallback en_IN in the session; workspace B,
  // opened in the same tab, offers the remembered fr_FR.
  const storage = store({ "Citizen.locale": "fr_FR" });
  assert.equal(lib.openingLanguage(ENGLISH_ONLY, null, "en_IN", storage, CITIZEN_PAGE), "en_IN");
  assert.equal(lib.openingLanguage(LANGUAGES, "en_IN", "en_IN", storage, CITIZEN_PAGE), "fr_FR");
  assert.equal(storage.getItem("Citizen.locale"), "fr_FR");
});

test("without a usable memory the tab's own language is kept", () => {
  assert.equal(lib.openingLanguage(LANGUAGES, "pt_BR", "en_IN", store(), CITIZEN_PAGE), "pt_BR");
  assert.equal(lib.openingLanguage(LANGUAGES, "pt_BR", "en_IN", broken(), CITIZEN_PAGE), "pt_BR");
  assert.equal(lib.openingLanguage(LANGUAGES, "pt_BR", "en_IN", store({ "Employee.locale": "fr_FR" }), CITIZEN_PAGE), "pt_BR");
  assert.equal(lib.openingLanguage(LANGUAGES, "pt_BR", "en_IN", store({ "Employee.locale": "fr_FR" }), EMPLOYEE_PAGE), "fr_FR");
});

test("every storage wipe keeps the language and the Configurator's sign-out flag", () => {
  const storage = store({
    "Citizen.locale": "fr_FR", "Employee.locale": "fr_FR", "crs-sign-out-incomplete": "1",
    "Employee.token": "secret", "Citizen.user-info": "{}",
  });
  lib.clearLocalStorage(storage);
  assert.deepEqual(storage.entries(), { "Citizen.locale": "fr_FR", "Employee.locale": "fr_FR", "crs-sign-out-incomplete": "1" });
});

test("a wipe with nothing worth keeping leaves nothing behind, junk included", () => {
  const storage = store({ "Citizen.locale": "undefined", token: "secret" });
  lib.clearLocalStorage(storage);
  assert.deepEqual(storage.entries(), {});
});

test("a wipe still happens when storage refuses reads and writes", () => {
  let cleared = false;
  const storage = { ...broken(), clear: () => { cleared = true; } };
  assert.doesNotThrow(() => lib.clearLocalStorage(storage));
  assert.equal(cleared, true);
  assert.doesNotThrow(() => lib.clearLocalStorage(null));
});

test("keepKeys puts back exactly the keys it is given", () => {
  const storage = store({ a: "1", b: "2", c: "3" });
  lib.keepKeys(["a", "c", "missing"], () => storage.clear(), storage);
  assert.deepEqual(storage.entries(), { a: "1", c: "3" });
});

const signIn = (helper, args, remembered) => {
  global.Digit = {
    Utils: { getMultiRootTenant: () => false },
    StoreData: { getCurrentLanguage: () => "en_IN" },
  };
  global.localStorage = store(remembered);
  helper(...args);
  return global.localStorage.entries();
};

test("signing in leaves the remembered language alone, even when the workspace fell back", () => {
  const remembered = { "Citizen.locale": "fr_FR", "Employee.locale": "fr_FR" };
  const citizen = signIn(lib.setCitizenDetail, [{ name: "c" }, "token", "pg.citya"], remembered);
  assert.equal(citizen["Citizen.locale"], "fr_FR");
  assert.equal(citizen["Employee.locale"], "fr_FR");
  assert.equal(citizen.locale, "en_IN");
  const employee = signIn(lib.setEmployeeDetail, [{ tenantId: "pg.citya" }, "token"], remembered);
  assert.equal(employee["Citizen.locale"], "fr_FR");
  assert.equal(employee["Employee.locale"], "fr_FR");
  assert.equal(employee.locale, "en_IN");
});

test("signing in with nothing remembered does not invent a memory", () => {
  const citizen = signIn(lib.setCitizenDetail, [{ name: "c" }, "token", "pg.citya"], {});
  const employee = signIn(lib.setEmployeeDetail, [{ tenantId: "pg.citya" }, "token"], {});
  for (const entries of [citizen, employee]) {
    assert.equal(entries["Citizen.locale"], undefined);
    assert.equal(entries["Employee.locale"], undefined);
  }
});

test("loading a language also loads the default language's messages for the same modules", async () => {
  global.Digit = { Utils: { getDefaultLanguage: () => "en_IN", getMultiRootTenant: () => false } };
  globalThis.__requests = [];
  globalThis.__loaded = new Set();
  const messages = await lib.LocalizationService.getLocale({ modules: ["rainmaker-pgr"], locale: "fr_FR", tenantId: "pg" });
  assert.deepEqual([...globalThis.__requests].sort(), ["en_IN:rainmaker-pgr", "fr_FR:rainmaker-pgr"]);
  assert.deepEqual([...globalThis.__loaded].sort(), ["en_IN", "fr_FR"]);
  assert.deepEqual(messages.map((m) => m.message), ["fr_FR"], "the caller still gets the language it asked for");
});

test("loading the default language does not load it twice", async () => {
  global.Digit = { Utils: { getDefaultLanguage: () => "en_IN", getMultiRootTenant: () => false } };
  globalThis.__requests = [];
  globalThis.__loaded = new Set();
  await lib.LocalizationService.getLocale({ modules: ["rainmaker-hr"], locale: "en_IN", tenantId: "pg" });
  assert.deepEqual(globalThis.__requests, ["en_IN:rainmaker-hr"]);
});
