const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DASHBOARD_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(DASHBOARD_ROOT, "../../..");
const L10N_ROOT = path.join(REPO_ROOT, "local-setup/db/dss-mdms-seed/l10n");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:js|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.js") ? [full] : [];
  });
}

function literalDashboardKeys() {
  const keys = new Set();
  const call = /\b(?:t|tt|translate)\(\s*["'](DASHBOARD_[A-Z0-9_]+)["']/g;
  for (const file of sourceFiles(DASHBOARD_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(call)) keys.add(match[1]);
  }
  return keys;
}

function literalCallsMissingEnglishFallback() {
  const missing = [];
  const call = /\b(?:t|tt|translate)\(\s*["'](DASHBOARD_[A-Z0-9_]+)["']\s*([,)])/g;
  // DashboardCard.js uses the host DIGIT t() API (which owns its fallback
  // chain); the inline fallback contract applies to our localeRuntime calls.
  for (const file of sourceFiles(path.join(DASHBOARD_ROOT, "src"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(call)) {
      if (match[2] === ")") missing.push(`${path.relative(DASHBOARD_ROOT, file)}: ${match[1]}`);
    }
  }
  return missing;
}

function pack(locale) {
  const messages = JSON.parse(fs.readFileSync(path.join(L10N_ROOT, `${locale}.json`), "utf8"));
  return new Map(messages.map(({ code, message }) => [code, message]));
}

test("every literal dashboard translation call is seeded in en_IN and pt_PT", () => {
  const used = literalDashboardKeys();
  const english = pack("en_IN");
  const portuguese = pack("pt_PT");
  const missingEnglish = [...used].filter((key) => !english.has(key));
  const missingPortuguese = [...used].filter((key) => !portuguese.has(key));

  assert.deepEqual(missingEnglish, [], `missing en_IN keys: ${missingEnglish.join(", ")}`);
  assert.deepEqual(missingPortuguese, [], `missing pt_PT keys: ${missingPortuguese.join(", ")}`);
});

test("Portuguese dashboard pack has exact key parity with en_IN", () => {
  const english = pack("en_IN");
  const portuguese = pack("pt_PT");
  assert.deepEqual([...portuguese.keys()].sort(), [...english.keys()].sort());
  for (const [code, message] of portuguese) {
    assert.equal(typeof message, "string", `${code} must have a string message`);
    assert.notEqual(message.trim(), "", `${code} must not have an empty Portuguese message`);
  }
});

test("literal dashboard translations provide the standalone English fallback", () => {
  assert.deepEqual(literalCallsMissingEnglishFallback(), []);
});

test("memoized localized surfaces refresh after late bundle installation", () => {
  const surfaces = [
    "components/ComplaintsAtRiskTable.jsx",
    "components/DashboardTable.jsx",
    "components/DepartmentBarChart.jsx",
    "components/GeographyChoroplethMap.jsx",
    "components/HorizontalBarChart.jsx",
    "components/OpenComplaintsByGeographyWidget.jsx",
  ];

  for (const relative of surfaces) {
    const source = fs.readFileSync(path.join(DASHBOARD_ROOT, "src", relative), "utf8");
    const languageDependencyLists = [...source.matchAll(/\[[^\]]*\blanguage\b[^\]]*\]/gs)];
    assert.ok(languageDependencyLists.length > 0, `${relative} must expose its locale dependencies`);
    for (const [dependencies] of languageDependencyLists) {
      assert.match(
        dependencies,
        /\bi18nTick\b/,
        `${relative} language dependency must also react to late bundle installation`,
      );
    }
  }
});
