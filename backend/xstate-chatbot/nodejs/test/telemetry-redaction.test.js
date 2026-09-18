const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const kafkaProducerPath = path.join(projectRoot, "src/session/kafka/kafka-producer.js");

// Stub the producer: requiring telemetry must not open a Kafka connection.
require.cache[kafkaProducerPath] = {
  id: kafkaProducerPath,
  filename: kafkaProducerPath,
  loaded: true,
  exports: { send: () => {} },
};

const telemetry = require(path.join(projectRoot, "src/session/telemetry.js"));
const redact = telemetry.redactSecrets;

test("strips the service-account token from an inbound model", () => {
  const model = {
    user: { userId: "u-1", locale: "pt_PT", mobileNumber: "258840000000", authToken: "live-token" },
    extraInfo: { whatsAppBusinessNumber: "258840000001" },
  };
  const out = redact(model);
  assert.equal(out.user.authToken, "[REDACTED]");
  assert.equal(out.user.userId, "u-1");
  assert.equal(out.user.locale, "pt_PT");
  assert.ok(!JSON.stringify(out).includes("live-token"));
});

test("strips credentials at any depth and in arrays", () => {
  const out = redact({
    a: { b: { access_token: "t1", password: "p" } },
    list: [{ authToken: "t2" }, { refresh_token: "t3" }],
  });
  assert.equal(out.a.b.access_token, "[REDACTED]");
  assert.equal(out.a.b.password, "[REDACTED]");
  assert.equal(out.list[0].authToken, "[REDACTED]");
  assert.equal(out.list[1].refresh_token, "[REDACTED]");
});

test("leaves non-secret payloads untouched and survives cycles", () => {
  const cyclic = { type: "from_user", body: "Ola" };
  cyclic.self = cyclic;
  const out = redact(cyclic);
  assert.equal(out.type, "from_user");
  assert.equal(out.body, "Ola");
  assert.equal(out.self, undefined);
  assert.doesNotThrow(() => JSON.stringify(out));
});
