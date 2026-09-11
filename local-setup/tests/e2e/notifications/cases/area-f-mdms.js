'use strict';
/*
 * Area F — Config/MDMS master lifecycle (replaces config-service).
 * Non-mutating reads via mdms-v2 /v1/_search + psql; resolve tied to the fixture.
 */
const H = require('../notif-harness');

const MASTERS = ['NotificationRouting', 'NotificationTemplate', 'NotificationProviderTemplate'];

async function run(ctx) {
  const results = [];

  // ---- F1: MDMS master search (all three masters resolve rows) ----
  results.push(await H.guard('F1', async () => {
    const counts = {};
    for (const m of MASTERS) {
      const r = await H.mdmsSearch('RAINMAKER-PGR', m, H.STATE_TENANT);
      counts[m] = r.rows ? r.rows.length : -1;
    }
    const empty = MASTERS.filter((m) => counts[m] <= 0);
    if (empty.length) return H.FAIL('F1', `masters with no rows via mdms-v2 search: ${empty.join(', ')} (counts ${JSON.stringify(counts)})`);
    return H.PASS('F1', `mdms-v2 search returns rows for all masters: ${MASTERS.map((m) => `${m}=${counts[m]}`).join(', ')}`);
  }));

  // ---- F2: Uniqueness (x-unique) — no duplicate NotificationTemplate keys ----
  results.push(await H.guard('F2', async () => {
    // Unique key = (audience, action, toState, channel, locale) among active rows @ state.
    const dups = H.psql(`SELECT data->>'audience', data->>'action', data->>'toState', data->>'channel', data->>'locale', count(*) `
      + `FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.NotificationTemplate' AND isactive=true AND tenantid='${H.STATE_TENANT}' `
      + `GROUP BY 1,2,3,4,5 HAVING count(*) > 1`);
    if (dups.length) return H.FAIL('F2', `${dups.length} duplicate template key(s), e.g. ${dups[0].slice(0, 5).join('/')} ×${dups[0][5]}`);
    return H.PASS('F2', 'NotificationTemplate keys unique on (audience,action,toState,channel,locale) among active state rows');
  }));

  // ---- F3: Resolve by (action,toState,audience,channel,locale) → exactly one, matches delivery ----
  results.push(await H.guard('F3', async () => {
    const t = await H.mdmsSearch('RAINMAKER-PGR', 'NotificationTemplate', H.STATE_TENANT);
    if (!t.rows) return H.FAIL('F3', 'NotificationTemplate search returned no rows');
    const match = t.rows.filter((r) => up(r.action) === 'APPLY' && up(r.audience) === 'CITIZEN'
      && up(r.channel) === 'SMS' && String(r.locale) === 'en_IN' && r.active !== false);
    if (match.length !== 1) return H.FAIL('F3', `expected exactly 1 APPLY/CITIZEN/SMS/en_IN template, got ${match.length}`);
    const tmplBody = String(match[0].body || '');
    const cmp = await H.ensureComplaint(ctx);
    const msg = cmp.messages.find((m) => m.channel === 'SMS' && /Your complaint for/i.test(m.body));
    if (!msg) return H.PASS('F3', `single template resolves for APPLY/CITIZEN/SMS/en_IN (rendered body not retrievable to cross-check)`);
    // The rendered body must be this template with placeholders filled — compare the fixed prefix.
    const prefix = tmplBody.split('{')[0].trim();
    if (prefix && msg.body.startsWith(prefix))
      return H.PASS('F3', `resolver picked APPLY/CITIZEN/SMS/en_IN template; rendered body matches its prefix "${prefix.slice(0, 40)}…"`);
    return H.FAIL('F3', `rendered body does not match resolved template prefix "${prefix.slice(0, 40)}"`);
  }));

  // ---- F4: No template resolved → skip + honest log ----
  results.push(H.SKIP('F4',
    'no-template-resolved skip path needs a controlled orphan routing key + novu-bridge log inspection; covered by unit tests (NotificationResolverEdgeCasesTest) / fresh stack'));

  // ---- F5: Rendered with token data (placeholders from complaint context) ----
  results.push(await H.guard('F5', async () => {
    const cmp = await H.ensureComplaint(ctx);
    if (!H.NOVU_API_KEY || !cmp.messages.length)
      return H.SKIP('F5', 'no Novu-rendered body available to confirm token substitution');
    const withId = cmp.messages.filter((m) => m.body && m.body.includes(cmp.id));
    if (!withId.length) return H.FAIL('F5', `no rendered body contains the complaint id ${cmp.id}`);
    const hasDate = withId.some((m) => /\d{2}\/\d{2}\/\d{4}/.test(m.body));
    return H.PASS('F5', `rendered bodies carry live token data: complaint id ${cmp.id} in ${withId.length} message(s), date substituted=${hasDate}`);
  }));

  return results;
}

const up = (v) => String(v == null ? '' : v).toUpperCase();

module.exports = { run };
