const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

/** A deployment with everything set, which each case then breaks one way. */
function config(overrides = {}) {
  const base = {
    whatsAppProvider: "Twilio",
    serviceAccount: { username: "svc", password: "pw", tenantId: "mz" },
    twilio: { accountSid: "AC1", authToken: "tok", webhookBaseUrl: "https://x.example", verifyWebhookSignature: true },
    webhook: { sharedSecret: "s3cret", verify: true },
    countryExplicitlySet: true,
  };
  return { ...base, ...overrides };
}

function missingWith(cfg) {
  stub("src/env-variables.js", cfg);
  delete require.cache[p("src/startup-checks.js")];
  return require(p("src/startup-checks.js")).missingConfig();
}

test("a fully configured Twilio deployment starts", () => {
  assert.deepEqual(missingWith(config()), []);
});

test("the service account is required whatever the channel", () => {
  // It defaults to empty strings, so loginServiceAccount posted blank
  // credentials to OAuth and failed on the first citizen instead of at boot.
  const cfg = config();
  cfg.serviceAccount = { username: "", password: "" };
  assert.deepEqual(missingWith(cfg), ["USER_SERVICE_ACCOUNT_USERNAME", "USER_SERVICE_ACCOUNT_PASSWORD"]);

  const onConsole = config({ whatsAppProvider: "console" });
  onConsole.serviceAccount = { username: "", password: "" };
  assert.deepEqual(missingWith(onConsole), ["USER_SERVICE_ACCOUNT_USERNAME", "USER_SERVICE_ACCOUNT_PASSWORD"]);
});

test("Twilio credentials are required, and the base url only when verifying", () => {
  const cfg = config();
  cfg.twilio = { accountSid: "", authToken: "", webhookBaseUrl: "", verifyWebhookSignature: true };
  assert.deepEqual(missingWith(cfg), ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WEBHOOK_BASE_URL"]);

  // Verification off is a deliberate local-testing choice; the url is then unused.
  const unverified = config();
  unverified.twilio = { accountSid: "AC1", authToken: "tok", webhookBaseUrl: "", verifyWebhookSignature: false };
  assert.deepEqual(missingWith(unverified), []);
});

test("the console provider needs no channel credentials", () => {
  const cfg = config({ whatsAppProvider: "console" });
  cfg.twilio = { accountSid: "", authToken: "", webhookBaseUrl: "", verifyWebhookSignature: true };
  assert.deepEqual(missingWith(cfg), [], "local development stays runnable");
});

test("ValueFirst and Kaleyra need the shared secret they verify against", () => {
  for (const provider of ["ValueFirst", "Kaleyra"]) {
    const cfg = config({ whatsAppProvider: provider });
    cfg.webhook = { sharedSecret: "", verify: true };
    assert.deepEqual(missingWith(cfg), ["WEBHOOK_SHARED_SECRET"], provider);

    // Without it they reject every webhook — an outage that looks like silence.
    const off = config({ whatsAppProvider: provider });
    off.webhook = { sharedSecret: "", verify: false };
    assert.deepEqual(missingWith(off), [], `${provider} with verification off`);
  }
});

test("the env-path providers must set the country explicitly", () => {
  // ValueFirst and Kaleyra convert numbers from COUNTRY_CODE, which defaults to
  // India's 91, while the rest of the service reads the tenant's MDMS rule.
  // Defaulting silently disagrees with a tenant seeded +258.
  for (const provider of ["ValueFirst", "Kaleyra"]) {
    const cfg = config({ whatsAppProvider: provider });
    cfg.countryExplicitlySet = false;
    assert.deepEqual(missingWith(cfg), ["COUNTRY_CODE", "MOBILE_NUMBER_LENGTH"], provider);
  }

  // Twilio reads MDMS, so it is not asked.
  const twilio = config();
  twilio.countryExplicitlySet = false;
  assert.deepEqual(missingWith(twilio), []);
});

test("Twilio settings are not demanded of a ValueFirst deployment", () => {
  const cfg = config({ whatsAppProvider: "ValueFirst" });
  cfg.twilio = { accountSid: "", authToken: "", webhookBaseUrl: "", verifyWebhookSignature: true };
  assert.deepEqual(missingWith(cfg), []);
});
