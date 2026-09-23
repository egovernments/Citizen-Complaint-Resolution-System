const test = require("node:test");
const assert = require("node:assert/strict");
const { redactUrl } = require("../src/privacy");

test("no query value survives into a log line, whatever it is", () => {
  // The shared secret is header-only now, but a provider can still put
  // anything in the query, so every value goes rather than a named list.
  const url = "/xstate-chatbot/message?token=s3cret-live-value&From=849904390";
  const redacted = redactUrl(url);

  assert.doesNotMatch(redacted, /s3cret-live-value/, "the value is gone");
  assert.match(redacted, /token=<redacted>/, "but we can still see it was presented");
  assert.match(redacted, /^\/xstate-chatbot\/message\?/, "the path is untouched");
});

test("the citizen's number is not logged either, even as a query value", () => {
  assert.doesNotMatch(redactUrl("/message?From=849904390"), /849904390/);
});

test("a url with no query is returned unchanged", () => {
  assert.equal(redactUrl("/xstate-chatbot/message"), "/xstate-chatbot/message");
});

test("nothing throws on the shapes express can hand us", () => {
  assert.equal(redactUrl(undefined), "");
  assert.equal(redactUrl(""), "");
  assert.equal(redactUrl("/message?"), "/message");
});
