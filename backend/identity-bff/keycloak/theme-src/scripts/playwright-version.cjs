// npm ci installs exactly the version pinned in this lockfile. Read the pin
// directly so smoke tests can select the matching container even when this
// package's node_modules has not been installed on the host runner.
const lock = require("../package-lock.json");
const version = lock.packages?.["node_modules/@playwright/test"]?.version;

if (!version) {
    throw new Error("package-lock.json does not pin @playwright/test");
}

module.exports = version;
