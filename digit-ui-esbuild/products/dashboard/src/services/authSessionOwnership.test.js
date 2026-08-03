// Shared-alias ownership tests for authService (#1535, #1536).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/services/authSessionOwnership.test.js
//
// authService.js is ESM (like the rest of products/), so the test bundles it to
// CJS with the repo's own esbuild and reloads it per test for fresh module
// state — same idiom as dashboardMetrics.test.js.
//
// The scenario under test throughout: the dashboard and the citizen-facing
// digit-ui portal are CO-HOSTED and share the unprefixed `token` / `user-info`
// localStorage aliases plus the single Digit.SessionStorage "User" slot.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "authService.js");
const OUT = path.join(os.tmpdir(), `authService.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

/** Values land in localStorage JSON-encoded — mirror that when seeding. */
const enc = (v) => JSON.stringify(v);

function load({ local = {}, user = undefined } = {}) {
  const localStorage = makeStorage(local);
  let userSlot = user;
  global.window = {
    localStorage,
    sessionStorage: makeStorage(),
    Digit: {
      SessionStorage: {
        get: (k) => (k === "User" ? userSlot : undefined),
        set: (k, v) => {
          if (k === "User") userSlot = v;
        },
      },
    },
    dispatchEvent: () => {},
  };
  delete require.cache[require.resolve(OUT)];
  const mod = require(OUT);
  return { mod, localStorage, readUser: () => userSlot };
}

/* ------------------------------------------------------------------ */
/* #1535 — persistSession must not seize aliases it does not own       */
/* ------------------------------------------------------------------ */

test("silent refresh does not clobber a citizen's aliases", () => {
  // A citizen is signed into the co-hosted portal; the aliases are THEIRS.
  // A stale dashboard tab 401s and silently refreshes in the background.
  const { mod, localStorage, readUser } = load({
    local: {
      "Employee.token": enc("employee-old"),
      token: enc("citizen-token"),
      "user-info": enc({ uuid: "citizen" }),
    },
    user: { token: "citizen-token", info: { uuid: "citizen" } },
  });

  mod.persistSession({ accessToken: "employee-new", userInfo: { uuid: "employee", roles: [] } });

  const dump = localStorage._dump();
  assert.equal(JSON.parse(dump.token), "citizen-token", "citizen's token alias survives");
  assert.deepEqual(JSON.parse(dump["user-info"]), { uuid: "citizen" }, "citizen's user-info survives");
  assert.equal(JSON.parse(dump["Employee.token"]), "employee-new", "our own key still refreshes");
  assert.equal(readUser().token, "citizen-token", "citizen's Digit session cache untouched");
});

test("silent refresh DOES update aliases it still owns", () => {
  const { mod, localStorage, readUser } = load({
    local: {
      "Employee.token": enc("employee-old"),
      token: enc("employee-old"),
      "user-info": enc({ uuid: "employee" }),
    },
    user: { token: "employee-old" },
  });

  mod.persistSession({ accessToken: "employee-new", userInfo: { uuid: "employee", roles: [] } });

  const dump = localStorage._dump();
  assert.equal(JSON.parse(dump.token), "employee-new", "our own alias follows the refresh");
  assert.equal(readUser().token, "employee-new", "co-hosted UI stays on the live token");
});

test("explicit sign-in claims the aliases", () => {
  const { mod, localStorage } = load({
    local: { token: enc("citizen-token"), "user-info": enc({ uuid: "citizen" }) },
  });

  mod.persistSession({
    accessToken: "employee-new",
    userInfo: { uuid: "employee", roles: [] },
    claimAliases: true,
  });

  assert.equal(JSON.parse(localStorage._dump().token), "employee-new");
});

test("aliases are claimed when absent", () => {
  const { mod, localStorage } = load({ local: {} });
  mod.persistSession({ accessToken: "employee-new", userInfo: { uuid: "employee", roles: [] } });
  assert.equal(JSON.parse(localStorage._dump().token), "employee-new");
});

/* ------------------------------------------------------------------ */
/* #1536 — sign-out is unconditional; teardown keys off the cache      */
/* ------------------------------------------------------------------ */

test("forced sign-out clears aliases even when the alias was rewritten", () => {
  // The kiosk case: alias no longer byte-matches Employee.token, so the
  // ownership gate would have skipped it and left a live token behind.
  const { mod, localStorage, readUser } = load({
    local: {
      "Employee.token": enc("employee-live"),
      token: enc("something-else"),
      "user-info": enc({ uuid: "employee" }),
    },
    user: { token: "employee-live" },
  });

  mod.clearSession({ force: true });

  const dump = localStorage._dump();
  assert.equal(dump.token, undefined, "token alias is gone");
  assert.equal(dump["user-info"], undefined, "user-info alias is gone");
  assert.equal(dump["Employee.token"], undefined, "our own key is gone");
  assert.equal(readUser(), null, "Digit session cache emptied");
});

test("automatic teardown still spares a citizen's live aliases", () => {
  const { mod, localStorage } = load({
    local: { "Employee.token": enc("employee-dead"), token: enc("citizen-token") },
    user: { token: "citizen-token" },
  });

  mod.clearSession();

  const dump = localStorage._dump();
  assert.equal(JSON.parse(dump.token), "citizen-token", "citizen stays signed in");
  assert.equal(dump["Employee.token"], undefined, "the dead employee token is dropped");
});

test("automatic teardown drops a dead token cached under a foreign alias", () => {
  // ownsAliases is false (the alias was rewritten), but the "User" cache still
  // holds the employee's dead token — gating the cache clear on alias
  // ownership stranded exactly the token this teardown exists to remove.
  const { mod, readUser } = load({
    local: { "Employee.token": enc("employee-dead"), token: enc("rewritten-by-someone") },
    user: { token: "employee-dead" },
  });

  mod.clearSession();

  assert.equal(readUser(), null, "dead token no longer cached for the co-hosted UI");
});
