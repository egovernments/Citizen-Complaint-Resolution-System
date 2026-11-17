// A keyless CARTO MapConfig logs its warning once per page load (#2804), not
// once per component using useMapConfig and per render.
// Run from digit-ui-esbuild/:  node --test tests/mapConfigWarning.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `map-config-warning.${process.pid}.cjs`);
let ui;

before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as React } from 'react';
        export { create, act } from 'react-test-renderer';
        export { default as useMapConfig } from './products/pgr/src/hooks/pgr/useMapConfig';
      `,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, loader: { ".js": "jsx" },
    nodePaths: [path.join(root, "node_modules")],
    logLevel: "error",
    plugins: [{ name: "shared-react", setup(build) {
      build.onResolve({ filter: /^react$|^react-test-renderer$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
    } }],
  });
  ui = require(OUT);
});
after(() => {
  fs.unlinkSync(OUT);
  delete global.window;
  delete global.Digit;
});

test("three maps on a page, re-rendered and remounted, warn once", async () => {
  global.window = { globalConfigs: { getConfig: () => undefined } };
  global.Digit = {
    SessionStorage: { get: () => null },
    ULBService: { getCurrentTenantId: () => "ke" },
    // A fresh array on every call, as a refetch would give, so each render recomputes.
    Hooks: { useCustomMDMS: () => ({ data: [{ code: "DEFAULT", baseMapTheme: "voyager" }], isLoading: false }) },
  };
  const { React, create, act, useMapConfig } = ui;
  const seen = [];
  const Map = () => {
    seen.push(useMapConfig().tileUrl);
    return null;
  };
  const page = (n) => React.createElement(React.Fragment, null, React.createElement(Map, { key: `a${n}` }), React.createElement(Map, { key: `b${n}` }), React.createElement(Map, { key: `c${n}` }));

  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    let view;
    await act(async () => { view = create(page(0)); });
    await act(async () => { view.update(page(0)); });
    await act(async () => { view.update(page(1)); }); // new keys: remounted
  } finally {
    console.warn = original;
  }
  assert.equal(seen.length, 9);
  assert.ok(seen.every((url) => url === "https://tile.openstreetmap.org/{z}/{x}/{y}.png"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CARTO tiles without an API key/);
});
