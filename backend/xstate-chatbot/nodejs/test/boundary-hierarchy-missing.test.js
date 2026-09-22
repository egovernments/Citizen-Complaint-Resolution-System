const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function stub(rel, exports) {
  const filename = p(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/env-variables.js", {
  egovServices: { egovServicesHost: "https://egov.example/" },
  boundaryHierarchyType: "divisao_administrativa",
  rootTenantId: "mz",
  countryCode: "258",
  mobileNumberLength: 9,
  timeouts: { request: 20000, mediaProcessing: 13000, dispatchSettle: 30000 },
  pgrUseCase: {},
});
stub("src/machine/util/localisation-service.js", { getMessageBundleForCode: () => undefined, getLocales: () => [] });

let nextResponse = null;
stub("node_modules/node-fetch/lib/index.js", async () => nextResponse());
require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"),
  filename: require.resolve("node-fetch"),
  loaded: true,
  exports: async () => nextResponse(),
};

const pgrService = require(p("src/machine/service/egov-pgr.js"));
const { ExternalServiceError } = require(p("src/session/errors.js"));

const respond = (body, ok = true, status = 200) => () =>
  Promise.resolve({ ok, status, json: async () => body });

test("a hierarchy type that is not registered fails instead of returning an empty step", async () => {
  // fetchBoundaryStep used to return { options: [], isLeafLevel: true }. WalkState
  // reads that as "this level is empty", takes onEmpty, writes undefined into
  // slots.pgr.locality and files the complaint with no location at all.
  nextResponse = respond({ BoundaryHierarchy: [{ hierarchyType: "SOMETHING_ELSE", boundaryHierarchy: [] }] });

  await assert.rejects(
    () => pgrService.fetchBoundaryStep("mz", []),
    (error) =>
      error instanceof ExternalServiceError &&
      /divisao_administrativa/.test(error.message) &&
      /mz/.test(error.message),
    "names the hierarchy it looked for and the tenant"
  );
});

test("an empty hierarchy list fails the same way", async () => {
  nextResponse = respond({ BoundaryHierarchy: [] });
  await assert.rejects(() => pgrService.fetchBoundaryStep("mz", []), ExternalServiceError);
});

test("a non-OK boundary response still throws rather than yielding an empty level", async () => {
  nextResponse = respond({}, false, 500);
  await assert.rejects(() => pgrService.fetchBoundaryStep("mz", []), /Boundary hierarchy fetch failed with status 500/);
});

test("a registered hierarchy resolves normally", async () => {
  let call = 0;
  nextResponse = () => {
    call += 1;
    return call === 1
      ? respond({
          BoundaryHierarchy: [{
            hierarchyType: "divisao_administrativa",
            boundaryHierarchy: [{ boundaryType: "Provincia", parentBoundaryType: null }],
          }],
        })()
      : respond({ TenantBoundary: [{ boundary: [{ code: "maputo_cidade", boundaryType: "Provincia", children: [] }] }] })();
  };

  const step = await pgrService.fetchBoundaryStep("mz", []);
  assert.deepEqual(step.options, ["maputo_cidade"]);
  assert.equal(step.levelLabel, "Provincia");
});
