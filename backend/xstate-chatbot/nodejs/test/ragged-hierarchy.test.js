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
  boundaryHierarchyType: "divisao_administrativa",
  rootTenantId: "mz",
  countryCode: "258",
  mobileNumberLength: 9,
  timeouts: { request: 20000, mediaProcessing: 13000, dispatchSettle: 30000 },
  referenceCacheTtlMs: 60000,
  pgrUseCase: {},
});
stub("src/machine/util/localisation-service.js", { getMessageBundleForCode: () => undefined, getLocales: () => [] });

// Routed by which master the request asks for — the two MDMS calls run in parallel.
let masters = {};
const fakeFetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const name = body.MdmsCriteria.moduleDetails[0].masterDetails[0].name;
  return {
    ok: true,
    status: 200,
    json: async () => ({ MdmsRes: { "RAINMAKER-PGR": { [name]: masters[name] ?? [] } } }),
  };
};
require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"),
  filename: require.resolve("node-fetch"),
  loaded: true,
  exports: fakeFetch,
};

const pgrService = require(p("src/machine/service/egov-pgr.js"));

// Each case stubs its own MDMS response; a cached one from the previous
// case would answer instead.
beforeEach(() => pgrService.clearReferenceCache());

// A definition that declares leaves at level 2, and a tree where one branch
// disagrees: LIXO has no children even though it sits at level 1.
function raggedTree() {
  masters = {
    ComplaintHierarchyDefinition: [{
      active: true,
      hierarchyType: "PGR",
      levels: [
        { levelCode: "L1", order: 1, label: "Categoria", isLeafServiceCode: false },
        { levelCode: "L2", order: 2, label: "Subtipo", isLeafServiceCode: true },
      ],
    }],
    ComplaintHierarchy: [
      { code: "SAUDE", parentCode: null, levelCode: "L1", hierarchyType: "PGR", active: true },
      { code: "LIXO",  parentCode: null, levelCode: "L1", hierarchyType: "PGR", active: true },
      { code: "SAUDE_FALTA", parentCode: "SAUDE", levelCode: "L2", hierarchyType: "PGR", active: true },
    ],
  };
}

test("a branch that bottoms out early is marked a leaf, whatever the level declares", async () => {
  // LIXO sits at level 1 with nothing under it, while the definition puts
  // leaves at level 2. Treating it as non-leaf descends into an empty level,
  // and pgr-machine wires onEmpty to system_error — the complaint is lost.
  raggedTree();
  const step = await pgrService.fetchComplaintHierarchyStep("mz", []);

  assert.deepEqual(step.options, ["LIXO", "SAUDE"], "sorted by code");
  assert.equal(step.isLeafLevel, false, "the level default still says level 1 is not a leaf");
  assert.equal(step.leafByCode.LIXO, true, "but LIXO has no children, so it ends here");
});

test("only the disagreeing codes are carried, so a uniform level costs nothing", async () => {
  // leafByCode rides in context, serialised into eg_chat_state_v2 each
  // transition, so it must scale with variation and not with tenant size.
  raggedTree();
  const root = await pgrService.fetchComplaintHierarchyStep("mz", []);
  assert.deepEqual(Object.keys(root.leafByCode), ["LIXO"], "SAUDE agrees with the default, so it is absent");

  const below = await pgrService.fetchComplaintHierarchyStep("mz", ["SAUDE"]);
  assert.equal(below.isLeafLevel, true);
  assert.deepEqual(below.leafByCode, {}, "a uniform leaf level carries no exceptions at all");
});

test("a level whose children all bottom out early is a leaf level outright", async () => {
  masters = {
    ComplaintHierarchyDefinition: [{
      active: true, hierarchyType: "PGR",
      levels: [
        { levelCode: "L1", order: 1, label: "Categoria", isLeafServiceCode: false },
        { levelCode: "L2", order: 2, label: "Subtipo", isLeafServiceCode: true },
      ],
    }],
    ComplaintHierarchy: [
      { code: "LIXO",  parentCode: null, levelCode: "L1", hierarchyType: "PGR", active: true },
      { code: "AGUA",  parentCode: null, levelCode: "L1", hierarchyType: "PGR", active: true },
    ],
  };
  const step = await pgrService.fetchComplaintHierarchyStep("mz", []);

  assert.equal(step.isLeafLevel, true, "nothing hangs off either option");
  assert.deepEqual(step.leafByCode, {}, "so there is no exception to record");
});

test("roots on a level the definition does not declare are not offered", async () => {
  // ke ships CATEGORY -> SUB_TYPE plus ~900 AUTHORITY_TYPE test roots under the same
  // hierarchyType. Offered at the root they made a 1,092-option menu Twilio refused to send.
  raggedTree();
  masters.ComplaintHierarchy.push(
    { code: "PwauthorityTypeA", parentCode: null, levelCode: "AUTHORITY_TYPE", hierarchyType: "PGR", active: true },
  );
  const step = await pgrService.fetchComplaintHierarchyStep("mz", []);

  assert.deepEqual(step.options, ["LIXO", "SAUDE"]);
});

test("REVIEW: an undeclared level under a real root is still walked", async () => {
  // Only roots are filtered. A third level the definition omits is still the real tree:
  // treating LIXO as a leaf would file a category code as the serviceCode.
  raggedTree();
  masters.ComplaintHierarchy.push(
    { code: "LIXO_SECTOR", parentCode: "LIXO", levelCode: "SECTOR", hierarchyType: "PGR", active: true },
  );
  const root = await pgrService.fetchComplaintHierarchyStep("mz", []);
  assert.equal(root.leafByCode.LIXO, undefined, "LIXO follows the level default: not a leaf");

  const under = await pgrService.fetchComplaintHierarchyStep("mz", ["LIXO"]);
  assert.deepEqual(under.options, ["LIXO_SECTOR"]);
});

test("REVIEW: level codes match loosely, and no matching root keeps every root", async (t) => {
  raggedTree();
  for (const row of masters.ComplaintHierarchy) if (row.parentCode == null) row.levelCode = "l_1";
  let step = await pgrService.fetchComplaintHierarchyStep("mz", []);
  assert.deepEqual(step.options, ["LIXO", "SAUDE"], "l_1 matches the declared L1");

  pgrService.clearReferenceCache();
  raggedTree();
  for (const row of masters.ComplaintHierarchy) if (row.parentCode == null) row.levelCode = "SOMETHING_ELSE";
  const warn = t.mock.method(console, "warn", () => {});
  step = await pgrService.fetchComplaintHierarchyStep("mz", []);
  assert.deepEqual(step.options, ["LIXO", "SAUDE"], "rather than an empty menu and SYSTEM_ERROR");
  assert.equal(warn.mock.callCount(), 1);
});

test("without a definition every row is still offered", async () => {
  raggedTree();
  masters.ComplaintHierarchyDefinition = [];
  masters.ComplaintHierarchy.push(
    { code: "AUTH", parentCode: null, levelCode: "AUTHORITY_TYPE", hierarchyType: "PGR", active: true },
  );
  const step = await pgrService.fetchComplaintHierarchyStep("mz", []);

  assert.deepEqual(step.options, ["AUTH", "LIXO", "SAUDE"]);
});
