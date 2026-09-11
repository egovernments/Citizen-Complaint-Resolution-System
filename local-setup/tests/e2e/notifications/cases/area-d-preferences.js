'use strict';
/*
 * Area D — User preferences (consent + language).
 * Consent-gating (D1-D3) is disabled on Bomet (NOVU_BRIDGE_PREFERENCE_ENABLED=false),
 * so those are SKIP; the preference READ path (D4/D5) is still asserted.
 */
const H = require('../notif-harness');

async function run(ctx) {
  const results = [];

  results.push(H.SKIP('D1', 'preference gate disabled on Bomet (NOVU_BRIDGE_PREFERENCE_ENABLED=false) — per-channel consent not enforced'));
  results.push(H.SKIP('D2', 'preference gate disabled on Bomet — tenant-specific consent enforcement not testable here'));
  results.push(H.SKIP('D3', 'preference gate disabled on Bomet — default-revoked/no-fallback not enforced'));

  // ---- D4: preferredLanguage present on preferences (read) ----
  results.push(await H.guard('D4', async () => {
    const r = await H.preferencesList(H.TENANT, ctx.empToken);
    if (r.status !== 200) return H.FAIL('D4', `GET /preferences → ${r.status}`);
    const data = (r.json && r.json.data) || [];
    if (!data.length) return H.SKIP('D4', 'no stored preferences on Bomet to read preferredLanguage from');
    const withLang = data.filter((p) => typeof p.preferredLanguage === 'string' && p.preferredLanguage);
    const langs = [...new Set(withLang.map((p) => p.preferredLanguage))];
    if (!withLang.length) return H.FAIL('D4', 'no preference carries preferredLanguage');
    return H.PASS('D4', `${withLang.length}/${data.length} prefs carry preferredLanguage (locales: ${langs.join(', ')}) — read path OK (gate off so not applied to routing)`);
  }));

  // ---- D5: preference persists / stable across re-fetch ----
  results.push(await H.guard('D5', async () => {
    const a = await H.preferencesList(H.TENANT, ctx.empToken);
    await H.sleep(500);
    const b = await H.preferencesList(H.TENANT, ctx.empToken);
    const da = (a.json && a.json.data) || [], db = (b.json && b.json.data) || [];
    if (!da.length) return H.SKIP('D5', 'no stored preferences to re-fetch');
    const key = (p) => `${p.userId}|${p.preferredLanguage}|${JSON.stringify(p.consent)}`;
    const setA = new Set(da.map(key)), setB = new Set(db.map(key));
    const same = da.length === db.length && [...setA].every((k) => setB.has(k));
    if (same) return H.PASS('D5', `preferences stable across re-fetch (${da.length} records, identical consent+lang)`);
    return H.FAIL('D5', `preferences differ across re-fetch: ${da.length} vs ${db.length}`);
  }));

  // ---- D6: consent surfaced read-only in configurator (UI) ----
  results.push(H.SKIP('D6', 'configurator UI screen — out of API-suite scope (Playwright)'));

  return results;
}

module.exports = { run };
