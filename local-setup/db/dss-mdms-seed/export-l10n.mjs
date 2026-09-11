#!/usr/bin/env node
/**
 * Emit the dashboard localization packs as plain JSON, one file per locale.
 *
 * Why this exists: the packs live as TypeScript constants in
 * digit-mcp/src/tools/dashboard-l10n-seed.ts, which makes them reachable from
 * tenant_bootstrap and from nowhere else. An operator enabling the dashboard on
 * a running deployment (enable-dashboard.sh) has no TypeScript toolchain in the
 * loop, so we derive JSON the shell script can POST directly.
 *
 * The .ts file stays the source of truth (it is itself generated from the FE
 * t("KEY", "English") literals + the KpiDefinition title/subtitle/label pairs).
 * These JSON files are DERIVED — never hand-edit them; re-run this script:
 *
 *   node local-setup/db/dss-mdms-seed/export-l10n.mjs
 *
 * `--check` exits non-zero if the committed JSON has drifted from the .ts,
 * which is what CI runs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const SRC = path.join(REPO, 'digit-mcp/src/tools/dashboard-l10n-seed.ts');
const OUT = path.join(HERE, 'l10n');

// The exported arrays are pure JSON literals; slice them out rather than
// pulling in a TS toolchain just to read two constants.
function extractArray(src, name) {
  const decl = src.indexOf(`export const ${name}`);
  if (decl === -1) throw new Error(`${name} not found in ${SRC}`);
  const start = src.indexOf('= [', decl) + 2; // skip "= ", land on "["
  const end = src.indexOf('\n];', start);
  if (start < 2 || end === -1) throw new Error(`could not delimit ${name}`);
  return JSON.parse(src.slice(start, end + 2));
}

const src = fs.readFileSync(SRC, 'utf8');
const packs = {
  en_IN: extractArray(src, 'DASHBOARD_L10N_MESSAGES'),
  pt_PT: extractArray(src, 'DASHBOARD_L10N_MESSAGES_PT_PT'),
};

// Every locale must carry the reference set 1:1 — a locale missing codes
// renders raw DASHBOARD_* keys for exactly those tiles, which is the failure
// mode this whole file exists to prevent.
const reference = new Set(packs.en_IN.map((m) => m.code));
for (const [locale, msgs] of Object.entries(packs)) {
  const codes = new Set(msgs.map((m) => m.code));
  const missing = [...reference].filter((c) => !codes.has(c));
  const extra = [...codes].filter((c) => !reference.has(c));
  if (missing.length || extra.length) {
    throw new Error(
      `${locale} is not 1:1 with en_IN — missing ${missing.length} ` +
        `(${missing.slice(0, 3)}), extra ${extra.length} (${extra.slice(0, 3)})`,
    );
  }
}

const check = process.argv.includes('--check');
fs.mkdirSync(OUT, { recursive: true });
let drifted = false;

for (const [locale, msgs] of Object.entries(packs)) {
  const file = path.join(OUT, `${locale}.json`);
  const body = JSON.stringify(msgs, null, 2) + '\n';
  if (check) {
    const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (have !== body) {
      console.error(`DRIFT: ${path.relative(REPO, file)} differs from ${path.relative(REPO, SRC)}`);
      drifted = true;
    }
  } else {
    fs.writeFileSync(file, body);
    console.log(`wrote ${path.relative(REPO, file)} (${msgs.length} messages)`);
  }
}

if (check && drifted) {
  console.error('Re-run: node local-setup/db/dss-mdms-seed/export-l10n.mjs');
  process.exit(1);
}
if (check) console.log(`OK — l10n JSON matches ${path.relative(REPO, SRC)}`);
