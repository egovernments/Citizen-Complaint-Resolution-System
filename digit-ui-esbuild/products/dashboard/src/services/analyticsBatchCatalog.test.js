// Regression contract for #1758. Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/analyticsBatchCatalog.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry, name) {
  const outfile = path.join(os.tmpdir(), `${name}.cjs.${process.pid}.js`);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    outfile,
  });
  return outfile;
}

const queryPlanOut = bundle(path.join(__dirname, "../utils/queryPlan.js"), "queryPlan-budget");
const batchOut = bundle(path.join(__dirname, "analyticsBatch.js"), "analyticsBatch-budget");
process.on("exit", () => {
  for (const outfile of [queryPlanOut, batchOut]) {
    try {
      fs.unlinkSync(outfile);
    } catch (e) {
      /* already gone */
    }
  }
});

const { buildRefs } = require(queryPlanOut);
const { chunkQueryRefs, DEFAULT_MAX_BATCH_QUERIES } = require(batchOut);

const CATALOG = path.resolve(
  __dirname,
  "../../../../../ansible/nairobi-mdms/mdms/dss/KpiDefinition.json"
);

// The capabilities a PGR_ADMIN holds per the ACCESSCONTROL-ROLEACTIONS seed (#1050): the base
// analytics grant plus officer identity, and deliberately NOT the report-viewer capabilities.
// The catalog is gated by requiredActionUrl now, so this is the whole persona.
const PGR_ADMIN_CAPABILITIES = new Set([
  "/pgr-services/v2/analytics/_query",
  "/pgr-services/v2/analytics/capabilities/officer",
]);

function reachableByPgrAdmin(def) {
  if (def.status !== "published" || def.viz?.internal === true) return false;
  return PGR_ADMIN_CAPABILITIES.has(def.requiredActionUrl);
}

test("the canonical PGR_ADMIN add-all plan is chunked without losing any companion ref", () => {
  const definitions = JSON.parse(fs.readFileSync(CATALOG, "utf8"))
    .map((record) => record.data || record)
    .filter(reachableByPgrAdmin);
  const kpis = Object.fromEntries(definitions.map((def) => [def.id, { ...def, kpiId: def.id }]));
  const tiles = definitions.map((def) => ({ kpiId: def.id }));
  const refs = buildRefs(tiles, kpis, {}, {});
  const chunks = chunkQueryRefs(refs, DEFAULT_MAX_BATCH_QUERIES);

  assert.equal(definitions.length, 28);
  assert.equal(Object.keys(refs).length, 51, "this is the production #1758 trigger");
  assert.deepEqual(chunks.map((chunk) => Object.keys(chunk).length), [50, 1]);
  assert.deepEqual(chunks.flatMap((chunk) => Object.keys(chunk)), Object.keys(refs));
});
