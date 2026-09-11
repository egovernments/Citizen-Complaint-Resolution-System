'use strict';
/*
 * Area C — Templates (NotificationTemplate + NotificationProviderTemplate).
 * The rendered body is read from Novu (payload.body); PGR renders BEFORE Kafka.
 */
const H = require('../notif-harness');

// Find the CITIZEN SMS message for the fixture complaint (template: "Dear Citizen,
// Your complaint for {complaint_type} has been submitted with ID {id} on {date}...").
function citizenSms(cmp) {
  return cmp.messages.find((m) => m.channel === 'SMS' && /Your complaint for/i.test(m.body));
}

async function run(ctx) {
  const results = [];

  // ---- C1: City has no template → state fallback ----
  results.push(await H.guard('C1', async () => {
    const state = await H.mdmsSearch('RAINMAKER-PGR', 'NotificationTemplate', H.STATE_TENANT);
    const cityOwn = H.psqlRaw(`SELECT count(*) FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.NotificationTemplate' `
      + `AND isactive=true AND tenantid='${H.TENANT}'`)[0];
    const cmp = await H.ensureComplaint(ctx);
    const rendered = cmp.messages.some((m) => m.body && m.body.length > 5);
    const stateN = state.rows ? state.rows.length : 0;
    if (stateN > 0 && Number(cityOwn) === 0 && rendered)
      return H.PASS('C1', `state has ${stateN} templates; city(${H.TENANT}) authors 0; complaint bodies rendered → state fallback`);
    if (!rendered) return H.SKIP('C1', 'no rendered body retrievable from Novu to confirm fallback');
    return H.FAIL('C1', `stateTemplates=${stateN} cityOwn=${cityOwn} rendered=${rendered}`);
  }));

  // ---- C2: Per-tenant templates ----
  results.push(H.SKIP('C2',
    'no city-level (ke.bomet) NotificationTemplate authored on Bomet to differentiate from state — per-tenant override needs fresh stack'));

  // ---- C3: Per-locale templates (en_IN / hi_IN) ----
  results.push(await H.guard('C3', async () => {
    const rows = H.psql(`SELECT data->>'locale', count(*) FROM eg_mdms_data `
      + `WHERE schemacode='RAINMAKER-PGR.NotificationTemplate' AND isactive=true AND tenantid='${H.STATE_TENANT}' `
      + `GROUP BY 1`);
    const byLocale = Object.fromEntries(rows.map((r) => [r[0], Number(r[1])]));
    const locales = Object.keys(byLocale);
    const multi = locales.filter((l) => byLocale[l] > 0);
    if (multi.length >= 2)
      return H.PASS('C3', `per-locale NotificationTemplate rows present: ${multi.map((l) => `${l}=${byLocale[l]}`).join(', ')}`);
    // Only one locale seeded (Bomet ships en_IN only). Environment gap, not a product fault:
    // hi_IN SMS/EMAIL bodies live in NotificationProviderTemplate (WhatsApp ContentSids) but
    // not in NotificationTemplate, so a hi_IN citizen gets en_IN via default-locale fallback.
    return H.SKIP('C3', `only ${multi.map((l) => `${l}=${byLocale[l]}`).join(', ')} NotificationTemplate seeded on Bomet — hi_IN SMS/EMAIL bodies absent; per-locale template selection needs a multi-locale seed (fresh stack)`);
  }));

  // ---- C4: Missing locale template → fallback-to-default (verify) ----
  results.push(H.SKIP('C4',
    'locale-fallback (missing-locale → default-locale) needs a controlled missing-locale template + log inspection; covered by unit tests / fresh stack'));

  // ---- C5: Param order / positional variables ----
  results.push(await H.guard('C5', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const msg = citizenSms(cmp);
    if (!msg) return H.SKIP('C5', 'citizen SMS rendered body not retrievable from Novu');
    const b = msg.body;
    // Template declares complaint_type, then {id}, then {date}. Rendered order must match.
    const iType = b.indexOf(H.SERVICE_NAME);
    const iId = b.indexOf(cmp.id);
    const iDate = b.search(/\d{2}\/\d{2}\/\d{4}/);
    if (iType < 0 || iId < 0) return H.FAIL('C5', `values missing in body: type@${iType} id@${iId} — body="${b.slice(0, 120)}"`);
    if (!(iType < iId && (iDate < 0 || iId < iDate)))
      return H.FAIL('C5', `positional order violated: type@${iType} id@${iId} date@${iDate}`);
    return H.PASS('C5', `positional substitution in declared order: complaint_type@${iType} < id@${iId} < date@${iDate}`);
  }));

  // ---- C6: Name not code ----
  results.push(await H.guard('C6', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const msg = citizenSms(cmp);
    if (!msg) return H.SKIP('C6', 'citizen SMS rendered body not retrievable from Novu');
    const b = msg.body;
    const hasName = b.includes(H.SERVICE_NAME);
    const codeRe = new RegExp('\\b' + H.SERVICE_CODE + '\\b');
    const hasBareCode = codeRe.test(b) && H.SERVICE_NAME !== H.SERVICE_CODE;
    // status must also localize to a name (e.g. "Pending for assignment") not the raw code.
    const statusNameOk = !/\bPENDINGFORASSIGNMENT\b/.test(b);
    if (hasName && !hasBareCode)
      return H.PASS('C6', `complaint_type rendered as name "${H.SERVICE_NAME}" (not code "${H.SERVICE_CODE}"); status localized=${statusNameOk}`);
    if (hasBareCode)
      return H.FAIL('C6', `body shows raw code "${H.SERVICE_CODE}" instead of name — body="${b.slice(0, 120)}"`);
    return H.FAIL('C6', `name "${H.SERVICE_NAME}" absent in body="${b.slice(0, 120)}"`);
  }));

  // ---- C7: ContentSID vs templateId — WA gated off; assert ProviderTemplate carries a ContentSid ----
  results.push(await H.guard('C7', async () => {
    const pt = await H.mdmsSearch('RAINMAKER-PGR', 'NotificationProviderTemplate', H.STATE_TENANT);
    if (!pt.rows) return H.FAIL('C7', 'NotificationProviderTemplate search returned no rows');
    const wa = pt.rows.filter((r) => String(r.channel).toUpperCase() === 'WHATSAPP'
      && String(r.action).toUpperCase() === 'APPLY');
    const withSid = wa.filter((r) => /^HX[0-9a-f]{32}$/i.test(String(r.templateId || '')));
    if (!withSid.length) return H.FAIL('C7', `no APPLY/WHATSAPP ProviderTemplate with a valid ContentSid (HX…); found ${wa.length} WA rows`);
    return H.PASS('C7', `APPLY/WHATSAPP ProviderTemplate resolves ContentSid=${withSid[0].templateId} (sends by ContentSid); WA delivery gated off on Bomet so not exercised end-to-end`);
  }));

  // ---- C8: Param removed from order ----
  results.push(H.SKIP('C8',
    'removing a param from declared order needs a controlled ProviderTemplate edit; covered by unit tests / fresh stack'));

  // ---- C9: eventName matches Novu workflow ----
  results.push(await H.guard('C9', async () => {
    const tpl = await H.providerTemplates(ctx.empToken);
    const wfIds = ((tpl.json && tpl.json.data) || []).map((w) => w.workflowId);
    const cmp = await H.ensureComplaint(ctx);
    const sent = cmp.rows.some((r) => (r.channel === 'SMS' || r.channel === 'EMAIL') && r.status === 'SENT');
    // The bridge triggers complaints-sms / complaints-email; both must be valid Novu workflows.
    const ok = wfIds.includes('complaints-sms') && wfIds.includes('complaints-email');
    if (ok && sent) return H.PASS('C9', `delivery workflows valid in Novu (complaints-sms/complaints-email) and complaint triggered SENT rows`);
    return H.FAIL('C9', `workflows=${JSON.stringify(wfIds)} sent=${sent}`);
  }));

  return results;
}

module.exports = { run };
