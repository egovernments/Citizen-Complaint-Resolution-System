// Reusable OOTB theme catalog — v3-shape ThemeConfig payloads, structurally
// identical to what a tenant's `common-masters.ThemeConfig` MDMS record
// carries. Bomet Blue formalizes the tenant's real live production colors;
// Maputo Green has no prior deployment to match, so it's a fresh palette.
// Enumerable here so tooling/tests don't need to hardcode filenames.
const bometBlue = require("./bomet-blue.json");
const maputoGreen = require("./maputo-green.json");

const presets = {
  [bometBlue.code]: bometBlue,
  [maputoGreen.code]: maputoGreen,
};

module.exports = { presets, bometBlue, maputoGreen };
