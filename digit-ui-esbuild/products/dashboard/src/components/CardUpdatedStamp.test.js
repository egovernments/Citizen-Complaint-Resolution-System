const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = `
import React from "react";
import ReactDOMServer from "react-dom/server";
import CardUpdatedStamp from "./CardUpdatedStamp.jsx";

export const renderStamp = (asOf, nowMs) => {
  // Freeze "now" by stubbing Date.now for the SSR pass.
  const realNow = Date.now;
  Date.now = () => nowMs;
  try {
    return ReactDOMServer.renderToStaticMarkup(
      React.createElement(CardUpdatedStamp, { asOf })
    );
  } finally {
    Date.now = realNow;
  }
};
`;

function bundleEntry() {
  const out = path.join(os.tmpdir(), `card-updated-stamp.${process.pid}.cjs.js`);
  esbuild.buildSync({
    stdin: {
      contents: ENTRY,
      resolveDir: __dirname,
      loader: "jsx",
      sourcefile: "card-updated-stamp-entry.jsx",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    loader: { ".jsx": "jsx", ".js": "jsx" },
    outfile: out,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
    } catch (e) {
      /* already gone */
    }
  });
  return out;
}

const bundledEntry = bundleEntry();

function renderIn(locale, messages, asOf, nowMs) {
  delete require.cache[bundledEntry];
  global.window = {
    i18next: {
      language: locale,
      exists: (key) => Object.prototype.hasOwnProperty.call(messages, key),
      t: (key) => messages[key] ?? key,
      on() {},
      off() {},
      store: { on() {}, off() {} },
    },
    localStorage: { getItem: () => locale },
  };
  try {
    return require(bundledEntry).renderStamp(asOf, nowMs);
  } finally {
    delete global.window;
  }
}

const now = Date.UTC(2026, 8, 13, 12, 0, 0);

test("updated stamp resolves through the active dashboard locale", () => {
  const html = renderIn(
    "pt_PT",
    {
      DASHBOARD_COMMON_UPDATED: "Atualizado",
      DASHBOARD_COMMON_UPDATED_MIN_AGO: "{{n}} min atrás",
    },
    now - 8 * 60_000,
    now
  );
  assert.match(html, />Atualizado 8 min atrás</);
  assert.doesNotMatch(html, />Updated /);
});

test("updated stamp uses relative ago copy in English", () => {
  const html = renderIn(
    "en_IN",
    {
      DASHBOARD_COMMON_UPDATED: "Updated",
      DASHBOARD_COMMON_UPDATED_HRS_AGO: "{{n}} hrs ago",
    },
    now - 2 * 3600_000,
    now
  );
  assert.match(html, />Updated 2 hrs ago</);
  assert.doesNotMatch(html, /Aug/);
});

test("updated stamp renders nothing without asOf", () => {
  const html = renderIn("en_IN", { DASHBOARD_COMMON_UPDATED: "Updated" }, null, now);
  assert.equal(html, "");
});
