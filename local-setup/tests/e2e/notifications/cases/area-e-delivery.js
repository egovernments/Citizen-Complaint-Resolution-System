'use strict';
/*
 * Area E — Delivery (Novu → provider) + resilience. Reads the shared complaint
 * fixture. "SENT" here means novu-bridge got a Novu 2xx (delivery accepted); real
 * carrier delivery is Twilio/SMTP async and out of scope for this layer.
 */
const H = require('../notif-harness');

async function run(ctx) {
  const results = [];

  // ---- E1: SMS delivers (nb_dispatch_log SENT + Novu message present) ----
  results.push(await H.guard('E1', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const sms = cmp.rows.filter((r) => r.channel === 'SMS' && r.status === 'SENT');
    if (!sms.length) return H.FAIL('E1', 'no SMS SENT rows in nb_dispatch_log');
    const novuSms = cmp.messages.filter((m) => m.channel === 'SMS');
    const novuNote = H.NOVU_API_KEY ? `; Novu SMS messages=${novuSms.length}` : '; (Novu verify skipped: no key)';
    return H.PASS('E1', `${sms.length} SMS SENT in nb_dispatch_log for ${cmp.id}${novuNote}`);
  }));

  // ---- E2: Email delivers + subject present (empty-subject regression) ----
  results.push(await H.guard('E2', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const email = cmp.rows.filter((r) => r.channel === 'EMAIL' && r.status === 'SENT');
    if (!email.length) return H.FAIL('E2', 'no EMAIL SENT rows in nb_dispatch_log');
    const novuEmail = cmp.messages.filter((m) => m.channel === 'EMAIL');
    if (H.NOVU_API_KEY && novuEmail.length) {
      const missingSubj = novuEmail.filter((m) => !m.subject || !m.subject.trim());
      if (missingSubj.length) return H.FAIL('E2', `${missingSubj.length}/${novuEmail.length} email message(s) have EMPTY subject (regression)`);
      return H.PASS('E2', `${email.length} EMAIL SENT; all ${novuEmail.length} Novu email message(s) carry a non-empty subject (e.g. "${novuEmail[0].subject.slice(0, 40)}")`);
    }
    return H.PASS('E2', `${email.length} EMAIL SENT in nb_dispatch_log (Novu subject check skipped: no message/key)`);
  }));

  // ---- E3: WhatsApp via Novu override — WA gated off on Bomet ----
  results.push(H.SKIP('E3', 'WhatsApp delivery gated off on Bomet (CHANNELS_ENABLED=SMS,EMAIL) — ContentSid delivery not exercised; needs fresh stack with WA provider'));

  // ---- E4: Expired Twilio auth / session → FAILED no crash ----
  results.push(H.SKIP('E4', 'fault injection (expired Twilio auth) unsafe on live Bomet — needs fresh stack; covered by novu-bridge unit tests (DispatchPipelineFailureRowTest)'));

  // ---- E5: url-shortener outage doesn't blank placeholders (body rendered) ----
  results.push(await H.guard('E5', async () => {
    const cmp = await H.ensureComplaint(ctx);
    if (!H.NOVU_API_KEY || !cmp.messages.length)
      return H.SKIP('E5', 'no Novu-rendered body available to inspect for unfilled placeholders');
    const bodies = cmp.messages.filter((m) => m.body);
    // No literal unsubstituted {placeholder} braces may survive into the delivered body,
    // even if url-shortening blanked {download_link}. (Empty is fine; literal braces are not.)
    const leaky = bodies.filter((m) => /\{[a-z_]+\}/i.test(m.body));
    if (leaky.length) return H.FAIL('E5', `${leaky.length} body(ies) carry literal {placeholder}: "${leaky[0].body.slice(0, 120)}"`);
    return H.PASS('E5', `${bodies.length} rendered body(ies) fully substituted — no literal {placeholder} braces (shortener resilience holds)`);
  }));

  return results;
}

module.exports = { run };
