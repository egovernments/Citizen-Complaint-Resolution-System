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

export const renderStamp = (label) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(CardUpdatedStamp, { label }));
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

function renderIn(locale, messages) {
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
    return require(bundledEntry).renderStamp("13 Aug, 14:30");
  } finally {
    delete global.window;
  }
}

test("updated stamp resolves through the active dashboard locale", () => {
  const html = renderIn("pt_PT", { DASHBOARD_COMMON_UPDATED: "Atualizado" });
  assert.match(html, />Atualizado 13 Aug, 14:30</);
  assert.doesNotMatch(html, />Updated /);
});

test("updated stamp retains the seeded English rendering", () => {
  const html = renderIn("en_IN", { DASHBOARD_COMMON_UPDATED: "Updated" });
  assert.match(html, />Updated 13 Aug, 14:30</);
});
