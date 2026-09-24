const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

process.env.MEDIA_PROCESSING_TIMEOUT_MS = "30";

const twilio = require(p("src/channel/twilio.js"));

const ACCOUNT = "AC" + "0".repeat(32);
const MESSAGE = "MM" + "1".repeat(32);
const MEDIA = "ME" + "2".repeat(32);
const MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}`;

test("a slow download is cancelled, and the citizen is not left waiting", async () => {
  // The old code raced a timeout promise but never cancelled the work: the
  // download kept its socket and the account credentials in flight, and could
  // still upload minutes after the turn ended.
  let cancelObserved = false;
  let uploaded = false;

  twilio.downloadMediaFromUrl = (url, cancelToken) =>
    new Promise((_, reject) => {
      // honour the token the way axios does
      cancelToken.promise.then((cancel) => {
        cancelObserved = true;
        const error = new Error(cancel.message);
        error.__CANCEL__ = true;   // what axios.isCancel checks
        reject(error);
      });
    });
  twilio.uploadMediaToFileStore = async () => { uploaded = true; return "filestore-id"; };

  const started = Date.now();
  const result = await twilio.processMediaInput({ MediaUrl0: MEDIA_URL }, "mz");
  const elapsed = Date.now() - started;

  assert.equal(result, " ", "the attachment step gets a blank input, not a hang");
  assert.equal(cancelObserved, true, "the download was told to stop");
  assert.equal(uploaded, false, "and nothing was uploaded afterwards");
  assert.ok(elapsed < 1000, `returned promptly (${elapsed}ms)`);
});

test("a download that finishes in time still uploads", async () => {
  twilio.downloadMediaFromUrl = async () => ({
    headers: { "content-type": "image/jpeg" },
    data: Buffer.from("jpeg-bytes"),
  });
  let uploadedName = null;
  twilio.uploadMediaToFileStore = async (fileName) => { uploadedName = fileName; return "filestore-id"; };

  const result = await twilio.processMediaInput({ MediaUrl0: MEDIA_URL, MediaContentType0: "image/jpeg" }, "mz");

  assert.equal(result, "filestore-id");
  assert.match(uploadedName, /^pgr-whatsapp-\d+\.jpg$/, "named from the content type");
});

test("an oversized attachment is reported, not uploaded", async () => {
  twilio.downloadMediaFromUrl = async () => ({
    headers: { "content-type": "image/jpeg" },
    data: Buffer.alloc(50 * 1024 * 1024),
  });
  let uploaded = false;
  twilio.uploadMediaToFileStore = async () => { uploaded = true; return "filestore-id"; };

  const result = await twilio.processMediaInput({ MediaUrl0: MEDIA_URL }, "mz");

  assert.equal(result, "FILE_TOO_LARGE");
  assert.equal(uploaded, false);
});

test("no media url means no work at all", async () => {
  let called = false;
  twilio.downloadMediaFromUrl = async () => { called = true; };

  assert.equal(await twilio.processMediaInput({}, "mz"), " ");
  assert.equal(called, false);
});
