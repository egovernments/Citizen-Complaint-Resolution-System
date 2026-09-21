const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);
const routesDir = path.join(projectRoot, "src/channel/routes");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

stub("../../channel", routesDir, { verifyRequest: () => true });
stub("../../session/session-manager", routesDir, { authenticateAndDispatch: async () => {} });
stub("../../env-variables", routesDir, {
  port: 8082, contextPath: "/xstate-chatbot", isSandboxMode: false, rootTenantId: "mz",
});

const reminders = stub("../../machine/service/reminders-service", routesDir, {
  triggerReminders: async () => {},
});

const router = require(path.join(routesDir, "index.js"));

function reminderHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === "/reminder") {
      const handlers = layer.route.stack.map((s) => s.handle);
      return handlers[handlers.length - 1];
    }
  }
  throw new Error("/reminder route not found");
}

function fakeRes() {
  const res = { statusCode: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.sendStatus = (code) => { res.statusCode = code; res.ended = true; return res; };
  res.send = () => { res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

test("a sweep that throws answers 500 instead of killing the process", async () => {
  // The handler was `await remindersService.triggerReminders(); res.end();` with
  // no try/catch. getUserId is missing on the in-memory repo, so the TypeError
  // became a rejected async handler, which Express 4 ignores — unhandledRejection,
  // and Node 23 exits. One unauthenticated POST restarted the service.
  reminders.triggerReminders = async () => { throw new TypeError("repoProvider.getUserId is not a function"); };

  const res = fakeRes();
  await assert.doesNotReject(() => reminderHandler()({}, res), "the rejection is contained");
  assert.equal(res.statusCode, 500);
  assert.equal(res.ended, true);
});

test("a successful sweep answers 200", async () => {
  let ran = false;
  reminders.triggerReminders = async () => { ran = true; };

  const res = fakeRes();
  await reminderHandler()({}, res);

  assert.equal(ran, true);
  assert.equal(res.statusCode, 200);
});

test("the in-memory repo can list active users, so the sweep does not throw", async () => {
  const repo = require(p("src/session/repo/in-memory-repo.js"));

  await repo.insertNewState("u-active", true, JSON.stringify({ done: false }), "s1", Date.now());
  await repo.insertNewState("u-finished", false, JSON.stringify({ done: true }), "s2", Date.now());

  assert.deepEqual(await repo.getUserId(true), ["u-active"]);
  assert.deepEqual(await repo.getUserId(false), ["u-finished"]);
});
