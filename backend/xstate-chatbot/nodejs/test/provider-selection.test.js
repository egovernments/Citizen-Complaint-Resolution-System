const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function selectWith(value) {
  process.env.WHATSAPP_PROVIDER = value;
  for (const key of Object.keys(require.cache)) delete require.cache[key];
  return require(path.join(projectRoot, "src/channel/index.js"));
}

test("a typo does not silently select the unverified console provider", () => {
  // console's verifyRequest returns true for everything, so falling through to
  // it means a public webhook accepting unauthenticated messages.
  assert.throws(() => selectWith("Twilo"), /Unknown WHATSAPP_PROVIDER 'Twilo'/);
  assert.throws(() => selectWith("valuefrst"), /Unknown WHATSAPP_PROVIDER/);
});

test("the provider name is matched however it is capitalised", () => {
  // .env.example documents Twilio/Kaleyra/ValueFirst, console-repl.js says Console.
  for (const spelling of ["Console", "console", "CONSOLE"]) {
    assert.equal(typeof selectWith(spelling).verifyRequest, "function", spelling);
  }
  assert.equal(typeof selectWith("twilio").verifyRequest, "function");
});

test("every selectable provider answers for request authenticity", () => {
  for (const name of ["Twilio", "Kaleyra", "ValueFirst", "Console"]) {
    assert.equal(typeof selectWith(name).verifyRequest, "function", name);
  }
});
