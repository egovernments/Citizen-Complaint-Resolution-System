#!/usr/bin/env node
/**
 * Summarise what the browser sends on every DIGIT call, per deployment.
 *
 *   node token-audit-report.js out/audit-kc.json out/audit-baseline.json
 *
 * The interesting question is not "is a token present" but "what SHAPE is it":
 * under Keycloak the browser must hold a JWT on every authenticated call, and
 * token-exchange-svc must swap it for a DIGIT uuid before Kong ever sees it.
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node token-audit-report.js <audit.json> [audit2.json ...]');
  process.exit(2);
}

for (const f of files) {
  const name = path.basename(f).replace(/^audit-|\.json$/g, '');
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`\n=== ${name.toUpperCase()} — ${rows.length} authenticated POST calls`);

  const tally = (key) =>
    rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
  console.log('  Authorization header :', JSON.stringify(tally('header')));
  console.log('  body RequestInfo.authToken:', JSON.stringify(tally('body')));

  // Per step, so a regression can be localised to raise / assign / resolve.
  const steps = [...new Set(rows.map((r) => r.step))];
  for (const s of steps) {
    const sr = rows.filter((r) => r.step === s);
    const h = sr.reduce((a, r) => ((a[r.header] = (a[r.header] || 0) + 1), a), {});
    const b = sr.reduce((a, r) => ((a[r.body] = (a[r.body] || 0) + 1), a), {});
    console.log(`   step ${s}: ${sr.length} calls  header=${JSON.stringify(h)} body=${JSON.stringify(b)}`);
  }

  // Anything that carried no credential at all, or a non-200.
  const anon = rows.filter((r) => r.header === 'none' && r.body === 'none');
  if (anon.length) {
    console.log(`  calls with NO token (${anon.length}):`);
    for (const r of [...new Set(anon.map((r) => r.path))]) console.log(`     ${r}`);
  }
  const bad = rows.filter((r) => r.status >= 400);
  console.log(`  non-2xx: ${bad.length}${bad.length ? ' -> ' + bad.map((r) => r.status + ' ' + r.path).join(', ') : ''}`);

  const mixed = rows.filter((r) => r.header !== 'none' && r.body !== 'none' && r.header !== r.body);
  if (mixed.length) {
    console.log(`  header/body SHAPE MISMATCH on ${mixed.length} call(s):`);
    for (const r of mixed.slice(0, 8)) console.log(`     ${r.path}  header=${r.header} body=${r.body}`);
  }
}
console.log();
