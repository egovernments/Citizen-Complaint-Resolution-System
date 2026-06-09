// Fetch the three published @egovernments CSS packages from unpkg, substitute
// themeable color hex values with var(--color-*, fallback), prepend :root
// defaults, write public/vendor/<name>.css. The esbuild dev server serves
// those files at /digit-ui/vendor/<name>.css, and public/index.html loads them
// in place of the CDN URLs.
//
// Rerun after bumping any of the upstream versions below.
//
//   node scripts/vendor-digit-ui-css.js

const fs = require("fs");
const path = require("path");
const https = require("https");
const { transformCss } = require("./lib/transform-css");

const VENDOR_DIR = path.resolve(__dirname, "..", "public", "vendor");

// Upstream CDN CSS packages loaded by public/index.html. Each entry produces
// one transformed <name>.css and one <name>.original.css snapshot in VENDOR_DIR.
const SOURCES = [
  {
    name: "digit-ui-css",
    version: "1.8.37",
    url: "https://unpkg.com/@egovernments/digit-ui-css@1.8.37/dist/index.css",
  },
  {
    name: "digit-ui-components-css",
    version: "0.2.0-beta.14",
    url: "https://unpkg.com/@egovernments/digit-ui-components-css@0.2.0-beta.14/dist/index.css",
  },
  {
    name: "digit-ui-health-css",
    version: "0.2.113",
    url: "https://unpkg.com/@egovernments/digit-ui-health-css@0.2.113/dist/index.css",
  },
];

// Tokens to expose as CSS custom properties. Hex values are lowercase so the
// regex can be case-insensitive without worrying about both cases. Fallback is
// the original upstream value so selectors that somehow bypass the var
// indirection still render close to the shipped palette.
const TOKENS = [
  // primary palette
  { hex: "c84c0e", varName: "--color-primary-main", fallback: "#c84c0e" },
  { hex: "f18f5e", varName: "--color-primary-light", fallback: "#F18F5E" },
  { hex: "c8602b", varName: "--color-primary-dark", fallback: "#C8602B" },
  { hex: "f47738", varName: "--color-primary-accent", fallback: "#F47738" },
  { hex: "fbeee8", varName: "--color-primary-selected-bg", fallback: "#FBEEE8" },
  // secondary
  { hex: "22394d", varName: "--color-secondary", fallback: "#22394D" },
  // text
  { hex: "0b0c0c", varName: "--color-text-primary", fallback: "#0B0C0C" },
  { hex: "505a5f", varName: "--color-text-secondary", fallback: "#505A5F" },
  { hex: "363636", varName: "--color-text-heading", fallback: "#363636" },
  { hex: "787878", varName: "--color-text-muted", fallback: "#787878" },
  // link
  { hex: "1d70b8", varName: "--color-link-normal", fallback: "#1D70B8" },
  { hex: "003078", varName: "--color-link-hover", fallback: "#003078" },
  // borders
  { hex: "d6d5d4", varName: "--color-border", fallback: "#D6D5D4" },
  { hex: "464646", varName: "--color-input-border", fallback: "#464646" },
  // status
  { hex: "d4351c", varName: "--color-error", fallback: "#D4351C" },
  { hex: "b91900", varName: "--color-error-dark", fallback: "#B91900" },
  { hex: "00703c", varName: "--color-success", fallback: "#00703C" },
  { hex: "0057bd", varName: "--color-info-dark", fallback: "#0057BD" },
  { hex: "9e5f00", varName: "--color-warning-dark", fallback: "#9E5F00" },
  // grey scale
  { hex: "9e9e9e", varName: "--color-grey-dark", fallback: "#9E9E9E" },
  { hex: "c5c5c5", varName: "--color-grey-disabled", fallback: "#C5C5C5" },
  { hex: "eeeeee", varName: "--color-grey-mid", fallback: "#EEEEEE" },
  { hex: "f0f0f0", varName: "--color-grey-lighter", fallback: "#F0F0F0" },
  { hex: "fafafa", varName: "--color-grey-light", fallback: "#FAFAFA" },
  { hex: "e3e3e3", varName: "--color-grey-bg", fallback: "#E3E3E3" },
  // digitv2.lightTheme
  { hex: "b1b4b6", varName: "--color-digitv2-text-color-disabled", fallback: "#B1B4B6" },
  { hex: "0b4b66", varName: "--color-digitv2-header-sidenav", fallback: "#0B4B66" },
  { hex: "feefe7", varName: "--color-digitv2-primary-bg", fallback: "#FEEFE7" },
  // digitv2.alert (error & success already mapped above)
  { hex: "efc7c1", varName: "--color-digitv2-alert-error-bg", fallback: "#EFC7C1" },
  { hex: "bad6c9", varName: "--color-digitv2-alert-success-bg", fallback: "#BAD6C9" },
  { hex: "3498db", varName: "--color-digitv2-alert-info", fallback: "#3498DB" },
  { hex: "c7e0f1", varName: "--color-digitv2-alert-info-bg", fallback: "#C7E0F1" },
  // digitv2.chart
  { hex: "048bd0", varName: "--color-digitv2-chart-1", fallback: "#048BD0" },
  { hex: "fbc02d", varName: "--color-digitv2-chart-2", fallback: "#FBC02D" },
  { hex: "8e29bf", varName: "--color-digitv2-chart-3", fallback: "#8E29BF" },
  { hex: "ea8a3b", varName: "--color-digitv2-chart-4", fallback: "#EA8A3B" },
  { hex: "0babde", varName: "--color-digitv2-chart-5", fallback: "#0BABDE" },
];

const ROOT_BLOCK = `:root {
  /* primary */
  --color-primary-light: #F18F5E;
  --color-primary-main: #c84c0e;
  --color-primary-dark: #C8602B;
  --color-primary-accent: #F47738;
  --color-primary-selected-bg: #FBEEE8;
  /* secondary */
  --color-secondary: #22394D;
  /* text */
  --color-text-primary: #0B0C0C;
  --color-text-secondary: #505A5F;
  --color-text-heading: #363636;
  --color-text-muted: #787878;
  /* link */
  --color-link-normal: #1D70B8;
  --color-link-hover: #003078;
  /* borders */
  --color-border: #D6D5D4;
  --color-input-border: #464646;
  /* status */
  --color-error: #D4351C;
  --color-error-dark: #B91900;
  --color-success: #00703C;
  --color-info-dark: #0057BD;
  --color-warning-dark: #9E5F00;
  /* grey */
  --color-grey-dark: #9E9E9E;
  --color-grey-disabled: #C5C5C5;
  --color-grey-mid: #EEEEEE;
  --color-grey-lighter: #F0F0F0;
  --color-grey-light: #FAFAFA;
  --color-grey-bg: #E3E3E3;
  /* digitv2.lightTheme */
  --color-digitv2-text-color-disabled: #B1B4B6;
  --color-digitv2-header-sidenav: #0B4B66;
  --color-digitv2-primary-bg: #FEEFE7;
  /* digitv2.alert */
  --color-digitv2-alert-error-bg: #EFC7C1;
  --color-digitv2-alert-success-bg: #BAD6C9;
  --color-digitv2-alert-info: #3498DB;
  --color-digitv2-alert-info-bg: #C7E0F1;
  /* digitv2.chart */
  --color-digitv2-chart-1: #048BD0;
  --color-digitv2-chart-2: #FBC02D;
  --color-digitv2-chart-3: #8E29BF;
  --color-digitv2-chart-4: #EA8A3B;
  --color-digitv2-chart-5: #0BABDE;
  /* v3 (designer 1:1) — fallbacks default to DIGIT-brand neutrals; overridden
     when a tenant's v3-shaped MDMS record is applied. See applyTheme.js
     V3_EXPANSION for the input → CSS-var mapping. */
  /* main palette */
  --color-primary-1: #C8602B;
  --color-primary-2: #c84c0e;
  --color-primary-1-bg: #FBEEE8;
  --color-primary-2-bg: #FEEFE7;
  /* page surfaces */
  --color-page-bg: #FFFFFF;
  --color-page-secondary-bg: #FAFAFA;
  /* text */
  --color-text-disabled: #C5C5C5;
  /* primary button */
  --color-button-primary-bg-default: #c84c0e;
  --color-button-primary-bg-hover: #B8420C;
  --color-button-primary-bg-pressed: #A03A0A;
  --color-button-primary-text: #FFFFFF;
  --color-button-primary-border: #c84c0e;
  --color-button-primary-disabled-bg: #E5E7EB;
  --color-button-primary-disabled-text: #9CA3AF;
  /* secondary button */
  --color-button-secondary-bg-default: #FFFFFF;
  --color-button-secondary-bg-hover: #F9FAFB;
  --color-button-secondary-bg-pressed: #F3F4F6;
  --color-button-secondary-text: #c84c0e;
  --color-button-secondary-border: #c84c0e;
  /* tertiary */
  --color-button-tertiary-text: #1D70B8;
  /* inputs */
  --color-input-bg: #FFFFFF;
  --color-input-border-default: #D1D5DB;
  --color-input-border-focus: #c84c0e;
  --color-input-border-error: #D4351C;
  --color-input-placeholder: #9CA3AF;
  --color-input-text: #0B0C0C;
  --color-input-label: #4B5563;
  --color-input-helper: #6B7280;
  /* header */
  --color-header-bg: #22394D;
  --color-header-text: #FFFFFF;
  --color-header-icon: #FFFFFF;
  /* sidebar */
  --color-sidebar-bg: #0B4B66;
  --color-sidebar-text-active: #FFFFFF;
  --color-sidebar-text-default: #D1D5DB;
  --color-sidebar-hover-text: #FFFFFF;
  --color-sidebar-hover-bg: #FBEEE8;
  --color-sidebar-icon-active: #FFFFFF;
  --color-sidebar-selected-bg: #c84c0e;
  --color-sidebar-selected-text: #FFFFFF;
  /* cards */
  --color-card-border: #D6D5D4;
  --color-card-divider: #E5E7EB;
  --color-card-success: #00703C;
  --color-card-error: #D4351C;
  /* status (text / bg / border per severity) */
  --color-status-success-text: #00703C;
  --color-status-success-bg: #BAD6C9;
  --color-status-success-border: #00703C;
  --color-status-error-text: #D4351C;
  --color-status-error-bg: #EFC7C1;
  --color-status-error-border: #D4351C;
  --color-status-warning-text: #9E5F00;
  --color-status-warning-bg: #FFF4D6;
  --color-status-warning-border: #9E5F00;
  --color-status-info-text: #0057BD;
  --color-status-info-bg: #C7E0F1;
  --color-status-info-border: #0057BD;
  /* tables */
  --color-table-header-bg: #F3F4F6;
  --color-table-header-text: #363636;
  --color-table-row-bg: #FFFFFF;
  --color-table-alt-row: #FAFAFA;
  --color-table-row-text: #0B0C0C;
  --color-table-border: #E5E7EB;
  --color-table-hover: #FBEEE8;
  --color-table-selected: #FBEEE8;
  --color-table-hover-text: #0B0C0C;
  --color-table-selected-text: #c84c0e;
  /* misc */
  --color-loader: #c84c0e;
  --color-progress: #c84c0e;
  --color-tooltip-bg: #22394D;
  --color-tooltip-text: #FFFFFF;
}
`;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchText(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

async function processSource(source, prependRoot) {
  const originalPath = path.join(VENDOR_DIR, `${source.name}.original.css`);
  const outputPath = path.join(VENDOR_DIR, `${source.name}.css`);

  console.log(`fetching ${source.url}`);
  const original = await fetchText(source.url);
  fs.writeFileSync(originalPath, original);

  // Only the first output needs the :root block — it applies globally. Writing
  // it to every file would just duplicate declarations; the browser would pick
  // the last one but the extra bytes are wasted.
  const { css, counts } = transformCss(original, TOKENS, prependRoot ? ROOT_BLOCK : "");
  for (const [name, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${name}: ${n}`);
  }
  fs.writeFileSync(outputPath, css);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`wrote ${outputPath} (${total} total replacements across ${source.name})`);
  return total;
}

async function main() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  let grandTotal = 0;
  for (let i = 0; i < SOURCES.length; i++) {
    grandTotal += await processSource(SOURCES[i], i === 0);
  }
  console.log(`done — ${grandTotal} total replacements across ${SOURCES.length} sources`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
