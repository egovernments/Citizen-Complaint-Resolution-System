const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/env-variables.js", {
  egovServices: { egovServicesHost: "https://egov.example/", mdmsSearchPath: "mdms/v1/_search" },
  caseRelatedTo: "IGE",
  rootTenantId: "ke",
  timeouts: { request: 20000 },
  referenceCacheTtlMs: 60000,
  pgrUseCase: {},
});
stub("src/machine/util/localisation-service.js", { getMessageBundleForCode: () => undefined, getLocales: () => [] });

// templates[tenant] = rows; a tenant missing from the map returns MDMS without the module,
// which is what MDMS v1 does for a master with no data. "down" answers 503.
let templates = {};
const asked = [];
const fakeFetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const tenant = body.MdmsCriteria.tenantId;
  asked.push(tenant);
  if (tenant === "down") return { ok: false, status: 503, json: async () => ({}) };
  const rows = templates[tenant];
  return {
    ok: true,
    status: 200,
    json: async () => ({ MdmsRes: rows ? { "RAINMAKER-PGR": { ComplaintTemplateType: rows } } : {} }),
  };
};
require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"), filename: require.resolve("node-fetch"), loaded: true, exports: fakeFetch,
};

const pgrService = require(p("src/machine/service/egov-pgr.js"));
beforeEach(() => { pgrService.clearReferenceCache(); templates = {}; asked.length = 0; });

test("REVIEW: a tenant with the template takes extendedAttributes, one without does not", async () => {
  // One chatbot can serve both: ke (no template) and mz (IGE). A process-wide flag broke one of them.
  templates = { mz: [{ caseRelatedTo: "IGE", active: true }] };
  assert.equal(await pgrService.acceptsExtendedAttributes("mz"), true);
  assert.equal(await pgrService.acceptsExtendedAttributes("ke.bomet"), false, "MDMS without the module means no template");
});

test("REVIEW: a city tenant falls back to its state tenant, as PGR does", async () => {
  templates = { mz: [{ caseRelatedTo: "IGE", active: true }] };
  assert.equal(await pgrService.acceptsExtendedAttributes("mz.maputo"), true);
  assert.deepEqual(asked, ["mz.maputo", "mz"]);
});

test("REVIEW: an MDMS failure is an error, not a silent 'no template'", async () => {
  // Treating a blip as "no" would drop mz's institution and confidentiality without a word.
  await assert.rejects(pgrService.acceptsExtendedAttributes("down"), /503/);
});
