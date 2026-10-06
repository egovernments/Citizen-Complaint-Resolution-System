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

test("leaves non-secret metadata untouched and survives cycles", () => {
  const cyclic = { type: "from_user", locale: "pt_PT" };
  cyclic.self = cyclic;
  const out = redact(cyclic);
  assert.equal(out.type, "from_user");
  assert.equal(out.locale, "pt_PT");
  assert.equal(out.self, undefined);
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("mobile numbers are masked, not published whole", () => {
  // The topic is read and retained downstream, and a number identifies a person
  // who filed a grievance. Masked rather than dropped so two events still correlate.
  const out = redact({
    user: { mobileNumber: "849904390" },
    extraInfo: { whatsAppBusinessNumber: "258840000000" },
    raw: { mobile_number: "849904390", From: "849904390" },
  });

  for (const v of [out.user.mobileNumber, out.extraInfo.whatsAppBusinessNumber,
                   out.raw.mobile_number, out.raw.From]) {
    assert.doesNotMatch(String(v), /849904390|258840000000/, "no whole number survives");
    assert.match(String(v), /\*/, "but something identifiable-enough to correlate remains");
  }
});

test("what the citizen sent is dropped, keeping only its length", () => {
  const complaint = "O buraco na Rua 5 de Junho continua aberto";
  const out = redact({
    message: { type: "text", input: complaint },
    user: { userId: "u-1", name: "Maria", userInfo: { name: "Maria", emailId: "m@x.mz" } },
  });
  assert.equal(out.message.input, `[OMITTED ${complaint.length} chars]`);
  assert.equal(out.message.type, "text", "the message type is kept");
  assert.equal(out.user.userId, "u-1", "the user id is kept for correlation");
  assert.equal(out.user.name, "[OMITTED 5 chars]");
  assert.equal(out.user.userInfo, "[OMITTED]");
  assert.ok(!JSON.stringify(out).includes("Rua 5"));
  assert.ok(!JSON.stringify(out).includes("m@x.mz"));
});

test("coordinates, media links and raw bodies are dropped", () => {
  const out = redact({
    message: { type: "location", input: "(-25.9692,32.5732)" },
    raw: { Body: "ola", MediaUrl0: "https://api.twilio.com/x/Media/ME1", body: { text: "ola" } },
  });
  assert.ok(!JSON.stringify(out).includes("-25.9692"));
  assert.ok(!JSON.stringify(out).includes("api.twilio.com"));
  assert.equal(out.raw.Body, "[OMITTED 3 chars]");
  assert.equal(out.raw.body, "[OMITTED]");
});

test("the bot's replies are dropped too: the review step repeats the complaint", () => {
  const out = redact({ message: { type: "text", output: "Confirme: buraco na Rua 5", locale: "pt_PT" } });
  assert.equal(out.message.output, "[OMITTED 25 chars]");
  assert.equal(out.message.locale, "pt_PT");
});
