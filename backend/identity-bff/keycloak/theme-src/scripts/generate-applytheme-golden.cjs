// Regenerates tests/digit/fixtures/applyTheme-golden.json by running
// digit-ui-esbuild's original applyTheme.js (needs digit-ui-esbuild/node_modules
// for Ajv) over the same inputs the parity test feeds the port.
//   node scripts/generate-applytheme-golden.cjs
const path = require("path");
const root = path.resolve(__dirname, "../../../../../digit-ui-esbuild");
const fx = path.resolve(__dirname, "../tests/digit/fixtures");
module.paths.unshift(path.join(root, "node_modules"));
const inputs = {
  default: require(path.join(root, "src/theme/default.json")),
  bometV3: require(path.join(fx, "theme-bomet-v3.json")),
  v2Semantic: { version: "2", name: "v2", colors: { brand: "#FEC931", "brand-on": "#204F37", "surface-header": "#204F37", "surface-page": "#F4F4F4", "text-primary": "#1A1A1A", "text-secondary": "#505A5F", border: "#D6D5D4", error: "#D4351C", success: "#00703C", info: "#0057BD", warning: "#9E5F00", "selected-bg": "#FFF4D7", "chart-palette": ["#204F37", "#FEC931"] } },
  v1Green: { version: "1", colors: { primary: { main: "#204F37", dark: "#163826" }, secondary: "#204F37" } },
  v3Partial: { version: "3", colors: { "primary-1": "#204F37", "primary-2": "#FEC931", "header-bg": "#FFFFFF" } },
  invalidHex: { version: "1", colors: { primary: { main: "green" } } },
  unknownKey: { version: "3", colors: { "primary-1": "#204F37", "not-a-token": "#000000" } },
  noColors: { version: "1" }
};
const out = {};
for (const [name, cfg] of Object.entries(inputs)) {
  const props = {}; const head = { children: [], appendChild(el) { this.children.push(el); } };
  const dataset = {};
  global.document = { documentElement: { style: { setProperty(n, v) { props[n] = v; } }, dataset }, head,
    createElement: t => ({ id: "", textContent: "" }), getElementById: id => head.children.find(e => e.id === id) || null };
  console.log = () => {}; console.warn = () => {};
  delete require.cache[require.resolve(path.join(root, "src/theme/applyTheme.js"))];
  require(path.join(root, "src/theme/applyTheme.js")).applyTheme(cfg);
  out[name] = { input: cfg, vars: props, headerTone: dataset.headerTone, bridge: head.children[0]?.textContent };
}
require("fs").writeFileSync(path.join(fx, "applyTheme-golden.json"), JSON.stringify(out, null, 1) + "\n");
process.stdout.write(Object.entries(out).map(([k, v]) => `${k}: ${Object.keys(v.vars).length} vars tone=${v.headerTone}`).join("\n") + "\n");
