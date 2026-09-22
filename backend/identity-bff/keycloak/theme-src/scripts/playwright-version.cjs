// Single source for the Playwright container tag: whatever version is
// installed is the version the baselines were recorded with.
module.exports = require("@playwright/test/package.json").version;
