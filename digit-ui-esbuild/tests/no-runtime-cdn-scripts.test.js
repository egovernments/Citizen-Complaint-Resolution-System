// ours#773: public/index.html loads no <script> from a third-party origin at run time (a CDN outage left the login
// page blank, and an unpinned script could change under a running county). Scripts are same-origin; anything the
// page needs is vendored at build time with a pinned hash.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const scriptSrcs = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);

test("index.html loads no script from another origin", () => {
  const foreign = scriptSrcs.filter((src) => /^(https?:)?\/\//i.test(src));
  assert.deepEqual(foreign, []);
});

test("every vendored script the page loads is pinned by sha256 in the vendor step", () => {
  const vendored = scriptSrcs.filter((src) => src.includes("/vendor/")).map((src) => path.basename(src));
  if (!vendored.length) return;
  const vendorJs = fs.readFileSync(path.join(root, "scripts/vendor-digit-ui-css.js"), "utf8");
  for (const name of vendored) {
    const entry = new RegExp(`name:\\s*"${name.replace(".", "\\.")}"[\\s\\S]{0,200}?sha256:\\s*"[0-9a-f]{64}"`);
    assert.match(vendorJs, entry, `${name} has no sha256-pinned entry in scripts/vendor-digit-ui-css.js`);
  }
});
