const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

// Mozambique: 9 digits, Portuguese. The hardcoded copy said 10 and English.
stub("src/env-variables.js", { defaultLocale: "pt_PT", mobileNumberLength: 9 });
stub("src/machine/util/localisation-service.js", { getMessageBundleForCode: () => undefined });

const sent = [];
stub("src/channel/index.js", {
  sendMessageToUser: async (user, messages) => { sent.push({ to: user.mobileNumber, text: messages[0] }); },
});

const { handleError } = require(p("src/session/error-handler.js"));
const { ValidationError, AuthenticationError, ExternalServiceError } =
  require(p("src/session/errors.js"));

const model = (locale) => ({
  user: { mobileNumber: "258840000000", ...(locale ? { locale } : {}) },
  extraInfo: { tenantId: "mz" },
});

async function messageFor(error, locale) {
  sent.length = 0;
  await handleError(error, model(locale));
  return sent[0].text;
}

test("a validation failure names the configured digit count, not ten", async () => {
  const text = await messageFor(new ValidationError("Invalid mobile number format"));

  assert.match(text, /9 dígitos/, "9, from config.mobileNumberLength");
  assert.doesNotMatch(text, /10 digits/);
  assert.doesNotMatch(text, /\{\{digits\}\}/, "the token is filled, not shown");
});

test("the citizen is answered in Portuguese by default, not English", async () => {
  const text = await messageFor(new ValidationError("Invalid mobile number format"));

  assert.match(text, /telemóvel/, "pt_PT, and telemóvel rather than celular");
  assert.doesNotMatch(text, /Sorry/);
});

test("a citizen whose locale is known is answered in it", async () => {
  const text = await messageFor(new ValidationError("Invalid mobile number format"), "en_IN");

  assert.match(text, /9 digits/, "English, and still the configured count");
});

test("each operational failure has its own wording", async () => {
  const auth = await messageFor(new AuthenticationError("token rejected"));
  const upstream = await messageFor(new ExternalServiceError("user/_search 503"));

  assert.match(auth, /verificar a sua conta/);
  assert.match(upstream, /temporariamente indisponível/);
  assert.notEqual(auth, upstream);
});

test("an unexpected error still gets a localized generic message", async () => {
  const text = await messageFor(new TypeError("undefined is not a function"));

  assert.match(text, /ocorreu um erro/, "not the English fallback");
  assert.doesNotMatch(text, /undefined is not a function/, "and never the internal detail");
});
