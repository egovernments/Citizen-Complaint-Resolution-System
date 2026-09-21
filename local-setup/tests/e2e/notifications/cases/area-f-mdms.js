'use strict';
/*
 * Area F — Config/MDMS master lifecycle (replaces config-service).
 * Non-mutating reads via mdms-v2 /v1/_search + psql; resolve tied to the fixture.
 *
 * Which namespace is read comes from the harness's single per-tenant rule
 * (`H.notificationSource()`), so a tenant copied to NOTIFICATIONS.* and a tenant
 * still on RAINMAKER-PGR.Notification* are both covered by the same cases.
 * F2's uniqueness key differs between the two by design: the legacy master is
 * unique on (audience, action, toState, channel, locale), the new one on
 * (eventName, audience, channel, locale) — eventName subsumes action+toState.
 */
const H = require('../notif-harness');

const MASTERS = ['Routing', 'Template', 'ProviderTemplate'];

async function run(ctx) {
  const results = [];
  const src = H.notificationSource();
  const templateCode = H.notifSchemaCode('Template');

  // ---- F1: MDMS master search (all three masters resolve rows) ----
  results.push(await H.guard('F1', async () => {
    const counts = {};
    for (const m of MASTERS) {
      const r = await H.notifMaster(m, H.STATE_TENANT);
      counts[H.notifSchemaCode(m)] = r.rows ? r.rows.length : -1;
    }
    const empty = Object.keys(counts).filter((c) => counts[c] <= 0);
    if (empty.length) return H.FAIL('F1', `masters with no rows via mdms-v2 search: ${empty.join(', ')} (counts ${JSON.stringify(counts)})`);
    return H.PASS('F1', `mdms-v2 search returns rows for all masters [source: ${src.label}]: `
      + Object.entries(counts).map(([c, n]) => `${c}=${n}`).join(', '));
  }));

  // ---- F1b: the catalogue, which only exists in the new namespace ----
  results.push(await H.guard('F1b', async () => {
    if (src.source !== H.C.SOURCE.NEXT)
      return H.SKIP('F1b', `tenant is still served ${H.notifSchemaCode('Routing')}; NOTIFICATIONS.EventCatalogue has no legacy equivalent and is not expected yet (run ./deploy.sh <tenant> --tags notifications to copy)`);
    const cat = await H.notifMaster('EventCatalogue', H.STATE_TENANT);
    const n = cat.rows ? cat.rows.length : 0;
    if (n <= 0) return H.FAIL('F1b', 'NOTIFICATIONS.EventCatalogue has no rows, yet the tenant is served the new namespace — an uncatalogued eventName is REJECTED/NB_EVENT_NOT_IN_CATALOGUE');
    const bad = cat.rows.filter((r) => !H.C.parseEventName(r.eventName));
    if (bad.length) return H.FAIL('F1b', `${bad.length} catalogue row(s) carry an eventName that is not <PREFIX>.<ACTION>.<TOSTATE>`);
    return H.PASS('F1b', `NOTIFICATIONS.EventCatalogue has ${n} row(s), every eventName splittable into (action, toState)`);
  }));

  // ---- F2: Uniqueness (x-unique) — no duplicate template keys ----
  results.push(await H.guard('F2', async () => {
    // The key differs per namespace, because eventName subsumes (action, toState).
    const keyCols = src.source === H.C.SOURCE.NEXT
      ? ["data->>'eventName'", "data->>'audience'", "data->>'channel'", "data->>'locale'"]
      : ["data->>'audience'", "data->>'action'", "data->>'toState'", "data->>'channel'", "data->>'locale'"];
    const n = keyCols.length;
    const dups = H.psql(`SELECT ${keyCols.join(', ')}, count(*) `
      + `FROM eg_mdms_data WHERE schemacode='${templateCode}' AND isactive=true AND tenantid='${H.STATE_TENANT}' `
      + `GROUP BY ${keyCols.map((_, i) => i + 1).join(',')} HAVING count(*) > 1`);
    if (dups.length) return H.FAIL('F2', `${dups.length} duplicate ${templateCode} key(s), e.g. ${dups[0].slice(0, n).join('/')} ×${dups[0][n]}`);
    return H.PASS('F2', `${templateCode} keys unique on (${keyCols.map((c) => c.replace(/.*'(\w+)'/, '$1')).join(',')}) among active state rows`);
  }));

  // ---- F3: Resolve by (transition, audience, channel, locale) → exactly one, matches delivery ----
  results.push(await H.guard('F3', async () => {
    const t = await H.notifMaster('Template', H.STATE_TENANT);
    if (!t.rows) return H.FAIL('F3', `${templateCode} search returned no rows`);
    // "APPLY / the citizen / SMS / en_IN" — expressed once, matched in either shape.
    const match = t.rows.filter((r) => {
      if (r.active === false) return false;
      if (up(r.channel) !== 'SMS' || String(r.locale) !== 'en_IN') return false;
      const parsed = r.eventName ? H.C.parseEventName(r.eventName) : null;
      const action = parsed ? parsed.action : up(r.action);
      if (action !== 'APPLY') return false;
      const aud = H.C.parseAudience(r.audience);
      return aud.label === 'CITIZEN';
    });
    if (match.length !== 1) return H.FAIL('F3', `expected exactly 1 APPLY/citizen/SMS/en_IN ${templateCode} row, got ${match.length}`);
    const tmplBody = String(match[0].body || '');
    const cmp = await H.ensureComplaint(ctx);
    const msg = cmp.messages.find((m) => m.channel === 'SMS' && /Your complaint for/i.test(m.body));
    if (!msg) return H.PASS('F3', `single template resolves for APPLY/citizen/SMS/en_IN in ${templateCode} (rendered body not retrievable to cross-check)`);
    // The rendered body must be this template with placeholders filled — compare the fixed prefix.
    const prefix = tmplBody.split('{')[0].trim();
    if (prefix && msg.body.startsWith(prefix))
      return H.PASS('F3', `resolver picked the APPLY/citizen/SMS/en_IN template; rendered body matches its prefix "${prefix.slice(0, 40)}…"`);
    return H.FAIL('F3', `rendered body does not match resolved template prefix "${prefix.slice(0, 40)}"`);
  }));

  // ---- F4: No template resolved → skip + honest log ----
  results.push(H.SKIP('F4',
    'no-template-resolved needs a controlled orphan routing key. On the thin-event path it is no longer only a log line: it is a SKIPPED row on the REAL channel with NB_NO_TEMPLATE (see H3 for the row shape). Covered by unit tests (NotificationResolverEdgeCasesTest) / fresh stack'));

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
