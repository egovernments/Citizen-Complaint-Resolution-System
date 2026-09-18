const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);
const seedDir = path.resolve(projectRoot, "../../../utilities/default-data-handler/src/main/resources/localisations");

require.cache[p("src/machine/util/localisation-service.js")] = {
  id: p("src/machine/util/localisation-service.js"),
  filename: p("src/machine/util/localisation-service.js"),
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined, getLocales: () => [] },
};

// Every {code, <locale>} bundle the machine can actually resolve.
function codeBundles() {
  const bundles = {};
  const walk = (node, seen = new Set()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (typeof node.code === "string") {
      for (const locale of ["pt_PT", "en_IN"]) {
        if (typeof node[locale] === "string") {
          bundles[node.code] = bundles[node.code] || {};
          bundles[node.code][locale] = node[locale];
        }
      }
    }
    for (const value of Object.values(node)) walk(value, seen);
  };
  walk(require(p("src/machine/flow/pgr-messages.js")));
  walk(require(p("src/machine/flow/shell-messages.js")));
  walk(require(p("src/machine/util/dialog.js")).global_messages);
  return bundles;
}

const bundles = codeBundles();

for (const locale of ["pt_PT", "en_IN"]) {
  const seedPath = path.join(seedDir, locale, "rainmaker-pgr-chatbot.json");
  const rows = JSON.parse(fs.readFileSync(seedPath, "utf-8"));

  test(`${locale}: the seed says exactly what the machine says`, () => {
    // dialog.get_message prefers a seeded bundle over the in-code text whenever the
    // bundle has a code, so a seed that disagrees silently overrides the committed
    // wording — that is how "reclamação" shipped over "manifestação".
    const drift = rows
      .filter((row) => bundles[row.code]?.[locale] !== undefined)
      .filter((row) => bundles[row.code][locale].trim() !== row.message.trim())
      .map((row) => row.code);

    assert.deepEqual(drift, [], `seed rows disagree with the in-code text: ${drift.join(", ")}`);
  });

  test(`${locale}: the seed ships no row the machine cannot resolve`, () => {
    const unreachable = rows.filter((row) => !bundles[row.code]).map((row) => row.code);
    assert.deepEqual(unreachable, [], `codes no bundle references: ${unreachable.join(", ")}`);
  });
}
