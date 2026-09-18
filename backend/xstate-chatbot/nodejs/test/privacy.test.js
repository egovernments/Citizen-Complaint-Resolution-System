const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { maskMobile, summarizeInbound } = require(
  path.join(path.resolve(__dirname, ".."), "src/privacy.js")
);

test("a mobile number keeps only enough digits to correlate", () => {
  assert.equal(maskMobile("840000002"), "84*****02");
  assert.equal(maskMobile("258840000002"), "25********02");
  assert.equal(maskMobile("whatsapp:+258840000002"), "25********02", "non-digits are stripped first");
});

test("masking never leaks a short or absent number", () => {
  assert.equal(maskMobile(""), "<none>");
  assert.equal(maskMobile(null), "<none>");
  assert.equal(maskMobile(undefined), "<none>");
  assert.equal(maskMobile("84"), "**");
  assert.equal(maskMobile("8421"), "****");
});

test("a webhook summary names the fields but reveals no content", () => {
  const summary = summarizeInbound({
    From: "whatsapp:+258840000002",
    To: "whatsapp:+258840000001",
    Body: "Faltam medicamentos no hospital",
    NumMedia: "0",
    Latitude: "-25.9",
    Longitude: "32.5",
  });

  assert.match(summary, /"hasBody":true/);
  assert.match(summary, /"hasLocation":true/);
  assert.ok(!summary.includes("Faltam medicamentos"), "the complaint text must not be logged");
  assert.ok(!summary.includes("840000002"), "the full number must not be logged");
  assert.ok(!summary.includes("-25.9"), "coordinates must not be logged");
});

test("media is summarised by type and count, not by url", () => {
  const summary = summarizeInbound({
    From: "258840000002",
    NumMedia: "1",
    MediaContentType0: "image/jpeg",
    MediaUrl0: "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages/MMxxx/Media/MExxx",
  });

  assert.match(summary, /"numMedia":1/);
  assert.match(summary, /"mediaType":"image\/jpeg"/);
  assert.ok(!summary.includes("api.twilio.com"), "the media url must not be logged");
});

test("a junk payload summarises instead of throwing", () => {
  for (const body of [null, undefined, "string", 42, []]) {
    assert.doesNotThrow(() => summarizeInbound(body), String(body));
  }
});
