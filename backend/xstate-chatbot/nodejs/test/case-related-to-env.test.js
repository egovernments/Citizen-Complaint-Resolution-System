const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const envPath = path.join(path.resolve(__dirname, ".."), "src/env-variables.js");

function caseRelatedTo(value) {
  const saved = process.env.CASE_RELATED_TO;
  if (value === undefined) delete process.env.CASE_RELATED_TO;
  else process.env.CASE_RELATED_TO = value;
  delete require.cache[envPath];
  try {
    return require(envPath).caseRelatedTo;
  } finally {
    if (saved === undefined) delete process.env.CASE_RELATED_TO;
    else process.env.CASE_RELATED_TO = saved;
    delete require.cache[envPath];
  }
}

test("REVIEW: CASE_RELATED_TO is trimmed; empty means off, unset means IGE", () => {
  // ' ' was truthy and filed every complaint as caseRelatedTo ' ', which PGR rejects.
  assert.equal(caseRelatedTo(" "), "");
  assert.equal(caseRelatedTo(" IGE "), "IGE");
  assert.equal(caseRelatedTo(""), "");
  assert.equal(caseRelatedTo(undefined), "IGE");
});
