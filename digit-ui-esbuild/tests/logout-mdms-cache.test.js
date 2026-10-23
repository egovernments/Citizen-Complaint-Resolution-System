// ours#648: logout clears the IndexedDB MDMS cache (idbCache, database "digit-ui") with local/session storage, so a
// re-login on the same browser reads current master data; "sign out other devices" keeps it; a blocked IndexedDB
// never holds up the sign-out.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// One bundle per test: idbCache memoises its database handle at module level.
let n = 0;
const loadUserService = () => {
  const out = path.join(os.tmpdir(), `logout-mdms-cache.${process.pid}.${n++}.cjs.js`);
  esbuild.buildSync({
    stdin: {
      contents: `export { UserService } from "./elements/User/index.js";`,
      resolveDir: path.join(__dirname, "../packages/libraries/src/services"),
      sourcefile: "logout-mdms-cache-entry.js",
      loader: "js",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: out,
    logLevel: "error",
  });
  process.on("exit", () => {
    try { fs.unlinkSync(out); } catch (_) { /* already removed */ }
  });
  global.window = { globalConfigs: { getConfig: () => undefined } };
  const { UserService } = require(out);
  delete global.window;
  return UserService;
};

/** Minimal IndexedDB: records clears; `hang` never answers open(). */
const fakeIndexedDB = (events, { hang = false } = {}) => ({
  open: () => {
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {};
        tx.objectStore = () => ({
          clear: () => {
            events.push("idb-clear");
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          },
        });
        return tx;
      },
    };
    const req = { result: db };
    if (!hang) setTimeout(() => req.onsuccess && req.onsuccess(), 0);
    return req;
  },
});

const TENANT = { urlSlug: "bomet-county", appBasePath: "bomet-county/digit-ui", tenantId: "ke.bomet", rootTenantId: "ke" };

const withBrowser = async (events, fn) => {
  global.window = {
    location: {
      pathname: "/bomet-county/digit-ui/employee/pgr/inbox",
      origin: "https://example.test",
      replace: () => events.push("navigate"),
    },
    contextPath: TENANT.appBasePath,
    globalConfigs: { getConfig: () => undefined },
    __digitTenantContext: { ...TENANT, surface: "employee" },
    fetch: async () => ({ ok: true, status: 204, json: async () => null }),
    localStorage: { clear: () => events.push("local-clear"), setItem: () => {}, getItem: () => null },
    sessionStorage: { clear: () => events.push("session-clear") },
  };
  try {
    await fn();
  } finally {
    delete global.window;
    delete global.indexedDB;
  }
};

test("signing out of this device clears the MDMS cache before leaving", async () => {
  const UserService = loadUserService();
  const events = [];
  global.indexedDB = fakeIndexedDB(events);
  await withBrowser(events, () => UserService.logout());
  assert.ok(events.includes("idb-clear"), events.join(","));
  assert.ok(events.indexOf("idb-clear") < events.indexOf("navigate"), events.join(","));
  assert.ok(events.includes("local-clear") && events.includes("session-clear"), events.join(","));
});

test("sign out everywhere clears it too", async () => {
  const UserService = loadUserService();
  const events = [];
  global.indexedDB = fakeIndexedDB(events);
  await withBrowser(events, () => UserService.logout("all"));
  assert.ok(events.indexOf("idb-clear") >= 0 && events.indexOf("idb-clear") < events.indexOf("navigate"), events.join(","));
});

test("sign out other devices keeps this session's cache", async () => {
  const UserService = loadUserService();
  const events = [];
  global.indexedDB = fakeIndexedDB(events);
  await withBrowser(events, () => UserService.logout("others"));
  assert.ok(!events.includes("idb-clear"), events.join(","));
});

test("a blocked IndexedDB does not hold up the sign-out", async () => {
  const UserService = loadUserService();
  const events = [];
  global.indexedDB = fakeIndexedDB(events, { hang: true });
  const t0 = Date.now();
  await withBrowser(events, () => UserService.logout());
  assert.ok(events.includes("navigate"), events.join(","));
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test("no IndexedDB at all (private mode) still signs out", async () => {
  const UserService = loadUserService();
  const events = [];
  await withBrowser(events, () => UserService.logout());
  assert.ok(events.includes("navigate"), events.join(","));
});
