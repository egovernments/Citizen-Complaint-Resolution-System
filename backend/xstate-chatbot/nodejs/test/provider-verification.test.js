const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);
const channelDir = path.join(projectRoot, "src/channel");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

const SECRET = "s3cret-value-not-in-env";

const config = stub("../env-variables", channelDir, {
  whatsAppProvider: "ValueFirst",
  rootTenantId: "mz",
  countryCode: "258",
  mobileNumberLength: 9,
  webhook: { sharedSecret: SECRET, verify: true },
  valueFirstWhatsAppProvider: {},
  // Kaleyra's constructor builds its send URL eagerly, so these must be present
  // for the module to load at all.
  kaleyra: { sendMessageUrl: "https://kaleyra.example/{{sid}}/messages", sid: "sid-1" },
  twilio: {},
});

const { verifySharedSecret } = require(p("src/channel/shared-secret.js"));

function req({ header, query } = {}) {
  return {
    get: (name) => (name === "X-Webhook-Secret" ? header : undefined),
    query: query ? { webhookSecret: query } : {},
  };
}

test("the configured secret is accepted from the header, and only the header", () => {
  // The query form was dropped: a secret in a url is written into every proxy
  // and ingress access log upstream of this service, where its own redaction
  // cannot reach. A provider that can only be given a url needs its own
  // verifyRequest, not a weaker shared path.
  config.webhook = { sharedSecret: SECRET, verify: true };
  assert.equal(verifySharedSecret(req({ header: SECRET }), "ValueFirst"), true);
  assert.equal(verifySharedSecret(req({ query: SECRET }), "ValueFirst"), false, "query is no longer a way in");
});

test("a wrong, absent or truncated secret is refused", () => {
  config.webhook = { sharedSecret: SECRET, verify: true };
  for (const presented of [undefined, "", "wrong", SECRET.slice(0, -1), SECRET + "x"]) {
    assert.equal(
      verifySharedSecret(req({ header: presented }), "ValueFirst"),
      false,
      `presented: ${String(presented)}`
    );
  }
});

test("an unconfigured secret rejects rather than falls open", () => {
  // The whole point of the finding: a deployment that configured nothing had no
  // check at all. Matches twilio.js, which also returns false when unconfigured.
  config.webhook = { sharedSecret: "", verify: true };
  assert.equal(verifySharedSecret(req({ header: "anything" }), "ValueFirst"), false);
  assert.equal(verifySharedSecret(req(), "ValueFirst"), false);
});

test("verification can be switched off, but only deliberately", () => {
  config.webhook = { sharedSecret: "", verify: false };
  assert.equal(verifySharedSecret(req(), "ValueFirst"), true);
});

test("every provider answers for request authenticity", () => {
  // The route no longer duck-types this: a provider that does not implement it
  // used to mean no check at all, and now means the process will not boot.
  config.webhook = { sharedSecret: SECRET, verify: true };
  for (const name of ["value-first", "kaleyra", "console", "twilio"]) {
    const provider = require(p(`src/channel/${name}.js`));
    assert.equal(typeof provider.verifyRequest, "function", `${name} implements verifyRequest`);
  }
});

test("the console provider is exempt, deliberately and only it", () => {
  config.webhook = { sharedSecret: SECRET, verify: true };
  const consoleProvider = require(p("src/channel/console.js"));
  assert.equal(consoleProvider.verifyRequest(req()), true, "local development stays usable");

  for (const name of ["value-first", "kaleyra"]) {
    const provider = require(p(`src/channel/${name}.js`));
    assert.equal(provider.verifyRequest(req()), false, `${name} rejects an unsigned request`);
    assert.equal(provider.verifyRequest(req({ header: SECRET })), true, `${name} accepts the secret`);
  }
});
