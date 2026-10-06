const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
require.cache[envPath] = { id: envPath, filename: envPath, loaded: true, exports: { rootTenantId: "mz" } };

const provider = require(path.join(projectRoot, "src/channel/console.js"));

test("a message without extraInfo is formatted instead of throwing", () => {
  const raw = { message: { type: "text", input: "ola" }, user: { mobileNumber: "840000000" } };
  assert.equal(provider.isValid(raw), true);

  const model = provider.getFormattedMessageFromUser(raw);
  assert.deepEqual(model.message, { type: "text", input: "ola" });
  assert.equal(model.extraInfo.whatsAppBusinessNumber, undefined);
  assert.equal(model.extraInfo.tenantId, "mz");
});
