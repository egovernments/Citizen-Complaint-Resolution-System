#!/usr/bin/env node
/**
 * Generate digit-mcp/src/tools/dashboard-catalog-seed.ts — the canonical
 * dashboard catalog (schemas + KPI definitions + pack), embedded so
 * tenant_bootstrap can seed it from the repo rather than copying it from a
 * source tenant.
 *
 * WHY THIS EXISTS: dss.KpiDefinition / dss.DashboardPack are tenant-INVARIANT
 * platform definitions (no tenant identity inside). Copying them tenant-to-
 * tenant needs a correct "golden source" to exist and produces an empty
 * catalog when it doesn't (#1394). The l10n packs already solved the identical
 * problem by embedding the repo data as a constant and seeding from it
 * (DASHBOARD_L10N_PACKS); this is the same move for the catalog + schemas.
 *
 * The repo files stay the source of truth:
 *   - schemas: local-setup/db/dss-mdms-seed/schemas/dss.*.json
 *   - data:    ansible/nairobi-mdms/mdms/dss/{KpiDefinition,DashboardPack}.json
 * This file is DERIVED. Regenerate after changing either:
 *   node digit-mcp/scripts/gen-dashboard-catalog.mjs
 * `--check` exits non-zero if the committed .ts has drifted (CI runs this).
 *
 * dss.DashboardConfig is deliberately NOT embedded as data — allowedRoles /
 * numberFormat / departmentScoping are tenant-SPECIFIC and stay operator-owned
 * (enable-dashboard.sh / onboarding). Its schema IS embedded so bootstrap can
 * register it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCHEMA_DIR = path.join(REPO, 'local-setup/db/dss-mdms-seed/schemas');
const DATA_DIR = path.join(REPO, 'ansible/nairobi-mdms/mdms/dss');
const OUT = path.join(HERE, '../src/tools/dashboard-catalog-seed.ts');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// The ansible seed files are mdms-v2 wrapped ({tenantId, data}); the record we
// seed is the inner object. Tolerate the flat shape too.
const unwrap = (r) => (r && typeof r === 'object' && r.data && typeof r.data === 'object' ? r.data : r);

const schemas = {
  'dss.KpiDefinition': readJson(path.join(SCHEMA_DIR, 'dss.KpiDefinition.json')),
  'dss.DashboardPack': readJson(path.join(SCHEMA_DIR, 'dss.DashboardPack.json')),
  'dss.DashboardConfig': readJson(path.join(SCHEMA_DIR, 'dss.DashboardConfig.json')),
};
const kpiDefinitions = readJson(path.join(DATA_DIR, 'KpiDefinition.json')).map(unwrap);
const packs = readJson(path.join(DATA_DIR, 'DashboardPack.json')).map(unwrap);

// Fail loudly if the seed and schema disagree — the same offline check
// enable-dashboard.sh runs in preflight, so a stale schema can't ship a
// catalog that mdms-v2 will reject at create time.
for (const [code, key] of [['dss.KpiDefinition', 'x-unique']]) {
  if (!Array.isArray(schemas[code][key]) || schemas[code][key].length === 0) {
    throw new Error(`${code} schema is missing ${key} — mdms-v2 derives the record uid from it`);
  }
}
if (kpiDefinitions.some((k) => !k || typeof k.id !== 'string')) {
  throw new Error('every KpiDefinition record must carry a string id');
}

const banner = `/**
 * GENERATED — do not hand-edit. Regenerate with:
 *   node digit-mcp/scripts/gen-dashboard-catalog.mjs
 *
 * Source of truth:
 *   schemas  local-setup/db/dss-mdms-seed/schemas/dss.*.json
 *   catalog  ansible/nairobi-mdms/mdms/dss/{KpiDefinition,DashboardPack}.json
 *
 * The canonical, tenant-invariant dashboard catalog, embedded so
 * tenant_bootstrap seeds it from the repo instead of copying it from a source
 * tenant (#1394). dss.DashboardConfig data is intentionally absent — it is
 * tenant-specific; only its schema is here so bootstrap can register it.
 */
`;

const body =
  banner +
  '\n' +
  `export const DASHBOARD_CATALOG_SCHEMAS: Record<string, Record<string, unknown>> = ${JSON.stringify(schemas, null, 2)};\n\n` +
  `export const DASHBOARD_KPI_DEFINITIONS: Record<string, unknown>[] = ${JSON.stringify(kpiDefinitions, null, 2)};\n\n` +
  `export const DASHBOARD_PACKS: Record<string, unknown>[] = ${JSON.stringify(packs, null, 2)};\n`;

if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== body) {
    console.error(`DRIFT: ${path.relative(REPO, OUT)} is out of date — run: node digit-mcp/scripts/gen-dashboard-catalog.mjs`);
    process.exit(1);
  }
  console.log(`OK — ${path.relative(REPO, OUT)} matches the repo seed files`);
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote ${path.relative(REPO, OUT)} (${kpiDefinitions.length} KPI defs, ${packs.length} pack, ${Object.keys(schemas).length} schemas)`);
}
