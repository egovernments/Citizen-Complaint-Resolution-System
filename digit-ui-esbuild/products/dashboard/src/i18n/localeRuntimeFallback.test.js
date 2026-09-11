const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const outfile = path.join(os.tmpdir(), `dashboard-locale-runtime.${process.pid}.cjs`);
esbuild.buildSync({
  stdin: {
    contents: 'export { ensureMessages, exists, translate } from "./localeRuntime.js";',
    resolveDir: __dirname,
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});
process.on("exit", () => {
  try {
    fs.unlinkSync(outfile);
  } catch (error) {
    /* already removed */
  }
});

function runtime(windowValue) {
  delete require.cache[outfile];
  global.window = windowValue;
  return require(outfile);
}

test("standalone locale gaps use canonical English instead of a raw key", () => {
  const { translate } = runtime({
    localStorage: { getItem: () => "fr_FR" },
  });
  try {
    assert.equal(translate("DASHBOARD_COMMON_UPDATED", "Updated"), "Updated");
  } finally {
    delete global.window;
  }
});

test("host translations win and host gaps retain the English fallback", () => {
  const messages = { DASHBOARD_COMMON_UPDATED: "Atualizado" };
  const { translate } = runtime({
    i18next: {
      exists: (key) => Object.hasOwn(messages, key),
      t: (key) => messages[key],
    },
    localStorage: { getItem: () => "pt_PT" },
  });
  try {
    assert.equal(translate("DASHBOARD_COMMON_UPDATED", "Updated"), "Atualizado");
    assert.equal(translate("DASHBOARD_NEW_COPY", "New copy"), "New copy");
  } finally {
    delete global.window;
  }
});

test("standalone dynamic labels resolve active locale before the en_IN pack", async () => {
  const requests = [];
  global.fetch = async (url) => {
    const locale = new URL(url, "https://example.test").searchParams.get("locale");
    requests.push(locale);
    const messages =
      locale === "pt_PT"
        ? [{ code: "COMMON_MASTERS_DEPARTMENT_WATER", message: "Água" }]
        : [
            { code: "COMMON_MASTERS_DEPARTMENT_WATER", message: "Water" },
            { code: "COMMON_MASTERS_DEPARTMENT_ADMIN", message: "Administration" },
          ];
    return { ok: true, json: async () => ({ messages }) };
  };
  const api = runtime({
    localStorage: { getItem: (key) => (key === "Employee.locale" ? "pt_PT" : null) },
  });
  try {
    await api.ensureMessages();
    assert.deepEqual(requests.sort(), ["en_IN", "pt_PT"]);
    assert.equal(api.translate("COMMON_MASTERS_DEPARTMENT_WATER"), "Água");
    assert.equal(api.exists("COMMON_MASTERS_DEPARTMENT_ADMIN"), true);
    assert.equal(api.translate("COMMON_MASTERS_DEPARTMENT_ADMIN"), "Administration");
  } finally {
    delete global.fetch;
    delete global.window;
  }
});
