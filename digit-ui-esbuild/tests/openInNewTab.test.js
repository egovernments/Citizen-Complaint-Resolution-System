// #224 follow-up: the inbox's "open in new tab" opens an app page in a tab that
// keeps the login, and cuts the link back to the opening tab.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/openInNewTab.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports });
const { openInNewTabSignedIn } = mod.exports;

const fakeWindow = (result = {}) => {
  const calls = [];
  return {
    calls,
    location: { origin: "https://cms.example" },
    open: (url, name, features) => {
      calls.push({ url, name, features });
      return result;
    },
  };
};

test("opens the page on this site in a new tab, without noopener (so the login is copied)", () => {
  const opened = { opener: "the opening tab" };
  const win = fakeWindow(opened);
  assert.strictEqual(openInNewTabSignedIn("/digit-ui/employee/pgr/complaint-details/PG-1", { win }), true);
  assert.deepStrictEqual(win.calls, [{ url: "https://cms.example/digit-ui/employee/pgr/complaint-details/PG-1", name: "_blank", features: undefined }]);
  assert.strictEqual(opened.opener, null, "link back to the opening tab is cut");
});

test("refuses anything that is not a path on this site", () => {
  for (const bad of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "", null, undefined, 42]) {
    const win = fakeWindow({});
    assert.strictEqual(openInNewTabSignedIn(bad, { win }), false, String(bad));
    assert.strictEqual(win.calls.length, 0, String(bad));
  }
});

test("reports a blocked pop-up", () => {
  const win = fakeWindow(null);
  assert.strictEqual(openInNewTabSignedIn("/digit-ui/employee", { win }), false);
});

test("a read-only opener does not break opening", () => {
  const opened = {};
  Object.defineProperty(opened, "opener", { get: () => "x", set: () => { throw new Error("read-only"); } });
  const win = fakeWindow(opened);
  assert.strictEqual(openInNewTabSignedIn("/digit-ui/employee", { win }), true);
});
