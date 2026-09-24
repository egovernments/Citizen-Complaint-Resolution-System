const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Pinned before env-variables loads. The shipped defaults are 'hello,hi,ola'
// for reset, so "reiniciar" is not a reset word without .env — see the note on
// the cancel/reset test below.
process.env.CANCEL_WORDS = "cancel,cancelar,cancele,stop";
process.env.RESET_WORDS = "reset,reiniciar,reinicie,restart,ola,oi,hello";

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

require.cache[p("src/machine/util/localisation-service.js")] = {
  id: p("src/machine/util/localisation-service.js"),
  filename: p("src/machine/util/localisation-service.js"),
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined },
};

const InboundMessage = require(p("src/machine/util/inbound-message.js"));

test("every type the channels emit is accepted without throwing", () => {
  for (const type of ["text", "image", "document", "location", "button", "unsupported", "unknown"]) {
    assert.doesNotThrow(() => InboundMessage.create({ type, input: "x" }), `type '${type}' must not throw`);
  }
});

test("a quick-reply button is an ordinary message — it carries the payload", () => {
  const message = InboundMessage.create({ type: "button", input: "2" });
  assert.equal(message.isUnsupported(), false);
  assert.equal(message.getInputMessage(), "2");
});

test("a voice note or sticker is flagged, not fatal", () => {
  const message = InboundMessage.create({ type: "unsupported", input: " " });
  assert.equal(message.isUnsupported(), true);
  assert.equal(message.isUserMessage(), false, "blank input, so the state re-prompts");
});

test("an unrecognized future type degrades to unsupported", () => {
  const message = InboundMessage.create({ type: "contacts", input: " " });
  assert.equal(message.type, "unsupported");
  assert.equal(message.isUnsupported(), true);
});

test("cancel and reset words still work on a text message", () => {
  // These are the words the copy tells citizens to type. They come from config,
  // and the shipped default for RESET_WORDS does not include "reiniciar" — a
  // deployment that sets neither ships a bot whose own instructions do nothing.
  assert.equal(InboundMessage.create({ type: "text", input: "cancelar" }).isCancel(), true);
  assert.equal(InboundMessage.create({ type: "text", input: "reiniciar" }).isReset(), true);
});

test("a non-string media payload does not throw in the text helpers", () => {
  // ConsoleProvider copies message.input through unchanged, so a media payload can
  // be an object or array. dialog.get_input throws on a non-string, and getMessage()
  // runs after the chat-state row is written — so a throw here lost the whole turn.
  for (const input of [{ filestoreId: "abc" }, ["a", "b"], 42, null, undefined]) {
    const message = InboundMessage.create({ type: "image", input });

    assert.doesNotThrow(() => message.isUserMessage(), JSON.stringify(input));
    assert.doesNotThrow(() => message.isGreeting(), JSON.stringify(input));
    assert.doesNotThrow(() => message.isReset(), JSON.stringify(input));
    assert.doesNotThrow(() => message.isCancel(), JSON.stringify(input));
    assert.doesNotThrow(() => message.getInputMessage(), JSON.stringify(input));

    assert.equal(message.isCancel(), false, "media is never a cancel word");
    assert.equal(message.isReset(), false, "media is never a reset word");
  }
});

test("the raw payload stays available for media handling", () => {
  const payload = { filestoreId: "abc-123" };
  const message = InboundMessage.create({ type: "image", input: payload });

  assert.deepEqual(message.rawInput, payload, "the machine reads the raw value for media");
  assert.equal(message.input, "", "the text helpers see an empty string instead");
});
