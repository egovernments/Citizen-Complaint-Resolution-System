// Language list for the standalone/public switcher (#1797).
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/stateInfoService.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `stateInfoService.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      import { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      import { fetchStateLanguages, languagesFromStateInfo } from './stateInfoService.js';
      export { configurePublicDashboardRuntime, fetchStateLanguages, languagesFromStateInfo };
    `,
    resolveDir: __dirname,
    sourcefile: "state-info-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

function load() {
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
}

test("languagesFromStateInfo mirrors the TopBar rule: first record, hasLocalisation gate, de-duped", () => {
  const { languagesFromStateInfo } = load();
  const ke = [
    {
      code: "KE",
      hasLocalisation: true,
      languages: [
        { label: "English", value: "en_IN" },
        { label: "Swahili", value: "sw_KE" },
        { label: "dup", value: "en_IN" },
        { value: "fr_FR" }, // label falls back to the code
        { label: "broken" }, // no value → dropped
        null,
      ],
    },
    { code: "ke", hasLocalisation: true, languages: [{ label: "X", value: "xx_XX" }] },
  ];
  assert.deepEqual(languagesFromStateInfo(ke), [
    { value: "en_IN", label: "English" },
    { value: "sw_KE", label: "Swahili" },
    { value: "fr_FR", label: "fr_FR" },
  ]);
  assert.deepEqual(languagesFromStateInfo([{ hasLocalisation: false, languages: [{ value: "en_IN" }] }]), []);
  assert.deepEqual(languagesFromStateInfo([]), []);
  assert.deepEqual(languagesFromStateInfo(undefined), []);
});

test("fetchStateLanguages reads StateInfo anonymously in the public runtime and degrades to []", async () => {
  const calls = [];
  let reads = 0;
  global.window = {
    globalConfigs: { getConfig: (key) => ({ STATE_LEVEL_TENANT_ID: "ke", MDMS_V1_CONTEXT_PATH: "mdms-v2" })[key] },
    localStorage: { getItem: () => { reads += 1; return JSON.stringify("employee-secret"); }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    dispatchEvent() {},
  };
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        MdmsRes: { "common-masters": { StateInfo: [{ hasLocalisation: true, languages: [{ label: "English", value: "en_IN" }, { label: "Português", value: "pt_PT" }] }] } },
      }),
    };
  };
  const mod = load();
  mod.configurePublicDashboardRuntime();

  const languages = await mod.fetchStateLanguages();

  assert.deepEqual(languages, [{ value: "en_IN", label: "English" }, { value: "pt_PT", label: "Português" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/mdms-v2/v1/_search");
  assert.equal(calls[0].body.RequestInfo.authToken, undefined);
  assert.equal(calls[0].body.RequestInfo.userInfo, undefined);
  assert.equal(calls[0].body.MdmsCriteria.tenantId, "ke");
  assert.deepEqual(calls[0].body.MdmsCriteria.moduleDetails, [
    { moduleName: "common-masters", masterDetails: [{ name: "StateInfo" }] },
  ]);
  assert.equal(reads, 0, "public runtime never inspects employee storage");

  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  assert.deepEqual(await mod.fetchStateLanguages(), []);
  global.fetch = async () => { throw new Error("offline"); };
  assert.deepEqual(await mod.fetchStateLanguages(), []);
});
