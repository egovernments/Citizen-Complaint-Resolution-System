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
  rootTenantId: "mz",
  whatsAppBusinessNumber: "258840000001",
  webhook: { sharedSecret: "s", verify: true },
  valueFirstWhatsAppProvider: {},
});
stub("node-fetch", channelDir, async () => { throw new Error("no network in tests"); });
stub("../phone-numbers", channelDir, {
  toNationalNumber: async (value) => String(value ?? "").replace(/\D/g, ""),
  toInternationalNumber: async (value) => String(value ?? "").replace(/\D/g, ""),
});

const provider = require(p("src/channel/value-first.js"));

test("a button reply with a real label is a valid message", async () => {
  assert.equal(await provider.isValid({ media_type: "button", buttonLabel: "Submeter" }), true);
});

test("the button label reaches the flow as input", async () => {
  const model = await provider.getUserMessage({ media_type: "button", buttonLabel: "Submeter", TO: "258840000002" });
  assert.deepEqual(model.message, { input: "Submeter", type: "button" });
});

test("a button with no label, or the unfilled placeholder, is discarded", async () => {
  assert.equal(await provider.isValid({ media_type: "button" }), false);
  assert.equal(await provider.isValid({ media_type: "button", buttonLabel: "$btnLabel" }), false);
});
