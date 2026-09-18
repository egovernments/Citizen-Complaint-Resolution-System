const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

const mediaTypes = require(p("src/media-types.js"));
const twilio = require(p("src/channel/twilio.js"));

test("declared content types match what egov-filestore accepts", () => {
  // Not the standard MIME types: filestore validates the DECLARED type against a
  // per-extension allowlist and rejects the standard ones for these two.
  assert.equal(mediaTypes.filestoreContentType("complaint.docx"), "application/x-tika-ooxml");
  assert.equal(mediaTypes.filestoreContentType("list.csv"), "text/plain");

  assert.equal(mediaTypes.filestoreContentType("photo.jpg"), "image/jpg");
  assert.equal(mediaTypes.filestoreContentType("scan.PDF"), "application/pdf", "extension match is case-insensitive");
  assert.equal(mediaTypes.filestoreContentType("note.webp"), undefined, "stickers are not uploadable");
  assert.equal(mediaTypes.filestoreContentType("noextension"), undefined);
});

test("a supported mime type round-trips to an extension", () => {
  assert.equal(mediaTypes.extensionForMimeType("image/jpeg"), ".jpg");
  assert.equal(mediaTypes.extensionForMimeType("application/pdf; charset=binary"), ".pdf");
  assert.equal(mediaTypes.isSupportedMimeType("image/webp"), false);
  assert.equal(mediaTypes.isSupportedMimeType("application/pdf"), true);
});

test("the live fileStoreAPICall is the normalizing one", () => {
  // The class carried two definitions of this method; the later, non-normalizing
  // one silently won, so .docx/.csv uploads kept failing. Pinning the live
  // implementation catches a re-introduced duplicate.
  const source = Object.getPrototypeOf(twilio).fileStoreAPICall.toString();
  assert.match(source, /filestoreContentType/, "the upload must declare the filestore-accepted type");
});
