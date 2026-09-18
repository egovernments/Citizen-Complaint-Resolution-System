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

const dispatched = [];

// A provider that behaves like Twilio: the user payload may be in req.query when
// the body is empty, which is exactly what the old direct req.body path dropped.
stub("../../channel", routesDir, {
  extractRawMessage: (req) => (Object.keys(req.body || {}).length ? req.body : req.query),
  isValid: async (body) => Boolean(body && body.From && body.Body !== undefined),
  getFormattedMessageFromUser: async (body, tenantId) => ({
    user: { mobileNumber: String(body.From).replace(/\D/g, "").slice(3) },
    message: { type: "text", input: body.Body },
    extraInfo: { tenantId },
  }),
  verifyRequest: () => true,
});
stub("../../session/session-manager", routesDir, {
  authenticateAndDispatch: async (model) => { dispatched.push(model); },
});
stub("../../machine/service/reminders-service", routesDir, { triggerReminders: async () => {} });
stub("../../env-variables", routesDir, {
  port: 8082, contextPath: "/xstate-chatbot", isSandboxMode: false, rootTenantId: "mz",
});

const router = require(path.join(routesDir, "index.js"));

/** Pull the /status handler out of the router, skipping the rate limiter. */
function statusHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === "/status") {
      const handlers = layer.route.stack.map((s) => s.handle);
      return handlers[handlers.length - 1];
    }
  }
  throw new Error("/status route not found");
}

function fakeRes() {
  const res = { statusCode: null, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; res.ended = true; return res; };
  res.send = (payload) => { res.body = payload; res.ended = true; return res; };
  res.sendStatus = (code) => { res.statusCode = code; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

test("a user message arriving in the query string is dispatched, not dropped", async () => {
  dispatched.length = 0;
  const req = {
    method: "POST",
    originalUrl: "/xstate-chatbot/status",
    body: {},                                        // Twilio sends an empty body here
    query: { From: "whatsapp:+258840000000", To: "whatsapp:+258840000001", Body: "Ola" },
    get: () => undefined,
  };

  await statusHandler()(req, fakeRes());

  assert.equal(dispatched.length, 1, "the query payload reached the session layer");
  assert.equal(dispatched[0].message.input, "Ola");
  assert.equal(dispatched[0].extraInfo.tenantId, "mz", "the parser resolved the tenant");
});

test("a delivery receipt is acknowledged and never dispatched", async () => {
  dispatched.length = 0;
  const req = {
    method: "POST",
    originalUrl: "/xstate-chatbot/status",
    body: { TO: "258840000000", MESSAGE_STATUS: "DELIVERED", MESSAGE_ID: "MM1" },
    query: {},
    get: () => undefined,
  };
  const res = fakeRes();

  await statusHandler()(req, res);

  assert.equal(dispatched.length, 0, "a receipt is not a user message");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: "received", messageId: "MM1" });
});

test("a payload that is neither a receipt nor a valid message is just acknowledged", async () => {
  dispatched.length = 0;
  const req = { method: "POST", originalUrl: "/x/status", body: { Nonsense: "1" }, query: {}, get: () => undefined };
  const res = fakeRes();

  await statusHandler()(req, res);

  assert.equal(dispatched.length, 0);
  assert.equal(res.statusCode, 200, "no retry storm from the provider");
});
