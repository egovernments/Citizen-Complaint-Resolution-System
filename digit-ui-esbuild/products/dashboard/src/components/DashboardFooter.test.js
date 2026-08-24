const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = `
import React from "react";
import ReactDOMServer from "react-dom/server";
import DashboardFooter from "./DashboardFooter.jsx";

export const renderFooter = () =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardFooter));
`;

function bundleEntry() {
  const out = path.join(os.tmpdir(), `dashboard-footer.${process.pid}.cjs.js`);
  esbuild.buildSync({
    stdin: {
      contents: ENTRY,
      resolveDir: __dirname,
      loader: "jsx",
      sourcefile: "dashboard-footer-entry.jsx",
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

function renderWithConfig(config) {
  delete require.cache[bundledEntry];
  global.window = { globalConfigs: { getConfig: (key) => config[key] } };
  try {
    return require(bundledEntry).renderFooter();
  } finally {
    delete global.window;
  }
}

test("renders the attribution from the configured footer logo", () => {
  const html = renderWithConfig({
    DIGIT_FOOTER: "/digit-ui/brand/digit-footer.png",
    DIGIT_HOME_URL: "https://digit.example.org/",
  });
  assert.match(html, /<footer[^>]*class="[^"]*dashboard-footer/);
  assert.match(html, /src="\/digit-ui\/brand\/digit-footer\.png"/);
  assert.match(html, /alt="Powered by DIGIT"/);
  assert.match(html, /href="https:\/\/digit\.example\.org\/"/);
});

test("falls back to the public DIGIT home when DIGIT_HOME_URL is unset", () => {
  const html = renderWithConfig({ DIGIT_FOOTER: "/digit-ui/brand/digit-footer.png" });
  assert.match(html, /href="https:\/\/egov\.org\.in\/digit\/"/);
});

// The bug behind #1836: an unset DIGIT_FOOTER used to reach the <img> as an
// empty src, painting a broken-image glyph plus its alt text. Render nothing.
test("renders nothing rather than a broken image when the logo is unset", () => {
  assert.equal(renderWithConfig({ DIGIT_FOOTER: "" }), "");
  assert.equal(renderWithConfig({}), "");
});
