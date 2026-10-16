const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const twilioPath = path.join(projectRoot, "src/channel/twilio.js");
const mobilePath = path.join(projectRoot, "src/machine/service/mobile-validation-service.js");

function loadProvider(whatsappNumber) {
  delete require.cache[twilioPath];
  delete require.cache[mobilePath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: {
      rootTenantId: "pg",
      twilio: { accountSid: "AC", authToken: "tok", whatsappNumber, baseUrl: "" },
      mobileValidation: { defaultCountryCode: "+91", defaultRegex: "^[0-9]{10}$", cacheTtlMs: 1000 },
      egovServices: { egovServicesHost: "http://localhost/", mdmsV2SearchPath: "mdms-v2/v2/_search" },
    },
  };
  return require(twilioPath);
}

test("REGRESSION #7: the repo-wide whatsapp:-prefixed sender is not double-prefixed", () => {
  // twilio_whatsapp_from is documented as "whatsapp:+14155238886" in every host_vars
  // example and in the Novu bootstrap default. Re-prefixing produced
  // From=whatsapp:+whatsapp:+14155238886, which Twilio rejects -- the webhook validated,
  // the dialog ran, and the citizen never got a reply.
  assert.equal(loadProvider("whatsapp:+14155238886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #7: an unprefixed sender still works", () => {
  assert.equal(loadProvider("+14155238886").senderAddress(), "whatsapp:+14155238886");
  assert.equal(loadProvider("14155238886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #7: mixed case and stray formatting are normalised", () => {
  assert.equal(loadProvider("WhatsApp:+1 (415) 523-8886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #6/#7: an unset sender fails loudly instead of using the eGov demo number", () => {
  // Previously this silently became +919880900990, so a misconfigured deployment sent
  // as someone else's number rather than failing.
  for (const blank of ["", "   ", undefined]) {
    assert.throws(() => loadProvider(blank).senderAddress(), /TWILIO_WHATSAPP_NUMBER is not set/);
  }
});

test("REGRESSION: replies go to the address the citizen wrote from, not a re-prefixed national number", async (t) => {
  const provider = loadProvider("whatsapp:+14155238886");
  // ke's first row: +254, whose regex also admits 10-digit Indian numbers.
  // t.mock.method restores the shared singleton when the test ends.
  const mobile = require(mobilePath);
  t.mock.method(mobile, "getConfig", async () => ({ countryCode: "+254", mobileNumberRegex: "^(0?[17][0-9]{8}|[6-9][0-9]{9})$" }));
  const sent = [];
  provider.sendTwilioRequest = async (params) => sent.push(params.get("To"));

  const citizen = { mobileNumber: "6307817430", whatsAppAddress: "whatsapp:+916307817430" };
  await provider.sendMessageToUser(citizen, ["hello"], { tenantId: "ke" });
  // Previously the national number was re-prefixed with the tenant default: +2546307817430.
  assert.deepEqual(sent, ["whatsapp:+916307817430"]);

  // Without a captured address the old national-number path is unchanged.
  sent.length = 0;
  await provider.sendMessageToUser({ mobileNumber: "712345678" }, ["hello"], { tenantId: "ke" });
  assert.deepEqual(sent, ["whatsapp:+254712345678"]);
});

test("REGRESSION: a body over 1600 characters is split at line breaks, not rejected", async () => {
  // Twilio answers an over-long body with 21617 and delivers nothing, so the citizen's
  // conversation stalled silently.
  const provider = loadProvider("whatsapp:+14155238886");
  provider.toWhatsAppAddress = async () => "whatsapp:+916307817430";
  provider.chunkDelayMs = 0;
  const bodies = [];
  provider.sendTwilioRequest = async (params) => { bodies.push(params.get("Body")); return { sid: "SM" + bodies.length }; };

  const lines = Array.from({ length: 100 }, (_, i) => `*${i + 1}.* complaints.categories.Option${i + 1}`);
  await provider.sendTextMessage("6307817430", lines.join("\n"), "ke");

  assert.ok(bodies.length > 1, "it went out as more than one message");
  for (const body of bodies) assert.ok(body.length <= 1600, `a chunk is ${body.length} characters`);
  assert.equal(bodies.join("\n"), lines.join("\n"), "nothing lost, nothing reordered, no line cut in half");

  // A short body is still a single request, and a single line longer than the limit is hard-split.
  bodies.length = 0;
  await provider.sendTextMessage("6307817430", "hello", "ke");
  assert.deepEqual(bodies, ["hello"]);
  assert.deepEqual(provider.splitBody("x".repeat(3500)).map((c) => c.length), [1600, 1600, 300]);
});

test("REVIEW: a body within the limit goes out untouched, leading blank line included", () => {
  const provider = loadProvider("whatsapp:+14155238886");
  // List prompts start with "\n*1.*"; trimming it changed every existing message.
  assert.deepEqual(provider.splitBody("\n*1.*  Garbage\n*2.*  Water"), ["\n*1.*  Garbage\n*2.*  Water"]);
});

test("REVIEW: a failed part stops the rest and the send reports failure", async () => {
  const provider = loadProvider("whatsapp:+14155238886");
  provider.toWhatsAppAddress = async () => "whatsapp:+916307817430";
  provider.chunkDelayMs = 0;
  const sent = [];
  // Part 1 fails (rate limit / 5xx): sendTwilioRequest returns undefined.
  provider.sendTwilioRequest = async (params) => { sent.push(params.get("Body")); return undefined; };
  const lines = Array.from({ length: 100 }, (_, i) => `*${i + 1}.* complaints.categories.Option${i + 1}`);

  const result = await provider.sendTextMessage("6307817430", lines.join("\n"), "ke");
  assert.equal(sent.length, 2, "part 1 is retried once, and the rest is not sent");
  assert.equal(sent[0], sent[1]);
  assert.equal(result, undefined);
});

test("REVIEW: a hard split cuts at whitespace and never inside an emoji", () => {
  const provider = loadProvider("whatsapp:+14155238886");
  const words = provider.splitBody("word ".repeat(400).trim(), 1600);
  for (const chunk of words) assert.match(chunk, /^(word )*word$/, "no word cut in half");

  // An emoji whose surrogate pair straddles the limit moves whole to the next part.
  const emoji = "x".repeat(1599) + "\u{1F449}" + "y";
  const parts = provider.splitBody(emoji, 1600);
  assert.deepEqual(parts.map((p) => p.length), [1599, 3]);
  assert.equal(parts[1].codePointAt(0), 0x1F449);
});

test("REVIEW: parts of a split body are spaced out to keep their order", async () => {
  const provider = loadProvider("whatsapp:+14155238886");
  provider.toWhatsAppAddress = async () => "whatsapp:+916307817430";
  provider.chunkDelayMs = 30;
  const at = [];
  provider.sendTwilioRequest = async () => { at.push(Date.now()); return { sid: "SM" }; };
  await provider.sendTextMessage("6307817430", "a\n".repeat(1000) + "b".repeat(1000), "ke");
  assert.ok(at.length >= 2);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 25, `gap ${at[i] - at[i - 1]}ms`);
});

test("REVIEW: when a later part fails twice the citizen is told how to recover", async () => {
  // Part 1 arrived, part 2 did not: without a word the citizen waits on options never shown.
  const provider = loadProvider("whatsapp:+14155238886");
  provider.toWhatsAppAddress = async () => "whatsapp:+916307817430";
  provider.chunkDelayMs = 0;
  const sent = [];
  provider.sendTwilioRequest = async (params) => { sent.push(params.get("Body")); return sent.length === 1 ? { sid: "SM1" } : undefined; };
  const lines = Array.from({ length: 100 }, (_, i) => `*${i + 1}.* complaints.categories.Option${i + 1}`);

  const result = await provider.sendTextMessage("6307817430", lines.join("\n"), "mz", "pt_PT");
  assert.equal(result, undefined);
  assert.equal(sent.length, 4, "part 1, part 2 and its retry, then the notice");
  assert.match(sent[3], /Envie \*olá\* para recomeçar/);
});

test("REVIEW: a later part never opens on a blank line", () => {
  const provider = loadProvider("whatsapp:+14155238886");
  // Part 1 is exactly full, so the blank separator line after it starts part 2.
  const body = "a".repeat(1600) + "\n\n" + "*12.* next option";
  const parts = provider.splitBody(body, 1600);
  assert.equal(parts.length, 2);
  assert.equal(parts[1], "*12.* next option");
});
