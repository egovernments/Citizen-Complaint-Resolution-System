// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/analyticsBatch.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "analyticsBatch.js");
const OUT = path.join(os.tmpdir(), `analyticsBatch.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

const {
  DEFAULT_MAX_BATCH_QUERIES,
  chunkQueryRefs,
  runChunkedAnalyticsBatch,
  normalizeAnalyticsBatch,
  errorForTile,
} = require(OUT);

function refs(count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`q${index}`, { kpiId: `kpi${index}` }])
  );
}

test("the 51-entry regression is split at the backend's 50-entry budget", () => {
  const chunks = chunkQueryRefs(refs(51), DEFAULT_MAX_BATCH_QUERIES);

  assert.deepEqual(chunks.map((chunk) => Object.keys(chunk).length), [50, 1]);
  assert.deepEqual(chunks.flatMap((chunk) => Object.keys(chunk)), Object.keys(refs(51)));
});

test("invalid or missing advertised limits fall back to 50", () => {
  for (const limit of [undefined, null, 0, -1, NaN, "not-a-number"]) {
    assert.deepEqual(chunkQueryRefs(refs(51), limit).map((chunk) => Object.keys(chunk).length), [50, 1]);
  }
  assert.deepEqual(chunkQueryRefs(refs(51), 25).map((chunk) => Object.keys(chunk).length), [25, 25, 1]);
});

test("chunks execute sequentially and merge every result exactly once", async () => {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const result = await runChunkedAnalyticsBatch(refs(51), 50, async (chunk) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(Object.keys(chunk));
    await Promise.resolve();
    inFlight -= 1;
    return {
      results: Object.fromEntries(Object.keys(chunk).map((key) => [key, { rows: [{ total: 1 }] }])),
      partial: false,
      asOf: calls.length === 1 ? 200 : 100,
      calendar: { timeZone: "Africa/Nairobi" },
      scope: { level: "tenant" },
    };
  });

  assert.equal(maxInFlight, 1);
  assert.deepEqual(calls.map((keys) => keys.length), [50, 1]);
  assert.deepEqual(Object.keys(result.results), Object.keys(refs(51)));
  assert.equal(result.asOf, 100, "the merged freshness stamp must not overstate the older chunk");
  assert.deepEqual(result.calendar, { timeZone: "Africa/Nairobi" });
  assert.deepEqual(result.scope, { level: "tenant" });
  assert.equal(result.partial, false);
  assert.equal(result.errors, null);
  assert.equal(result.roundTrips, 2);
});

test("one failed chunk retains successful tile data and marks only failed refs", async () => {
  let call = 0;
  const result = await runChunkedAnalyticsBatch(refs(51), 50, async (chunk) => {
    call += 1;
    if (call === 2) {
      const error = new Error("Analytics request failed (503)");
      error.payload = { message: "analytics temporarily unavailable" };
      throw error;
    }
    return {
      results: Object.fromEntries(Object.keys(chunk).map((key) => [key, { rows: [] }])),
      partial: false,
    };
  });

  assert.equal(Object.keys(result.results).length, 50);
  assert.deepEqual(result.errors.q50, {
    code: "batch_failed",
    message: "analytics temporarily unavailable",
  });
  assert.equal(result.errors.q49, undefined);
  assert.equal(result.partial, true);
});

test("all failed chunks preserve the existing global failure path", async () => {
  await assert.rejects(
    runChunkedAnalyticsBatch(refs(51), 50, async () => {
      throw new Error("offline");
    }),
    /offline/
  );
});

test("an empty ref map still performs one request for freshness metadata", async () => {
  const calls = [];
  const result = await runChunkedAnalyticsBatch({}, 50, async (chunk) => {
    calls.push(chunk);
    return { results: {}, asOf: 123, calendar: { timeZone: "Africa/Nairobi" } };
  });

  assert.deepEqual(calls, [{}]);
  assert.equal(result.asOf, 123);
  assert.deepEqual(result.calendar, { timeZone: "Africa/Nairobi" });
  assert.equal(result.roundTrips, 1);
});

test("a superseded generation never starts its next sequential chunk", async () => {
  let current = true;
  let calls = 0;
  await assert.rejects(
    runChunkedAnalyticsBatch(
      refs(51),
      50,
      async () => {
        calls += 1;
        current = false;
        return { results: {} };
      },
      { shouldContinue: () => current }
    ),
    { name: "AbortError" }
  );
  assert.equal(calls, 1);
});

test("legacy inline errors become canonical without disturbing successful results", () => {
  const ok = { columns: ["total"], rows: [{ total: 7 }] };
  const normalized = normalizeAnalyticsBatch({
    results: {
      ok,
      denied: { error: "kpi_forbidden", message: "not authorized" },
    },
    partial: true,
  });

  assert.equal(normalized.results.ok, ok);
  assert.deepEqual(normalized.errors.denied, {
    code: "kpi_forbidden",
    message: "not authorized",
  });
  assert.equal(normalized.partial, true);
});

test("explicit errors are authoritative and companion failures do not blank base data", () => {
  const normalized = normalizeAnalyticsBatch({
    results: {
      card__prior: { error: "legacy_code", message: "legacy detail" },
    },
    errors: {
      card__prior: { code: "invalid_param", message: "bad comparison" },
    },
  });

  assert.deepEqual(normalized.errors.card__prior, {
    code: "invalid_param",
    message: "bad comparison",
  });
  assert.equal(errorForTile(normalized.errors, "card"), null);
  assert.equal(errorForTile(normalized.errors, "card__prior"), normalized.errors.card__prior);
  assert.equal(errorForTile(normalized.errors, "other"), null);
});

test("string errors reuse richer fallback messages across code types", () => {
  const normalized = normalizeAnalyticsBatch({
    results: { card: { error: "7", message: "specific detail" } },
    errors: { card: "7" },
  });

  assert.deepEqual(normalized.errors.card, { code: "7", message: "specific detail" });
});

test("empty rows are successful data and reserved keys remain ordinary own keys", () => {
  const payload = JSON.parse(
    '{"results":{"empty":{"rows":[]},"__proto__":{"error":"kpi_forbidden","message":"denied"}}}'
  );
  const normalized = normalizeAnalyticsBatch(payload);

  assert.equal(normalized.errors.empty, undefined);
  assert.deepEqual(normalized.errors.__proto__, {
    code: "kpi_forbidden",
    message: "denied",
  });
  assert.equal(errorForTile(normalized.errors, "__proto__").code, "kpi_forbidden");
  assert.equal(errorForTile({}, "constructor"), null);
});
