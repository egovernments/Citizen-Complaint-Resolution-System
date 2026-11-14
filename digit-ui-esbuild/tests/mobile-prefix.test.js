const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// ours #1929: the citizen's complaint timeline showed staff phones as "+91 <number>" on a Kenyan tenant (254).
// Both TelePhone atoms are rendered with the real code; the country code must be the tenant's.
const OUT = path.join(os.tmpdir(), `mobile-prefix.cjs.${process.pid}.js`);
// Icons and prop-types are not under test: stubbed, so the atoms' own markup is all that renders.
const stubs = {
  name: "stubs",
  setup(build) {
    build.onResolve({ filter: /^(\.\/svgindex|\.\/SVG|@egovernments\/digit-ui-svg-components|prop-types)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
      contents: a.path === "prop-types"
        ? "const f = () => null; f.isRequired = f; const g = () => f; module.exports = { any: f, string: f, number: f, bool: f, object: f, func: f, node: f, element: f, array: f, oneOf: g, oneOfType: g, shape: g, arrayOf: g };"
        : "const Phone = () => null; module.exports = { Phone, SVG: { Phone } };",
      loader: "js",
      resolveDir: __dirname,
    }));
  },
};
let ReactTelePhone, ComponentsTelePhone, React, renderToStaticMarkup;
before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as ReactTelePhone } from "./react-components/src/atoms/TelePhone.js";
        export { default as ComponentsTelePhone } from "./digit-ui-components/src/atoms/Telephone.js";
        export { default as React } from "react";
        export { renderToStaticMarkup } from "react-dom/server";
      `,
      resolveDir: path.join(__dirname, "../packages"),
      sourcefile: "mobile-prefix-test-entry.js",
      loader: "js",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: OUT,
    loader: { ".js": "jsx" },
    plugins: [stubs],
    nodePaths: [path.join(__dirname, "../node_modules"), ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)],
    logLevel: "error",
  });
  ({ ReactTelePhone, ComponentsTelePhone, React, renderToStaticMarkup } = require(OUT));
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

const render = (Atom, mobile, { config, mdms } = {}) => {
  global.window = {
    globalConfigs: { getConfig: (k) => (k === "CORE_MOBILE_CONFIGS" ? config : undefined) },
    ...(mdms ? { __DIGIT_USER_VALIDATION: { mobile: { countryCode: mdms } } } : {}),
  };
  try {
    return renderToStaticMarkup(React.createElement(Atom, { mobile, text: "CCRS Test Bomet Lme" }));
  } finally {
    delete global.window;
  }
};
const atoms = { "react-components": () => ReactTelePhone, "digit-ui-components": () => ComponentsTelePhone };

for (const [name, atom] of Object.entries(atoms)) {
  test(`${name} TelePhone: a Kenyan tenant shows +254, not +91 (the #1929 timeline)`, () => {
    const html = render(atom(), "9999006942", { config: { countryCode: "+254" } });
    assert.doesNotMatch(html, /\+91/);
    assert.match(html, />\+254 9999006942</);
    assert.match(html, /href="tel:\+2549999006942"/);
  });

  test(`${name} TelePhone: the MDMS code (useMobileValidation) wins over globalConfigs; a trunk 0 is dropped`, () => {
    const html = render(atom(), "0712345678", { config: { countryCode: "+91" }, mdms: "254" });
    assert.match(html, />\+254 712345678</);
    assert.match(html, /href="tel:\+254712345678"/);
  });

  test(`${name} TelePhone: no tenant code anywhere keeps the stock +91; a +number is shown as is`, () => {
    assert.match(render(atom(), "9876543210"), />\+91 9876543210</);
    const html = render(atom(), "+254712345678", { config: { countryCode: "+254" } });
    assert.match(html, />\+254712345678</);
    assert.doesNotMatch(html, /\+254 \+254/);
  });
}
