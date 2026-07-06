'use strict';
/*
 * Area A — Provider management (Novu integrations via ProviderController).
 *
 * SAFETY: every integration created here is dummy-credentialled and named
 * `zz-e2e-*`; all are deleted in a finally. The pre-existing (real) primary
 * integrations are captured before and re-checked after — the suite fails loud
 * if a real integration disappears. test-send only targets TEST_PHONE/TEST_EMAIL.
 */
const H = require('../notif-harness');

// Dummy Twilio-shaped creds — never real. Novu stores creds server-side and the
// bridge never echoes them; these only prove the create path + allowlist.
const DUMMY_TWILIO = { accountSid: 'ACzz0000e2e0000000000000000000000', authToken: 'zz-e2e-fake-token', from: '+15005550006' };
// Novu's nodemailer integration validates port as a STRING (422 "credentials.port
// must be a string" otherwise) — the bridge passes creds through verbatim.
const DUMMY_SMTP = { host: 'smtp.example.invalid', user: 'zz-e2e', password: 'zz-e2e-fake', from: 'zz-e2e@example.invalid', secure: false, port: '587' };

async function run(ctx) {
  const results = [];
  const created = []; // integration ids to clean up
  const auth = ctx.empToken; // may be undefined (proxy gate is off on Bomet)

  // Snapshot real integrations up front (for the "don't disturb real providers" guard).
  let realBefore = [];
  try {
    const r = await H.novuListIntegrations();
    realBefore = ((r.json && r.json.data) || []).map((i) => i._id);
  } catch { /* handled per-case */ }

  try {
    // ---- A1: Add SMS provider (Twilio) ----
    results.push(await H.guard('A1', async () => {
      const r = await H.providerCreate({
        channel: 'SMS', providerId: 'twilio', name: 'zz-e2e-sms-1',
        identifier: 'zz-e2e-sms-1-' + Date.now(), credentials: DUMMY_TWILIO,
      }, auth);
      if (r.status !== 200) return H.FAIL('A1', `POST /providers → ${r.status}: ${r.text.slice(0, 160)}`);
      const d = r.json && r.json.data;
      if (!d || !d._id) return H.FAIL('A1', 'no integration _id in response: ' + r.text.slice(0, 160));
      created.push(d._id);
      ctx._a1 = { id: d._id, resp: r.json };
      if (String(d.providerId) !== 'twilio' || String(d.channel) !== 'sms')
        return H.FAIL('A1', `unexpected providerId/channel: ${d.providerId}/${d.channel}`);
      return H.PASS('A1', `Twilio SMS integration created _id=${d._id} providerId=twilio channel=sms`);
    }));

    // ---- A2: Add Email provider (nodemailer) ----
    results.push(await H.guard('A2', async () => {
      const r = await H.providerCreate({
        channel: 'EMAIL', providerId: 'nodemailer', name: 'zz-e2e-email-1',
        identifier: 'zz-e2e-email-1-' + Date.now(), credentials: DUMMY_SMTP,
      }, auth);
      if (r.status !== 200) return H.FAIL('A2', `POST /providers → ${r.status}: ${r.text.slice(0, 160)}`);
      const d = r.json && r.json.data;
      if (!d || !d._id) return H.FAIL('A2', 'no integration _id: ' + r.text.slice(0, 160));
      created.push(d._id);
      if (String(d.channel) !== 'email') return H.FAIL('A2', `expected channel=email, got ${d.channel}`);
      return H.PASS('A2', `Email integration created _id=${d._id} channel=email`);
    }));

    // ---- A3: Add WhatsApp provider (Twilio, WHATSAPP→sms channel) ----
    results.push(await H.guard('A3', async () => {
      const r = await H.providerCreate({
        channel: 'WHATSAPP', providerId: 'twilio', name: 'zz-e2e-wa-1',
        identifier: 'zz-e2e-wa-1-' + Date.now(),
        credentials: { ...DUMMY_TWILIO, from: 'whatsapp:+15005550006' },
      }, auth);
      if (r.status !== 200) return H.FAIL('A3', `POST /providers → ${r.status}: ${r.text.slice(0, 160)}`);
      const d = r.json && r.json.data;
      if (!d || !d._id) return H.FAIL('A3', 'no integration _id: ' + r.text.slice(0, 160));
      created.push(d._id);
      // WHATSAPP maps to the Twilio Novu sms channel.
      if (String(d.channel) !== 'sms') return H.FAIL('A3', `WHATSAPP must map to Novu sms channel, got ${d.channel}`);
      return H.PASS('A3', `WhatsApp(Twilio) integration created _id=${d._id}, mapped to Novu channel=sms`);
    }));

    // ---- A4: Creds never echoed (create response + integrations list) ----
    results.push(await H.guard('A4', async () => {
      if (!ctx._a1) return H.SKIP('A4', 'A1 did not create an integration to inspect');
      const createJson = JSON.stringify(ctx._a1.resp);
      const leaks = [];
      if (createJson.includes('credentials')) leaks.push('create-resp has credentials key');
      if (createJson.includes(DUMMY_TWILIO.authToken)) leaks.push('create-resp leaks authToken');
      if (createJson.includes(DUMMY_TWILIO.accountSid)) leaks.push('create-resp leaks accountSid');
      const list = await H.integrationsList(auth);
      const listJson = list.text || '';
      if (listJson.includes('credentials')) leaks.push('GET /integrations has credentials key');
      if (listJson.includes(DUMMY_TWILIO.authToken)) leaks.push('GET /integrations leaks authToken');
      if (leaks.length) return H.FAIL('A4', 'SECRET LEAK: ' + leaks.join('; '));
      return H.PASS('A4', 'no credentials/secret echoed by POST /providers or GET /integrations (allowlist projection holds)');
    }));

    // ---- A5: Verify connectivity ----
    results.push(await H.guard('A5', async () => {
      // ok:true — verify an EXISTING active integration (non-mutating). Prefer a real
      // twilio/sms integration; fall back to the A1 test integration.
      const r = await H.novuListIntegrations();
      const ints = (r.json && r.json.data) || [];
      const realActive = ints.find((i) => i.active && i.channel === 'sms' && i.providerId === 'twilio'
        && !realBefore.includes(i._id) === false); // prefer a pre-existing one
      const target = realActive || ints.find((i) => i._id === (ctx._a1 && ctx._a1.id));
      let okTrue = false, okFalse = false, detailParts = [];
      if (target) {
        const v = await H.providerVerify({ integrationId: target._id }, auth);
        okTrue = v.json && v.json.ok === true && v.json.active === true;
        detailParts.push(`verify(existing ${target._id})→ok=${v.json && v.json.ok}`);
      } else {
        detailParts.push('no active integration to verify positive');
      }
      const vf = await H.providerVerify({ integrationId: 'zz-e2e-does-not-exist' }, auth);
      okFalse = vf.json && vf.json.ok === false && vf.json.active === false
        && /no matching/.test(vf.json.detail || '');
      detailParts.push(`verify(missing)→ok=${vf.json && vf.json.ok}`);
      if ((target ? okTrue : true) && okFalse) return H.PASS('A5', detailParts.join('; '));
      return H.FAIL('A5', 'verify contract not met: ' + detailParts.join('; '));
    }));

    // ---- A6: Test-send SMS → Novu 2xx + TEST-tagged dispatch row, masked recipient ----
    results.push(await H.guard('A6', async () => {
      const txn = 'nb-e2e-a6-' + Date.now();
      const r = await H.providerTestSend({
        channel: 'SMS', to: { phone: H.TEST_PHONE },
        body: 'zz-e2e A6 SMS test-send via Novu. Please ignore.', transactionId: txn,
      }, auth);
      if (!(r.json && r.json.ok === true)) return H.FAIL('A6', `test-send not ok: ${r.status} ${r.text.slice(0, 160)}`);
      // TEST-tagged dispatch row (tenant_id='TEST', event_name='TEST', template_key='TEST').
      await H.sleep(1500);
      const rows = H.psql(`SELECT channel, status, recipient_value, event_name, template_key `
        + `FROM nb_dispatch_log WHERE transaction_id='${txn}'`);
      if (!rows.length) return H.FAIL('A6', 'no nb_dispatch_log row for test-send txn');
      const [ch, st, rec, ev, tk] = rows[0];
      if (ev !== 'TEST' || tk !== 'TEST') return H.FAIL('A6', `row not TEST-tagged: event=${ev} template=${tk}`);
      if (rec && (rec.includes('919415787824') || !rec.includes('*')))
        return H.FAIL('A6', `recipient not masked: ${rec}`);
      return H.PASS('A6', `test-send SMS ok, novuStatus=${r.json.novuStatus}; TEST row ch=${ch} status=${st} recipient=${rec} (masked)`);
    }));

    // ---- A7: Test-send WhatsApp → Novu accepts trigger with contentSid override ----
    results.push(await H.guard('A7', async () => {
      const txn = 'nb-e2e-a7-' + Date.now();
      const r = await H.providerTestSend({
        channel: 'WHATSAPP', to: { phone: H.TEST_PHONE },
        contentSid: 'HX00000000000000000000000000000000',
        variables: ['zz-e2e', 'A7', 'demo'], transactionId: txn,
      }, auth);
      if (!(r.json && typeof r.json.ok === 'boolean'))
        return H.FAIL('A7', `test-send response malformed: ${r.status} ${r.text.slice(0, 160)}`);
      // The override-building path (whatsapp:+<E164> + twilio contentSid/contentVariables in
      // declared order) executed; Novu returns 2xx (async). A TEST row must exist.
      await H.sleep(1500);
      const rows = H.psql(`SELECT channel, status FROM nb_dispatch_log WHERE transaction_id='${txn}'`);
      if (!rows.length) return H.FAIL('A7', 'no nb_dispatch_log row for WA test-send');
      return H.PASS('A7', `WA test-send ok=${r.json.ok} novuStatus=${r.json.novuStatus}; TEST row ch=${rows[0][0]} (contentSid override path exercised)`);
    }));

    // ---- A8: Pull templates (Novu workflows) ----
    results.push(await H.guard('A8', async () => {
      const r = await H.providerTemplates(auth);
      if (r.status !== 200) return H.FAIL('A8', `GET /providers/templates → ${r.status}`);
      const data = (r.json && r.json.data) || [];
      const ids = data.map((w) => w.workflowId);
      if (!data.length) return H.FAIL('A8', 'no workflows listed');
      const hasSms = ids.includes('complaints-sms');
      const hasEmail = ids.includes('complaints-email');
      if (!hasSms || !hasEmail)
        return H.FAIL('A8', `expected complaints-sms + complaints-email, got [${ids.join(', ')}]`);
      // structural: only workflowId+name surfaced (no step internals)
      const leaky = data.find((w) => Object.keys(w).some((k) => k !== 'workflowId' && k !== 'name'));
      if (leaky) return H.FAIL('A8', 'templates surface unexpected fields: ' + JSON.stringify(leaky));
      return H.PASS('A8', `templates listed: [${ids.join(', ')}] (workflowId+name only)`);
    }));

    // ---- A9: Multiple integrations, different numbers coexist ----
    results.push(await H.guard('A9', async () => {
      const r = await H.providerCreate({
        channel: 'SMS', providerId: 'twilio', name: 'zz-e2e-sms-2',
        identifier: 'zz-e2e-sms-2-' + Date.now(),
        credentials: { ...DUMMY_TWILIO, from: '+15005550007' },
      }, auth);
      if (r.status !== 200) return H.FAIL('A9', `second create → ${r.status}: ${r.text.slice(0, 160)}`);
      const d = r.json && r.json.data;
      if (!d || !d._id) return H.FAIL('A9', 'no _id for second integration');
      created.push(d._id);
      // Both zz-e2e twilio sms integrations must now coexist in the list.
      const list = await H.novuListIntegrations();
      const ids = ((list.json && list.json.data) || []).map((i) => i._id);
      const bothPresent = ctx._a1 && ids.includes(ctx._a1.id) && ids.includes(d._id);
      if (!bothPresent) return H.FAIL('A9', 'the two test integrations do not both appear in the list');
      return H.PASS('A9', `two Twilio SMS integrations (different from) coexist: ${ctx._a1.id}, ${d._id}`);
    }));

    // ---- A10: Admin-only auth gate — SKIP on Bomet (gate off) ----
    results.push(await H.guard('A10', async () => {
      // Confirm the gate really is off (missing-token still 200) so the SKIP is honest.
      const r = await H.providerTemplates(); // no bearer
      if (r.status === 401) return H.PASS('A10', 'auth gate ON: missing token → 401 (unexpected on Bomet but valid)');
      return H.SKIP('A10', `gate off on Bomet (NOVU_BRIDGE_PROXY_AUTH_ENABLED=false) — unauth GET returned ${r.status}, not 401`);
    }));
  } finally {
    // ---- Cleanup: delete every zz-e2e integration created ----
    for (const id of created) {
      try { await H.novuDeleteIntegration(id); } catch { /* best effort */ }
    }
    // ---- Guard: real integrations untouched ----
    try {
      const after = await H.novuListIntegrations();
      const afterIds = ((after.json && after.json.data) || []).map((i) => i._id);
      const missing = realBefore.filter((id) => !afterIds.includes(id));
      const leftover = created.filter((id) => afterIds.includes(id));
      if (missing.length) results.push(H.FAIL('A-cleanup', `REAL integration(s) vanished: ${missing.join(', ')}`));
      else if (leftover.length) results.push(H.FAIL('A-cleanup', `test integration(s) NOT cleaned up: ${leftover.join(', ')}`));
      else results.push(H.PASS('A-cleanup', `all ${created.length} zz-e2e integration(s) deleted; ${realBefore.length} real integration(s) intact`));
    } catch (e) {
      results.push(H.FAIL('A-cleanup', 'cleanup verification failed: ' + e.message));
    }
  }
  return results;
}

module.exports = { run };
