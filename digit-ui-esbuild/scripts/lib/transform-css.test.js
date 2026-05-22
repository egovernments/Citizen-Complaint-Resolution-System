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

test("normalizes 3-digit hex shorthand to 6-digit form before matching", () => {
  const src = ".a { color: #eee; } .b { color: #EEE; } .c { color: #eeeeee; }";
  const tokens = [
    { hex: "eeeeee", varName: "--color-grey-mid", fallback: "#EEEEEE" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  // All three forms should resolve to the same token.
  assert.equal(counts["--color-grey-mid"], 3);
  // And no raw #eee remains in the output.
  assert.doesNotMatch(css, /#eee(?![0-9a-f])/i);
});

test("shorthand normalization does not affect 6-digit colors", () => {
  const src = ".x { color: #c84c0e; } .y { color: #c84c0ea0; }";
  const tokens = [
    { hex: "c84c0e", varName: "--color-primary-main", fallback: "#c84c0e" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  assert.equal(counts["--color-primary-main"], 1);
  // The 8-digit alpha form must be preserved exactly.
  assert.match(css, /color: #c84c0ea0/);
});

test("rewrites rgba(R,G,B,var(--bg-opacity)) companions to use relative-color syntax", () => {
  // Mirrors a real Tailwind output where two declarations stomp on each other
  // and the rgba one wins, defeating MDMS theming. After transform, the rgba
  // should be themable AND opacity-aware.
  const src =
    ".navbar { color: #ffffff; --bg-opacity:1; background-color: #22394D; background-color: rgba(34, 57, 77, var(--bg-opacity)); }";
  const tokens = [
    { hex: "22394d", varName: "--color-secondary", fallback: "#22394D" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  assert.equal(counts["--color-secondary"], 1);
  assert.equal(counts._rgbaRewrites, 1);
  assert.match(
    css,
    /rgb\(from var\(--color-secondary, #22394D\) r g b \/ var\(--bg-opacity\)\)/
  );
});

test("rewrites text-opacity companions too, not just bg-opacity", () => {
  const src = ".h1 { color: rgba(11, 12, 12, var(--text-opacity)); }";
  const tokens = [
    { hex: "0b0c0c", varName: "--color-text-primary", fallback: "#0B0C0C" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  assert.equal(counts._rgbaRewrites, 1);
  assert.match(
    css,
    /rgb\(from var\(--color-text-primary, #0B0C0C\) r g b \/ var\(--text-opacity\)\)/
  );
});

test("leaves rgba() with literal alpha untouched (only --*-opacity vars are rewritten)", () => {
  const src = ".banner { background-color: rgba(34, 57, 77, 0.5); }";
  const tokens = [
    { hex: "22394d", varName: "--color-secondary", fallback: "#22394D" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  assert.equal(counts._rgbaRewrites, 0);
  // The literal-alpha rgba is preserved (different use case from Tailwind dual-decl).
  assert.match(css, /rgba\(34, 57, 77, 0\.5\)/);
});

test("leaves rgba() whose RGB does not match any token unchanged", () => {
  const src = ".x { color: rgba(123, 45, 67, var(--text-opacity)); }";
  const tokens = [
    { hex: "c84c0e", varName: "--color-primary-main", fallback: "#c84c0e" },
  ];
  const { css, counts } = transformCss(src, tokens, "");
  assert.equal(counts._rgbaRewrites, 0);
  assert.match(css, /rgba\(123, 45, 67, var\(--text-opacity\)\)/);
});
