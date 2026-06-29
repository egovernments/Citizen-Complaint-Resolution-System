#!/usr/bin/env node
/**
 * Configurator i18n audit — enumerate the EXHAUSTIVE set of translatable
 * label keys the configurator can render, and diff against the committed
 * localization bundle so you know exactly what still needs translating.
 *
 * Where labels come from (and thus what this enumerates):
 *   1. app.resources.<id>  — every resource in the data-provider registry
 *      (dedicated + generic MDMS), rendered via useResourceLabel().
 *   2. app.fields.<field>  — every SCALAR property of every resource's MDMS
 *      schema. List column headers (DigitDatagrid) and show/edit field labels
 *      derive from these via the same snake-case key.
 *
 * Usage (run anywhere with network to a DIGIT install):
 *   DIGIT_BASE=https://bometfeedbackhub.digit.org \
 *   TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
 *   BUNDLE=../local-setup/ansible/files/configurator-localization/configurator-ui.json \
 *   node scripts/i18n-audit.mjs
 *
 * Output:
 *   - prints a summary (total keys, how many already translated, how many missing)
 *   - writes scripts/i18n-missing.json: { "<code>": {en, hi, fr, pt:""} } for the
 *     missing keys, pre-filled with the English label — fill in hi/fr/pt, then
 *     fold into the bundle generator and re-seed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIGIT_BASE = process.env.DIGIT_BASE || 'http://localhost:18000';
const TENANT = process.env.TENANT || 'ke';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASS || 'eGov@123';
const BUNDLE = process.env.BUNDLE
  || path.resolve(__dirname, '../../local-setup/ansible/files/configurator-localization/configurator-ui.json');
const LOCALES = ['en_IN', 'hi_IN', 'fr_FR', 'pt_BR'];

// --- helpers replicated from @digit-ui/datagrid + DigitDatagrid (keep in sync) ---
function formatFieldLabel(fieldName) {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (s) => s.toUpperCase());
}
function fieldKey(source) {
  return 'app.fields.' + source.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
function resourceKey(id) {
  return 'app.resources.' + id.replace(/-/g, '_');
}
function isComplexType(prop) {
  if (!prop || typeof prop !== 'object') return true;
  if (prop.type === 'object' || prop.type === 'array') return true;
  if ('properties' in prop || 'items' in prop) return true;
  return false;
}

async function api(p, body) {
  const res = await fetch(DIGIT_BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function mintToken() {
  const form = new URLSearchParams({
    username: ADMIN_USER, password: ADMIN_PASS, userType: 'EMPLOYEE',
    tenantId: TENANT, scope: 'read', grant_type: 'password',
  });
  const res = await fetch(DIGIT_BASE + '/user/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`auth -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  // registry (resource -> schema/label) from the built data-provider package
  const reg = await import(path.resolve(__dirname, '../packages/data-provider/dist/index.js'));
  const resources = { ...reg.getDedicatedResources(), ...reg.getGenericMdmsResources() };

  const tok = await mintToken();
  const ri = { apiId: 'Rainmaker', ver: '.01', authToken: tok.access_token, userInfo: tok.UserRequest };

  // pull all schema definitions in one shot
  const schemaCodes = [...new Set(Object.values(resources).map((r) => r.schema).filter(Boolean))];
  const schemaResp = await api('/mdms-v2/schema/v1/_search', {
    RequestInfo: ri,
    SchemaDefCriteria: { tenantId: TENANT, codes: schemaCodes, limit: 500, offset: 0 },
  });
  const byCode = {};
  for (const s of schemaResp.SchemaDefinitions || []) byCode[s.code] = s.definition;

  // collect the exhaustive key -> English label map
  const expected = {}; // code -> englishLabel
  for (const [id, cfg] of Object.entries(resources)) {
    expected[resourceKey(id)] = reg.getResourceLabel(id);
    const def = cfg.schema ? byCode[cfg.schema] : null;
    const props = (def && def.properties) || {};
    for (const [name, prop] of Object.entries(props)) {
      if (isComplexType(prop)) continue;
      expected[fieldKey(name)] = formatFieldLabel(name);
    }
  }

  // what the committed bundle already has (per locale)
  const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
  const have = {}; // code -> Set(locale)
  for (const m of bundle) (have[m.code] ||= new Set()).add(m.locale);

  const missing = {};
  let fullyTranslated = 0;
  for (const [code, en] of Object.entries(expected)) {
    const locs = have[code] || new Set();
    const complete = LOCALES.every((l) => locs.has(l));
    if (complete) { fullyTranslated++; continue; }
    missing[code] = { en, hi: '', fr: '', pt: '' };
  }

  const outPath = path.resolve(__dirname, 'i18n-missing.json');
  fs.writeFileSync(outPath, JSON.stringify(missing, null, 2) + '\n');

  console.log('=== Configurator i18n audit ===');
  console.log(`DIGIT_BASE           : ${DIGIT_BASE}  (tenant ${TENANT})`);
  console.log(`resources            : ${Object.keys(resources).length}`);
  console.log(`schemas fetched      : ${Object.keys(byCode).length}/${schemaCodes.length}`);
  console.log(`expected keys (total): ${Object.keys(expected).length}`);
  console.log(`fully translated     : ${fullyTranslated}`);
  console.log(`MISSING              : ${Object.keys(missing).length}  -> ${outPath}`);
  if (Object.keys(missing).length) {
    console.log('\nMissing codes (English label):');
    for (const [code, v] of Object.entries(missing)) console.log(`  ${code}  =  ${v.en}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
