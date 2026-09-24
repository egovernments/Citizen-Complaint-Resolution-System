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

stub("../env-variables", channelDir, {
  countryCode: "258",
  mobileNumberLength: 9,
  whatsAppBusinessNumber: "258840000001",
  webhook: { sharedSecret: "s", verify: true },
  valueFirstWhatsAppProvider: {
    valueFirstURL: "https://valuefirst.example/send",
    valueFirstTokenURL: "https://valuefirst.example/token",
    valuefirstLoginAuthorizationHeader: "Basic super-secret-credential",
  },
});

// Each test sets the next response (or failure) this returns.
let nextFetch = null;
stub("node-fetch", channelDir, async () => nextFetch());

const provider = require(p("src/channel/value-first.js"));

const jsonResponse = (status, body) => () =>
  Promise.resolve({ status, json: async () => body });

const bodyThatIsNotJson = (status) => () =>
  Promise.resolve({
    status,
    // What an upstream HTML error page does to response.json().
    json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); },
  });

test("a token endpoint returning HTML yields no token instead of throwing", async () => {
  nextFetch = bodyThatIsNotJson(200);
  assert.equal(await provider.generateBearerToken(), undefined);
});

test("a token endpoint returning 200 with no token field yields no token", async () => {
  nextFetch = jsonResponse(200, { notAToken: true });
  assert.equal(await provider.generateBearerToken(), undefined);
});

test("a send whose body is not JSON returns undefined rather than rejecting", async () => {
  // response.json() threw here, and the caller did not await, so the rejection
  // went nowhere Express could see it — unhandledRejection, and Node 23 exits.
  let call = 0;
  nextFetch = () => {
    call += 1;
    return call === 1
      ? jsonResponse(200, { token: "t" })()   // generateBearerToken
      : bodyThatIsNotJson(200)();             // the send itself
  };

  assert.equal(await provider.sendMessage({ SMS: [] }), undefined);
});

test("a MESSAGEACK with no Err is returned untouched", async () => {
  let call = 0;
  nextFetch = () => {
    call += 1;
    return call === 1
      ? jsonResponse(200, { token: "t" })()
      : jsonResponse(200, { MESSAGEACK: { GUID: "g-1" } })();
  };

  const result = await provider.sendMessage({ SMS: [] });
  assert.deepEqual(result, { MESSAGEACK: { GUID: "g-1" } });
});

test("sendMessageToUser awaits the send, so a transport error is catchable", async () => {
  // The transform is not what is under test here; the await is.
  provider.getTransformedResponse = async () => ({ SMS: [] });
  nextFetch = () => Promise.reject(new Error("ECONNRESET"));

  await assert.rejects(
    () => provider.sendMessageToUser({ mobileNumber: "840000001" }, ["ola"], {}),
    /ECONNRESET/,
    "unawaited, this resolved and the rejection escaped to the process"
  );
});
