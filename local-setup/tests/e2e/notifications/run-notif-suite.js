#!/usr/bin/env node
'use strict';
/*
 * ============================================================================
 * run-notif-suite.js — notification E2E suite runner (TASK-031)
 * ============================================================================
 *
 * Runs the per-area case specs (cases/area-*.js) against a live DIGIT stack and
 * prints a PASS/FAIL/SKIP matrix keyed by case id. Exits non-zero on any FAIL
 * (SKIP is NOT a failure).
 *
 * Flags:
 *   --only=A,C      run only these areas (comma-separated letters)
 *   --target=bomet  informational tag for the run header (default: env/local)
 *
 * Env (see notif-harness.js for the full list): BASE, DIGIT_TENANT, SERVICE_CODE,
 * SERVICE_NAME, LOCALITY, TEST_PHONE, TEST_EMAIL, E2E_EMP_USER, E2E_EMP_PASS,
 * NOVU_API_KEY (auto-resolved from the novu-bridge container if unset), PG_CONTAINER.
 *
 * RUN ON the DIGIT host (shells out to `docker exec <PG> psql`, reaches Kong at
 * localhost:18000):
 *   E2E_EMP_USER=bometadmin E2E_EMP_PASS=eGov@123 \
 *     node run-notif-suite.js --target=bomet
 * ============================================================================
 */
const path = require('path');
const H = require('./notif-harness');

const AREAS = [
  { letter: 'A', file: 'cases/area-a-providers.js', name: 'Provider management' },
  { letter: 'B', file: 'cases/area-b-routing.js', name: 'Routing & channel' },
  { letter: 'C', file: 'cases/area-c-templates.js', name: 'Templates' },
  { letter: 'D', file: 'cases/area-d-preferences.js', name: 'User preferences' },
  { letter: 'E', file: 'cases/area-e-delivery.js', name: 'Delivery + resilience' },
  { letter: 'F', file: 'cases/area-f-mdms.js', name: 'MDMS master lifecycle' },
];

function parseArgs(argv) {
  const args = { only: null, target: process.env.TARGET || 'local' };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) args.only = a.slice(7).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--target=')) args.target = a.slice(9);
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const areas = AREAS.filter((a) => !args.only || args.only.includes(a.letter));

  console.log('='.repeat(72));
  console.log(`Notification E2E suite — target=${args.target} tenant=${H.TENANT} base=${H.BASE}`);
  console.log(`serviceCode=${H.SERVICE_CODE} (expect name "${H.SERVICE_NAME}")  novuKey=${H.NOVU_API_KEY ? 'resolved' : 'MISSING'}`);
  console.log(`areas: ${areas.map((a) => a.letter).join(', ')}`);
  console.log('='.repeat(72));

  // Shared context: employee token (for role fan-out cross-checks; proxy gate may be off).
  const ctx = {};
  if (H.EMP_USER && H.EMP_PASS) {
    try {
      const emp = await H.token(H.EMP_USER, H.EMP_PASS, 'EMPLOYEE', H.TENANT);
      ctx.empToken = emp.access_token;
      ctx.empUi = emp.UserRequest;
      console.log(`employee ${H.EMP_USER} authenticated (uuid=${emp.UserRequest.uuid})`);
    } catch (e) {
      console.log(`WARN: employee auth failed (${e.message}) — role/auth-gated cases may SKIP/FAIL`);
    }
  } else {
    console.log('NOTE: E2E_EMP_USER/E2E_EMP_PASS unset — auth-gated + role fan-out cases limited');
  }

  // Warm the shared complaint fixture up front (so timing failures surface once, not per case).
  if (areas.some((a) => 'BCEF'.includes(a.letter))) {
    process.stdout.write('\nCreating shared complaint fixture (APPLY) and polling nb_dispatch_log … ');
    try {
      const cmp = await H.ensureComplaint(ctx);
      console.log(`ok: ${cmp.id} (${cmp.rows.length} dispatch rows, ${cmp.messages.length} Novu messages)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      console.log('  (B/C/E/F cases depending on the fixture will FAIL/SKIP accordingly)');
    }
  }

  const all = [];
  for (const area of areas) {
    console.log(`\n---- Area ${area.letter}: ${area.name} ----`);
    let results;
    try {
      const mod = require(path.join(__dirname, area.file));
      results = await mod.run(ctx);
    } catch (e) {
      results = [H.FAIL(area.letter + '-load', 'area threw: ' + e.message)];
    }
    for (const r of results) {
      all.push(r);
      const badge = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'SKIP';
      console.log(`  [${r.id}] ${badge}  ${r.detail || ''}`);
    }
  }

  // ---- Matrix summary ----
  const pass = all.filter((r) => r.status === 'PASS').length;
  const fail = all.filter((r) => r.status === 'FAIL').length;
  const skip = all.filter((r) => r.status === 'SKIP').length;

  console.log('\n' + '='.repeat(72));
  console.log('MATRIX');
  console.log('='.repeat(72));
  for (const r of all) console.log(`[${r.id}] ${r.status}  ${r.detail || ''}`);
  console.log('-'.repeat(72));
  console.log(`TOTAL: ${all.length}  |  PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
  console.log('='.repeat(72));

  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('\nFATAL: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
