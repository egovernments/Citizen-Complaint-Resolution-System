const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const routesDir = path.join(projectRoot, "src/channel/routes");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

const provider = stub("../../channel", routesDir, {
  signed: true,
  verifyRequest() { return this.signed; },
  extractRawMessage: (req) => req.body,
  isValid: async () => false,
});
stub("../../session/session-manager", routesDir, { authenticateAndDispatch: async () => {} });
stub("../../machine/service/reminders-service", routesDir, { triggerReminders: async () => {} });
stub("../../env-variables", routesDir, {
  port: 8082, contextPath: "/xstate-chatbot", isSandboxMode: false, rootTenantId: "mz",
});

const router = require(path.join(routesDir, "index.js"));

function chainFor(routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`${routePath} route not found`);
}

function fakeRes(onEnd = () => {}) {
  const headers = {};
  const res = { statusCode: null, ended: false, headers };
  const finish = () => { res.ended = true; onEnd(); return res; };
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; return res; };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.removeHeader = (k) => { delete headers[k.toLowerCase()]; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = finish;
  res.send = finish;
  res.sendStatus = (code) => { res.statusCode = code; return finish(); };
  res.end = finish;
  res.on = () => res;
  return res;
}

/**
 * One trip through a middleware. Settles on whichever comes first — next(), or
 * the middleware answering the request itself, which is what the limiter does
 * on 429 and is why awaiting next() alone hangs forever.
 */
function step(middleware, req) {
  return new Promise((resolve) => {
    const res = fakeRes(() => resolve({ res, passed: false }));
    middleware(req, res, () => resolve({ res, passed: true }));
  });
}

// No `ip` property at all. Anything that reaches for one gets undefined, so a
// reintroduced req.ip fallback collapses every sender into one bucket and the
// per-sender test below fails — which is the point.
function fakeReq({ from } = {}) {
  return {
    method: "POST",
    originalUrl: "/xstate-chatbot/message",
    body: from ? { From: from, Body: "ola" } : {},
    query: {},

  };
}

/** Walks a route's middleware in order, reporting how far it got. */
async function run(chain, req) {
  let reached = 0;
  let last;
  for (const handler of chain) {
    last = await step(handler, req);
    reached += 1;
    if (!last.passed) break;
  }
  return { reached, res: last.res };
}

test("verification is the first middleware on every citizen-facing route", () => {
  // Order is the whole fix: keyed on req.ip and running second, the limiter was
  // a denial-of-service lever rather than a defence.
  //
  // /reminder is NOT here on purpose: it is an operational trigger, so no caller
  // can produce a provider signature. It carries its own token gate instead.
  for (const route of ["/message", "/status"]) {
    assert.equal(chainFor(route)[0].name, "verifySignature", `${route} verifies first`);
  }
});

test("an unsigned request is refused before the limiter is consulted", async () => {
  provider.signed = false;
  const { reached, res } = await run(chainFor("/message"), fakeReq({ from: "+258840000001" }));

  assert.equal(res.statusCode, 403);
  assert.equal(reached, 1, "the chain stopped at verification, so no budget was spent");
  assert.equal(res.getHeader("ratelimit"), undefined, "the limiter never ran");
});

test("each signed sender gets its own budget, and none of it depends on the address", async () => {
  // The reported scenario: behind the tunnel every request carries the proxy's
  // address, so an IP-keyed limiter let one flood exhaust every citizen's quota.
  // These requests have no address at all, so passing proves the key is the
  // signed sender and nothing else.
  provider.signed = true;
  const limiter = chainFor("/message")[1];
  const LIMIT = 500;

  const flood = fakeReq({ from: "+258840000001" });
  let blocked = null;
  for (let i = 0; i < LIMIT + 1; i += 1) {
    const { res } = await step(limiter, flood);
    if (res.statusCode === 429) { blocked = i; break; }
  }
  assert.equal(blocked, LIMIT, "the flooding sender is cut off at its own limit");

  const bystander = await step(limiter, fakeReq({ from: "+258840000002" }));
  assert.ok(bystander.passed, "a different citizen on the same address is unaffected");
  assert.notEqual(bystander.res.statusCode, 429);
});
