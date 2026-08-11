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

const { normalizeAnalyticsBatch, errorForTile } = require(OUT);

test("legacy inline errors become canonical without disturbing successful results", () => {
  const ok = { columns: ["total"], rows: [{ total: 7 }] };
  const payload = {
    results: {
      ok,
      denied: { error: "kpi_forbidden", message: "not authorized" },
    },
    partial: true,
  };

  const normalized = normalizeAnalyticsBatch(payload);

  assert.equal(normalized.results.ok, ok, "successful result identity is preserved");
  assert.deepEqual(normalized.errors.denied, {
    code: "kpi_forbidden",
    message: "not authorized",
  });
  assert.equal(normalized.partial, true);
});

test("explicit string and object errors normalize, with the explicit code authoritative", () => {
  const payload = {
    results: {
      denied: { error: "legacy_code", message: "specific backend explanation" },
      same: { error: "kpi_forbidden", message: "matching inline explanation" },
    },
    errors: {
      denied: "kpi_forbidden",
      same: "kpi_forbidden",
      invalid: { error: "invalid_param", message: "bad window" },
      scoped: { code: "scope_incomplete", message: "scope unavailable" },
    },
    partial: false,
  };

  const normalized = normalizeAnalyticsBatch(payload);

  assert.deepEqual(normalized.errors.denied, {
    code: "kpi_forbidden",
    message: "kpi_forbidden",
  });
  assert.deepEqual(normalized.errors.same, {
    code: "kpi_forbidden",
    message: "matching inline explanation",
  });
  assert.deepEqual(normalized.errors.invalid, { code: "invalid_param", message: "bad window" });
  assert.deepEqual(normalized.errors.scoped, {
    code: "scope_incomplete",
    message: "scope unavailable",
  });
  assert.equal(normalized.partial, true, "an error repairs a stale/missing partial flag");
});

test("empty rows are successful data, not an inferred error", () => {
  const result = { columns: ["total"], rows: [], rowCount: 0 };
  const normalized = normalizeAnalyticsBatch({ results: { empty: result }, partial: false });

  assert.equal(normalized.results.empty, result);
  assert.equal(normalized.errors, null);
  assert.equal(normalized.partial, false);
});

test("companion failures resolve to the rendered base tile", () => {
  const errors = {
    card__prior: { code: "invalid_param", message: "bad comparison" },
    spark__series: { code: "scope_incomplete", message: "no daily scope" },
    map__pins: { code: "kpi_forbidden", message: "pins restricted" },
  };

  assert.equal(errorForTile(errors, "card"), errors.card__prior);
  assert.equal(errorForTile(errors, "spark"), errors.spark__series);
  assert.equal(errorForTile(errors, "map"), errors.map__pins);
  assert.equal(errorForTile(errors, "other"), null);
});

test("a base error wins over companion errors", () => {
  const errors = {
    tile: { code: "kpi_forbidden", message: "base" },
    tile__prior: { code: "invalid_param", message: "prior" },
  };

  assert.equal(errorForTile(errors, "tile"), errors.tile);
});

test("normalization never mutates legacy or new response maps", () => {
  const payload = {
    results: { denied: { error: "kpi_forbidden", message: "legacy" } },
    errors: { denied: { error: "kpi_forbidden", message: "new" } },
    partial: false,
  };
  const before = JSON.parse(JSON.stringify(payload));

  const normalized = normalizeAnalyticsBatch(payload);

  assert.deepEqual(payload, before);
  assert.notEqual(normalized, payload);
  assert.notEqual(normalized.errors, payload.errors);
});

test("reserved tile keys remain ordinary own keys and never match object prototypes", () => {
  const payload = JSON.parse('{"results":{"__proto__":{"error":"kpi_forbidden","message":"denied"}}}');

  const normalized = normalizeAnalyticsBatch(payload);

  assert.deepEqual(normalized.errors.__proto__, {
    code: "kpi_forbidden",
    message: "denied",
  });
  assert.equal(errorForTile(normalized.errors, "__proto__").code, "kpi_forbidden");
  assert.equal(errorForTile({}, "constructor"), null);
});
