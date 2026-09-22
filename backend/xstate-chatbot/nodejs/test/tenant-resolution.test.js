const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/env-variables.js", { rootTenantId: "mz" });

const InboundRequestParser = require(p("src/session/inbound-message-parser.js"));

const provider = { extractRawMessage: () => ({ From: "849904390", Body: "ola" }) };

test("a tenant named in the query is ignored", () => {
  // A caller with a shared secret, or any caller at all on the console
  // provider, could otherwise store an attachment against a tenant of
  // their choosing.
  const parser = InboundRequestParser.create(
    { query: { tenantId: "somewhere.else" } },
    provider
  );

  assert.equal(parser.tenantId, "mz");
});

test("sandbox still sets the tenant from the citizen's registration", () => {
  const parser = InboundRequestParser.create({ query: {} }, provider);
  parser.setTenatId("mz.ige");

  assert.equal(parser.tenantId, "mz.ige");
});
