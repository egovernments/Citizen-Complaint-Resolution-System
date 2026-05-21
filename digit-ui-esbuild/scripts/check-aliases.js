#!/usr/bin/env node

/**
 * Verify all @egovernments/* aliases in esbuild.build.js resolve to real files.
 * Exits with code 1 if any alias target is missing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const configPath = path.join(ROOT, "esbuild.build.js");
const content = fs.readFileSync(configPath, "utf8");

// Extract the alias block (between "alias: {" and the matching "}")
const aliasStart = content.indexOf("alias:");
const aliasEnd = content.indexOf("nodePaths:");
if (aliasStart === -1 || aliasEnd === -1) {
  console.error("Could not find alias block in esbuild.build.js");
  process.exit(1);
}
const aliasSection = content.slice(aliasStart, aliasEnd);

// Find all path.resolve(__dirname, "...") targets
const pathRegex = /path\.resolve\(\s*__dirname\s*,\s*"([^"]+)"\s*\)/g;
let match;
let checked = 0;
let broken = 0;

while ((match = pathRegex.exec(aliasSection)) !== null) {
  const relPath = match[1];
  const absPath = path.resolve(ROOT, relPath);
  checked++;

  if (!fs.existsSync(absPath)) {
    console.error(`BROKEN: ${relPath} -> ${absPath}`);
    broken++;
  } else {
    console.log(`  OK: ${relPath}`);
  }
}

console.log(`\n${checked} aliases checked, ${broken} broken`);

if (broken > 0) {
  process.exit(1);
}

if (checked === 0) {
  console.error("No aliases found - check the regex against esbuild.build.js");
  process.exit(1);
}
