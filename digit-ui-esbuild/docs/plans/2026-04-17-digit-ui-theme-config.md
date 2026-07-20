# DIGIT UI Runtime Theme Config — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Scale the validated POC (branch `poc/theme-config`) into a production-ready Phase-1 theme system covering the full Tailwind color palette, with schema-validated JSON input, a Phase-2 MDMS hook stub, production-build parity, and unit + integration tests.

**Architecture:** Three layers — (1) a Node CLI script vendors upstream `@egovernments/digit-ui-css` from unpkg and rewrites themeable hex literals into `var(--color-*, fallback)` while prepending a `:root` block with upstream defaults; (2) the dev and prod build pipelines serve the transformed CSS from `/digit-ui/vendor/digit-ui-css.css`; (3) a small loader (`src/theme/applyTheme.js`) flattens a nested JSON config into flat CSS variable names and writes them to `document.documentElement` at bootstrap. Phase 2 (separate ticket) swaps the bundled default JSON for an MDMS fetch keyed by `tenantId` — the hook site ships as a commented stub in this plan.

**Tech Stack:** Node 18, esbuild (existing dev/prod build), ajv 8 (already a dep) for schema validation, Playwright (existing) for integration proof, `node --test` (built in) for unit tests.

**Design reference:** `docs/plans/2026-04-17-digit-ui-theme-config-design.md`
**Ticket:** TASK-021 / [theflywheel/digit-ui-esbuild#1](https://github.com/theflywheel/digit-ui-esbuild/issues/1)
**Start branch:** `poc/theme-config` (the POC commits are already here; rename/squash before PR if desired).

---

## Prerequisites (do before Task 1)

```bash
cd /root/code/digit-ui-esbuild
git branch --show-current   # expect: poc/theme-config
git status --short          # should be clean or show the POC untracked files
node --version              # expect: v18.x
```

If the POC scaffold isn't present, stop — this plan assumes the POC branch. The POC delivered: `scripts/vendor-digit-ui-css.js`, `src/theme/applyTheme.js`, `src/theme/default.json`, `public/vendor/digit-ui-css.{css,original.css}`, modifications to `public/index.html`, `esbuild.dev.js`, `src/index.js`, and pre-existing side-fixes to `packages/libraries/src/index.js` + `products/pgr/src/redux/actions/index.js`.

---

### Task 1: Split pre-existing side-fixes into their own commit

The POC incidentally fixed two unrelated build breaks. They deserve a standalone commit so the theme PR is pure.

**Files:**
- Modify: none (files already edited in POC)
- `packages/libraries/src/index.js:93` — `export { ..., MdmsService };` (added)
- `products/pgr/src/redux/actions/index.js:1-9` — removed stale `APPLY_FILTER` from imports

**Step 1: Stage only the two side-fix files**

```bash
cd /root/code/digit-ui-esbuild
git add packages/libraries/src/index.js products/pgr/src/redux/actions/index.js
git diff --cached --stat
```

Expected: exactly two files staged, ~2 insertions / ~2 deletions.

**Step 2: Commit**

```bash
git commit -m "fix: re-export MdmsService and drop stale APPLY_FILTER import

Two unrelated dev-build breakages on port-from-bomet-fixes:

* packages/libraries exported MdmsService internally via setupLibraries
  but never as a named ES export, so products/pgr/src/pages/citizen/
  ComplaintDetails.js could not import it.
* products/pgr/src/redux/actions/index.js imported APPLY_FILTER from
  ./types, which never defined it. Removed from the import list.

Surfaced while scaffolding the theme config POC; split out so the
theme PR stays focused on its own change."
```

**Step 3: Verify the theme POC still builds**

```bash
PORT=19080 node esbuild.dev.js &
sleep 5
curl -sI http://127.0.0.1:19080/digit-ui/ | head -1
kill %1
```

Expected: `HTTP/1.1 200 OK`, no build errors in stdout.

---

### Task 2: Extract the transform into a pure, testable module

The POC's `scripts/vendor-digit-ui-css.js` mixes HTTP, filesystem, and transformation. Split the pure transform out so it can be unit-tested.

**Files:**
- Create: `scripts/lib/transform-css.js`
- Modify: `scripts/vendor-digit-ui-css.js` (import from lib)

**Step 1: Create the pure module**

```js
// scripts/lib/transform-css.js

// Pure CSS-variable substitution. Given upstream CSS source, a list of tokens
// (each mapping a hex literal to a CSS variable name + fallback), and a string
// to prepend, return the transformed CSS plus a per-token replacement count.
//
// Exported as a pure function so it can be unit-tested without network or fs.

function transformCss(source, tokens, rootBlock) {
  let out = source;
  const counts = {};
  for (const t of tokens) {
    // Negative lookahead avoids matching longer hex colors like #c84c0ea0.
    const re = new RegExp(`#${t.hex}(?![0-9a-f])`, "gi");
    let n = 0;
    out = out.replace(re, () => {
      n++;
      return `var(${t.varName}, ${t.fallback})`;
    });
    counts[t.varName] = n;
  }
  return { css: (rootBlock || "") + out, counts };
}

module.exports = { transformCss };
```

**Step 2: Refactor the CLI to import the pure function**

Edit `scripts/vendor-digit-ui-css.js`. Replace the inline transform loop with:

```js
const { transformCss } = require("./lib/transform-css");
// … inside main():
const { css, counts } = transformCss(original, TOKENS, ROOT_BLOCK);
for (const [name, n] of Object.entries(counts)) {
  console.log(`  ${name}: ${n} replacements`);
}
fs.writeFileSync(OUTPUT, css);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`wrote ${OUTPUT} (${total} total replacements)`);
```

**Step 3: Re-run the script and verify identical output**

```bash
cp public/vendor/digit-ui-css.css /tmp/before.css
node scripts/vendor-digit-ui-css.js
diff -q /tmp/before.css public/vendor/digit-ui-css.css
```

Expected: no diff output (files identical — refactor must be behavior-preserving).

**Step 4: Commit**

```bash
git add scripts/lib/transform-css.js scripts/vendor-digit-ui-css.js
git commit -m "refactor: extract pure CSS-variable transform into scripts/lib"
```

---

### Task 3: Unit-test the transform

**Files:**
- Create: `scripts/lib/transform-css.test.js`

**Step 1: Write failing tests**

```js
// scripts/lib/transform-css.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformCss } = require("./transform-css");

const TOKENS = [
  { hex: "c84c0e", varName: "--color-primary-main", fallback: "#c84c0e" },
  { hex: "f18f5e", varName: "--color-primary-light", fallback: "#F18F5E" },
];

test("replaces hex literals with var() references", () => {
  const src = ".a { color: #c84c0e; } .b { color: #F18F5E; }";
  const { css } = transformCss(src, TOKENS, "");
  assert.match(css, /color: var\(--color-primary-main, #c84c0e\)/);
  assert.match(css, /color: var\(--color-primary-light, #F18F5E\)/);
});

test("is case-insensitive on the hex match", () => {
  const { counts } = transformCss("#C84C0E #c84c0e", TOKENS, "");
  assert.equal(counts["--color-primary-main"], 2);
});

test("does not match longer hex colors (#c84c0ea0 stays as-is)", () => {
  const src = ".x { color: #c84c0ea0; } .y { color: #c84c0e; }";
  const { css, counts } = transformCss(src, TOKENS, "");
  assert.equal(counts["--color-primary-main"], 1);
  assert.match(css, /color: #c84c0ea0/);
  assert.match(css, /color: var\(--color-primary-main, #c84c0e\)/);
});

test("prepends the root block verbatim", () => {
  const root = ":root { --color-primary-main: #c84c0e; }\n";
  const { css } = transformCss(".a {}", TOKENS, root);
  assert.ok(css.startsWith(root));
});

test("returns zero count for tokens whose hex does not appear", () => {
  const src = ".a { color: blue; }";
  const { counts } = transformCss(src, TOKENS, "");
  assert.equal(counts["--color-primary-main"], 0);
  assert.equal(counts["--color-primary-light"], 0);
});
```

**Step 2: Run tests, confirm they fail if transform-css is broken**

```bash
node --test scripts/lib/transform-css.test.js
```

Expected: 5 pass. (They will pass because Task 2 already extracted the module correctly — these tests pin the contract.)

**Step 3: Sanity-check failure mode: break transform briefly, see tests fail**

```bash
sed -i.bak 's/(?![0-9a-f])//' scripts/lib/transform-css.js
node --test scripts/lib/transform-css.test.js; echo "exit=$?"
mv scripts/lib/transform-css.js.bak scripts/lib/transform-css.js
```

Expected: `exit=1` during the sabotaged run (the longer-hex test fails), `exit=0` after restore.

**Step 4: Commit**

```bash
git add scripts/lib/transform-css.test.js
git commit -m "test: pin contract of transformCss with unit tests"
```

---

### Task 4: Expand the token inventory to the full Tailwind palette

Enumerate every color in `packages/css/tailwind.config.js` and map it to (hex, var name, fallback). Some tokens alias the same hex (e.g., `primary.main` and `focus` both map to `#c84c0e`); the transform still runs cleanly because replacement is hex-keyed. For clarity, list only one token per hex in the `TOKENS` array; the `:root` block exposes aliases separately.

**Files:**
- Modify: `scripts/vendor-digit-ui-css.js` (expand `TOKENS` and `ROOT_BLOCK`)

**Step 1: Replace TOKENS with the full set**

```js
const TOKENS = [
  // primary palette
  { hex: "c84c0e", varName: "--color-primary-main", fallback: "#c84c0e" },
  { hex: "f18f5e", varName: "--color-primary-light", fallback: "#F18F5E" },
  { hex: "c8602b", varName: "--color-primary-dark", fallback: "#C8602B" },
  // secondary
  { hex: "22394d", varName: "--color-secondary", fallback: "#22394D" },
  // text
  { hex: "0b0c0c", varName: "--color-text-primary", fallback: "#0B0C0C" },
  { hex: "505a5f", varName: "--color-text-secondary", fallback: "#505A5F" },
  // link
  { hex: "1d70b8", varName: "--color-link-normal", fallback: "#1D70B8" },
  { hex: "003078", varName: "--color-link-hover", fallback: "#003078" },
  // borders
  { hex: "d6d5d4", varName: "--color-border", fallback: "#D6D5D4" },
  { hex: "464646", varName: "--color-input-border", fallback: "#464646" },
  // status
  { hex: "d4351c", varName: "--color-error", fallback: "#D4351C" },
  { hex: "00703c", varName: "--color-success", fallback: "#00703C" },
  // grey scale
  { hex: "9e9e9e", varName: "--color-grey-dark", fallback: "#9E9E9E" },
  { hex: "eeeeee", varName: "--color-grey-mid", fallback: "#EEEEEE" },
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
```

**Step 2: Replace ROOT_BLOCK with the full default block**

```js
const ROOT_BLOCK = `:root {
  /* primary */
  --color-primary-light: #F18F5E;
  --color-primary-main: #c84c0e;
  --color-primary-dark: #C8602B;
  /* secondary */
  --color-secondary: #22394D;
  /* text */
  --color-text-primary: #0B0C0C;
  --color-text-secondary: #505A5F;
  /* link */
  --color-link-normal: #1D70B8;
  --color-link-hover: #003078;
  /* borders */
  --color-border: #D6D5D4;
  --color-input-border: #464646;
  /* status */
  --color-error: #D4351C;
  --color-success: #00703C;
  /* grey */
  --color-grey-dark: #9E9E9E;
  --color-grey-mid: #EEEEEE;
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
}
`;
```

**Step 3: Regenerate the vendored CSS and verify counts**

```bash
node scripts/vendor-digit-ui-css.js 2>&1 | tee /tmp/counts.txt
```

Every token should report a non-zero count. If any token shows `0 replacements`, investigate: the color may be referenced as a different-case hex variant (unlikely given case-insensitive match), or it's a palette token that upstream CSS never actually uses (acceptable — the `:root` block still exposes it for consumers).

**Step 4: Verify the transformed CSS is valid**

```bash
# Rough sanity: no stray unmatched braces, plausible size growth
wc -l public/vendor/digit-ui-css.css
grep -c 'var(--color-' public/vendor/digit-ui-css.css
```

Expected: line count ≈ original + 30 (for the `:root` block). `var(--color-` count should equal the sum of replacement counts from Step 3.

**Step 5: Commit**

```bash
git add scripts/vendor-digit-ui-css.js public/vendor/digit-ui-css.css
git commit -m "feat(theme): expand token inventory to full Tailwind palette"
```

---

### Task 5: Author the JSON schema

**Files:**
- Create: `src/theme/schema.json`

**Step 1: Write the schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DIGIT UI Theme Config",
  "type": "object",
  "required": ["version", "colors"],
  "additionalProperties": false,
  "properties": {
    "version": { "const": "1" },
    "name": { "type": "string" },
    "colors": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "primary": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "light": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#F18F5E" },
            "main":  { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#c84c0e" },
            "dark":  { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#C8602B" }
          }
        },
        "secondary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#22394D" },
        "text": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "primary":   { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#0B0C0C" },
            "secondary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#505A5F" }
          }
        },
        "link": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "normal": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#1D70B8" },
            "hover":  { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#003078" }
          }
        },
        "border":       { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#D6D5D4" },
        "input-border": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#464646" },
        "error":        { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#D4351C" },
        "success":      { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#00703C" },
        "grey": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "dark":  { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#9E9E9E" },
            "mid":   { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#EEEEEE" },
            "light": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#FAFAFA" },
            "bg":    { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#E3E3E3" }
          }
        },
        "digitv2": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "text-color-disabled": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#B1B4B6" },
            "header-sidenav":      { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#0B4B66" },
            "primary-bg":          { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#FEEFE7" },
            "alert-error-bg":      { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#EFC7C1" },
            "alert-success-bg":    { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#BAD6C9" },
            "alert-info":          { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#3498DB" },
            "alert-info-bg":       { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#C7E0F1" },
            "chart-1":             { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#048BD0" },
            "chart-2":             { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#FBC02D" },
            "chart-3":             { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#8E29BF" },
            "chart-4":             { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#EA8A3B" },
            "chart-5":             { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "default": "#0BABDE" }
          }
        }
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/theme/schema.json
git commit -m "feat(theme): add JSON Schema for theme config"
```

---

### Task 6: Expand `default.json` to match the schema

**Files:**
- Modify: `src/theme/default.json`

**Step 1: Replace the POC 4-token file with the full default palette**

```json
{
  "version": "1",
  "name": "default",
  "colors": {
    "primary": { "light": "#F18F5E", "main": "#c84c0e", "dark": "#C8602B" },
    "secondary": "#22394D",
    "text": { "primary": "#0B0C0C", "secondary": "#505A5F" },
    "link": { "normal": "#1D70B8", "hover": "#003078" },
    "border": "#D6D5D4",
    "input-border": "#464646",
    "error": "#D4351C",
    "success": "#00703C",
    "grey": { "dark": "#9E9E9E", "mid": "#EEEEEE", "light": "#FAFAFA", "bg": "#E3E3E3" },
    "digitv2": {
      "text-color-disabled": "#B1B4B6",
      "header-sidenav": "#0B4B66",
      "primary-bg": "#FEEFE7",
      "alert-error-bg": "#EFC7C1",
      "alert-success-bg": "#BAD6C9",
      "alert-info": "#3498DB",
      "alert-info-bg": "#C7E0F1",
      "chart-1": "#048BD0",
      "chart-2": "#FBC02D",
      "chart-3": "#8E29BF",
      "chart-4": "#EA8A3B",
      "chart-5": "#0BABDE"
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/theme/default.json
git commit -m "feat(theme): expand default.json to full palette"
```

---

### Task 7: Add ajv validation + unit tests to applyTheme

**Files:**
- Modify: `src/theme/applyTheme.js`
- Create: `src/theme/applyTheme.test.js`

**Step 1: Write the failing tests**

```js
// src/theme/applyTheme.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Minimal DOM stub so applyTheme can run under node --test without jsdom.
function stubDocument() {
  const props = {};
  global.document = {
    documentElement: {
      style: {
        setProperty(name, value) { props[name] = value; },
      },
    },
  };
  global.console = { ...console, warn: () => {}, log: () => {} };
  return props;
}

// Reset module cache so each test gets a fresh applyTheme.
function freshApply() {
  delete require.cache[require.resolve("./applyTheme.js")];
  return require("./applyTheme.js").applyTheme;
}

test("valid config: writes all flattened variables", () => {
  const props = stubDocument();
  const applyTheme = freshApply();
  applyTheme({
    version: "1",
    colors: {
      primary: { main: "#ff0000", light: "#ff8080", dark: "#800000" },
      secondary: "#00ff00",
    },
  });
  assert.equal(props["--color-primary-main"], "#ff0000");
  assert.equal(props["--color-primary-light"], "#ff8080");
  assert.equal(props["--color-primary-dark"], "#800000");
  assert.equal(props["--color-secondary"], "#00ff00");
});

test("missing colors key: no-op, does not throw", () => {
  const props = stubDocument();
  const applyTheme = freshApply();
  applyTheme({ version: "1" });
  assert.deepEqual(props, {});
});

test("invalid value shape (not a hex): no-op", () => {
  const props = stubDocument();
  const applyTheme = freshApply();
  applyTheme({
    version: "1",
    colors: { primary: { main: "not-a-color" } },
  });
  assert.deepEqual(props, {});
});

test("null / undefined / non-object config: no-op", () => {
  const props = stubDocument();
  const applyTheme = freshApply();
  applyTheme(null);
  applyTheme(undefined);
  applyTheme(42);
  applyTheme("theme");
  assert.deepEqual(props, {});
});
```

**Step 2: Run tests, confirm they fail**

```bash
node --test src/theme/applyTheme.test.js
```

Expected: multiple failures — the POC loader has no validation, so the "invalid value" test will incorrectly succeed at writing. This run is the TDD red phase.

**Step 3: Rewrite applyTheme with ajv validation**

```js
// src/theme/applyTheme.js
import Ajv from "ajv";
import schema from "./schema.json";

const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false });
const validate = ajv.compile(schema);

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const next = prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === "object") {
      flatten(value, next, out);
    } else {
      out[`--color-${next}`] = value;
    }
  }
}

export function applyTheme(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    console.warn("[theme] config must be an object, skipping apply");
    return;
  }
  if (!validate(config)) {
    console.warn("[theme] invalid config, skipping apply", validate.errors);
    return;
  }
  if (!config.colors) return;

  const vars = {};
  flatten(config.colors, "", vars);
  const root = document.documentElement;
  for (const name of Object.keys(vars)) {
    root.style.setProperty(name, vars[name]);
  }
  console.log(`[theme] applied ${Object.keys(vars).length} variables`);
}
```

Because the test file uses CommonJS `require` but `applyTheme.js` is ESM, add a small bridge: at the bottom of `applyTheme.js`, also export via CommonJS interop. Alternatively, run the test file with `node --experimental-vm-modules` or refactor the test file to use dynamic `import()`. The simplest path: convert `applyTheme.js` to CommonJS-compatible (esbuild will still bundle it correctly because it handles both):

Actually: esbuild is fine with ESM-in-ESM. The test file needs to use dynamic import. Update the test file to use:

```js
async function freshApply() {
  // Fresh import each call. node:test invalidates cache per test run already.
  const mod = await import("./applyTheme.js");
  return mod.applyTheme;
}
```

…and mark the tests as `async test(...)`.

**Step 4: Run tests, confirm they pass**

```bash
node --test src/theme/applyTheme.test.js
```

Expected: 4 pass.

**Step 5: Verify the app still builds and the integration test still passes**

```bash
PORT=19080 node esbuild.dev.js &
sleep 6
POC_BASE_URL=http://127.0.0.1:19080/digit-ui/ npx playwright test --config=tests/theme-poc.playwright.config.js
kill %1
```

Expected: 1 passed. (The integration test uses raw `setProperty`, so it bypasses ajv — that's fine.)

**Step 6: Commit**

```bash
git add src/theme/applyTheme.js src/theme/applyTheme.test.js
git commit -m "feat(theme): ajv-validate config + unit tests for applyTheme"
```

---

### Task 8: Add Phase-2 hook stub in bootstrap

**Files:**
- Modify: `src/index.js`

**Step 1: Locate the tenant resolution**

In `src/index.js`, `bootstrap()` resolves `Employee.tenantId` and `Citizen.tenantId` into session storage around lines 60–85. The Phase-2 theme fetch belongs right after those assignments, before `ReactDOM.render()`.

**Step 2: Insert the stub just before `ReactDOM.render`**

```js
// Phase 2 (not implemented in this PR): once the user's tenant is resolved
// above, fetch the per-tenant theme from MDMS and apply it. On failure,
// keep the defaults already applied at module load.
//
// const tenantId =
//   window.Digit.SessionStorage.get("Employee.tenantId") ||
//   window.Digit.SessionStorage.get("Citizen.tenantId");
// try {
//   const config = await fetchThemeFromMDMS(tenantId);
//   if (config) applyTheme(config);
// } catch (err) {
//   console.warn("[theme] MDMS fetch failed, keeping defaults", err);
// }
```

Place this comment block immediately above the `console.log("[bootstrap] About to call ReactDOM.render()");` line.

**Step 3: Verify the app still builds**

```bash
PORT=19080 node esbuild.dev.js &
sleep 5
curl -sI http://127.0.0.1:19080/digit-ui/ | head -1
kill %1
```

Expected: `HTTP/1.1 200 OK`.

**Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(theme): add Phase-2 MDMS fetch hook stub in bootstrap"
```

---

### Task 9: Production-build parity for the vendored CSS

The POC only wired the dev server. Production (`esbuild.build.js`) must serve the same transformed CSS.

**Files:**
- Modify: `esbuild.build.js`
- Modify: `package.json` (prebuild script)

**Step 1: Add a prebuild hook that generates the vendored CSS**

Edit `package.json`:

```json
"scripts": {
  "dev": "node esbuild.dev.js",
  "prebuild": "node scripts/vendor-digit-ui-css.js",
  "build": "node esbuild.build.js",
  "predev": "node scripts/vendor-digit-ui-css.js",
  …
}
```

Note: `predev` only runs once on `npm run dev` startup; after that the file is served from disk and survives restarts. Running the transform on every dev start keeps upstream pinning honest.

**Step 2: Confirm `esbuild.build.js`'s asset-copy loop already handles the vendor file**

`esbuild.build.js` lines 134–143 copy every file in `public/` into `build/`. It currently iterates only the top level — `public/vendor/digit-ui-css.css` lives in a subdirectory and will NOT be copied. Add recursive copy:

Replace the existing loop with:

```js
function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// Copy public assets to build (excluding the source index.html, which is generated)
const publicDir = path.resolve(__dirname, "public");
const buildDir = path.resolve(__dirname, "build");
for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
  if (entry.name === "index.html") continue;
  const src = path.join(publicDir, entry.name);
  const dest = path.join(buildDir, entry.name);
  if (entry.isDirectory()) copyRecursive(src, dest);
  else if (entry.isFile()) fs.copyFileSync(src, dest);
}
```

**Step 3: Run a production build end-to-end and verify the vendor CSS landed**

```bash
rm -rf build
npm run build
ls -la build/vendor/digit-ui-css.css
grep -c 'var(--color-primary-main' build/vendor/digit-ui-css.css
```

Expected: file exists; replacement count matches the number reported by the vendor script.

**Step 4: Commit**

```bash
git add esbuild.build.js package.json
git commit -m "feat(theme): prod build parity — prebuild hook + recursive public copy"
```

---

### Task 10: Housekeeping — gitignore the upstream snapshot, document the flow

The upstream CSS snapshot (`public/vendor/digit-ui-css.original.css`, ~500KB) is a regeneration artifact, not source. Only the transformed output and the script belong in git.

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

**Step 1: Add to gitignore and remove from index if tracked**

```bash
echo "public/vendor/digit-ui-css.original.css" >> .gitignore
git rm --cached public/vendor/digit-ui-css.original.css 2>/dev/null || true
```

**Step 2: Add a README section**

Append to `README.md` (or create if none):

```markdown
## Theming

Runtime theming is driven by CSS custom properties on `:root`. The flow:

1. `scripts/vendor-digit-ui-css.js` fetches the upstream `@egovernments/digit-ui-css` from unpkg, rewrites themeable hex literals to `var(--color-*, fallback)`, prepends a `:root` block with upstream defaults, and writes `public/vendor/digit-ui-css.css`.
2. `public/index.html` loads that file in place of the CDN URL.
3. `src/theme/applyTheme.js` flattens a nested JSON config and writes each leaf to `document.documentElement` at bootstrap. `src/index.js` calls it with the bundled `src/theme/default.json`.
4. Phase 2 (future, not implemented): replace the bundled JSON with an MDMS fetch keyed by the authenticated user's `tenantId`. See the commented hook in `src/index.js`'s `bootstrap()`.

The prebuild npm hooks run the vendor script automatically before `dev` and `build`. To regenerate manually:

    node scripts/vendor-digit-ui-css.js

Schema for theme configs lives in `src/theme/schema.json`.
```

**Step 3: Commit**

```bash
git add .gitignore README.md
git commit -m "chore(theme): gitignore upstream snapshot; document the theming flow"
```

---

### Task 11: Rename & expand the integration test

The POC test (`tests/theme-poc.spec.js`) proved the approach. Rename it to a feature-level name and expand coverage to multiple primary-colored surfaces.

**Files:**
- Rename: `tests/theme-poc.spec.js` → `tests/theme.spec.js`
- Rename: `tests/theme-poc.playwright.config.js` → `tests/theme.playwright.config.js`
- Modify: the renamed spec (expand assertions)

**Step 1: Rename via git**

```bash
git mv tests/theme-poc.spec.js tests/theme.spec.js
git mv tests/theme-poc.playwright.config.js tests/theme.playwright.config.js
```

Update the `testMatch` in the renamed config to `theme.spec.js`.

**Step 2: Expand the spec to assert multiple tokens flip**

Replace the single-token override with a full-palette override via `applyTheme`, then assert on computed styles of several known selectors. Add an assertion that the bundled `applyTheme(defaultTheme)` produced matching resolved CSS variables on `:root`:

```js
// tests/theme.spec.js — replace the override step with:
const alt = {
  version: "1",
  colors: {
    primary: { light: "#a78bfa", main: "#7c3aed", dark: "#5b21b6" },
    link: { normal: "#16a34a", hover: "#15803d" },
    digitv2: { "primary-bg": "#ede9fe" },
  },
};
await page.evaluate((cfg) => window.__applyTheme(cfg), alt);
```

Expose `applyTheme` on `window` in dev builds for this purpose — add to `src/index.js`:

```js
if (process.env.NODE_ENV !== "production") {
  window.__applyTheme = applyTheme;
}
```

**Step 3: Run the integration test**

```bash
PORT=19080 node esbuild.dev.js &
sleep 6
POC_BASE_URL=http://127.0.0.1:19080/digit-ui/ npx playwright test --config=tests/theme.playwright.config.js
kill %1
```

Expected: 1 passed; before/after screenshots visibly differ on multiple surfaces.

**Step 4: Commit**

```bash
git add tests/theme.spec.js tests/theme.playwright.config.js src/index.js
git commit -m "test(theme): expand integration coverage; expose applyTheme on window in dev"
```

---

### Task 12: Full-build smoke and acceptance-criteria review

**Files:** none (verification only)

**Step 1: Clean build from scratch**

```bash
cd /root/code/digit-ui-esbuild
rm -rf build node_modules/.cache
npm run build
```

Expected: exits 0; `build/index.html` exists; `build/vendor/digit-ui-css.css` exists and contains the `:root` block and > 200 `var(--color-*` references.

**Step 2: Re-run all tests**

```bash
node --test scripts/lib/transform-css.test.js
node --test src/theme/applyTheme.test.js
PORT=19080 node esbuild.dev.js &
sleep 6
POC_BASE_URL=http://127.0.0.1:19080/digit-ui/ npx playwright test --config=tests/theme.playwright.config.js
kill %1
```

All pass.

**Step 3: Walk the acceptance criteria from TASK-021**

- [ ] `packages/css/tailwind.config.js` palette uses `var(--color-*)` references — **DIVERGENCE**: POC chose to rewrite upstream CSS via vendor-and-transform rather than touch `packages/css/` (because its build is broken on Node 18). Document the divergence in the PR description and close the GitHub issue with a comment explaining the pivot.
- [ ] `packages/css/src/themes/variables.scss` declares defaults — **DIVERGENCE**: the `:root` block is prepended to the vendored CSS by the transform script instead. Same PR note.
- [ ] `default.json` and `schema.json` exist and cover the full color set — **DONE**.
- [ ] Theme loader exposes `applyTheme(config)` — **DONE**.
- [ ] App bootstrap calls `applyTheme(defaultTheme)` — **DONE** (before `initLibraries`; hook site for Phase 2 documented).
- [ ] Swapping `default.json` changes rendered colors — **DONE** (Playwright test).
- [ ] No existing `theme(colors.*)` or raw hex literal is broken — **DONE** (vendored CSS is a superset-preserving rewrite; raw hex in non-targeted values untouched).
- [ ] Invalid input → logs + leaves defaults — **DONE** (unit tests).

**Step 4: Update the TASK-021 internal doc + GitHub issue**

Fill in the Results section of `~/outputs/TASK-021-digit-ui-theme-config.md`; add a comment to issue #1 summarizing the outcome and any divergences. Move the TODO.md entry from Active to Completed.

**Step 5: Open the PR**

```bash
git push -u origin poc/theme-config
gh pr create --title "Runtime theme config for DIGIT UI (Phase 1)" \
  --body-file - <<'EOF'
Closes #1.

## What

Runtime theming driven by CSS custom properties on `:root`, overridden at app bootstrap from a bundled JSON config. Phase 2 (MDMS-per-tenant) hook site stubbed, not implemented.

## Approach divergence from the ticket body

The ticket proposed editing `packages/css/tailwind.config.js` and adding a `themes/variables.scss` partial. In practice, `packages/css/` does not build on Node 18 (node-sass 4.14 + gyp). Rather than block on a gulp→esbuild migration, the PR vendors the published upstream CSS from unpkg and rewrites themeable hex literals in place. Net effect is identical for consumers of the running app; `packages/css/` is untouched. A future ticket can migrate the upstream package once its build is modernized.

## Files

- `scripts/vendor-digit-ui-css.js` + `scripts/lib/transform-css.js` — CDN fetch + pure transform, unit-tested
- `public/vendor/digit-ui-css.css` — transformed output committed; `*.original.css` gitignored
- `src/theme/applyTheme.js` — ajv-validated loader, unit-tested
- `src/theme/default.json`, `src/theme/schema.json` — bundled defaults + schema
- `src/index.js` — applyTheme bootstrap + Phase-2 hook stub
- `public/index.html` — CDN link swapped for local
- `esbuild.dev.js`, `esbuild.build.js`, `package.json` — dev serving + prebuild hook + recursive asset copy
- `tests/theme.spec.js` — Playwright integration proof
- Side-fix: `packages/libraries/src/index.js` (MdmsService export), `products/pgr/src/redux/actions/index.js` (drop stale APPLY_FILTER) — split into their own commit

## Tests

- `node --test scripts/lib/transform-css.test.js` — transform contract
- `node --test src/theme/applyTheme.test.js` — loader validation
- `npx playwright test --config=tests/theme.playwright.config.js` — runtime swap visible on rendered page
EOF
```

**Step 6: Commit the plan (if not already) and push**

```bash
git add docs/plans/2026-04-17-digit-ui-theme-config-design.md docs/plans/2026-04-17-digit-ui-theme-config.md
git diff --cached --stat
git commit -m "docs: add theme-config design doc and implementation plan"
git push -u origin poc/theme-config
```

---

## Done when

- All tasks above committed on `poc/theme-config`.
- PR opened against `main`, linked to issue #1.
- TASK-021 local doc Results section filled; TODO.md moved entry to Completed.
- Integration test passes against the PR branch.
- TASK-022 (raw hex audit, issue #2) remains open and blocked on this PR merging.

## Non-goals (explicitly deferred)

- Migrating `packages/css` from gulp to esbuild.
- Migrating raw hex literals in SCSS partials (TASK-022).
- Implementing the Phase-2 MDMS fetch. Hook site exists; the fetch is a separate ticket.
- Dark mode, simultaneous multi-theme render, mid-session re-theming.
