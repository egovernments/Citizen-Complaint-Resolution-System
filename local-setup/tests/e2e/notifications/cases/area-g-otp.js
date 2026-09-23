'use strict';
/*
 * Area G — Login OTP through the bridge. user-otp publishes the OTP SMS on
 * egov.core.notification.sms; novu-bridge translates it (CORE_SMS / CORE.SMS.OTP) and
 * delivers it through the tenant's channel policy. SKIPs when the `otp` profile is not
 * running (the Kong mock answers with an empty identity and no row is ever written).
 */
const H = require('../notif-harness');

const OTP_ROWS = (phoneTail) => H.psql(
  `SELECT status, COALESCE(last_error_code,''), COALESCE(provider_response_jsonb::text,''), COALESCE(last_error_message,'') ` +
  `FROM nb_dispatch_log WHERE event_name = 'CORE.SMS.OTP' AND recipient_value LIKE '%${phoneTail}' ` +
  `AND created_time > (EXTRACT(EPOCH FROM now()) * 1000 - 120000) ORDER BY created_time DESC LIMIT 3`);

async function run(ctx) {
  const results = [];
  const phone = H.TEST_PHONE;
  const tail = phone.replace(/\D/g, '').slice(-9);
  let sent = null;

  results.push(await H.guard('G1', async () => {
    const r = await H.post('/user-otp/v1/_send',
      { RequestInfo: H.RI(), otp: { mobileNumber: phone.replace(/^\+\d{1,3}/, ''), tenantId: H.STATE_TENANT || H.TENANT, type: 'login', userType: 'citizen' } },
      { 'Content-Type': 'application/json' });
    if (r.status !== 200) return H.FAIL('G1', `/user-otp/v1/_send returned ${r.status}: ${r.text.slice(0, 120)}`);
    const identity = r.json && r.json.otp && r.json.otp.identity;
    if (!identity) return H.SKIP('G1', 'Kong still answers /user-otp with the mock (empty identity) — otp profile / real OTP not enabled on this box');
    sent = r.json.otp;
    let rows = [];
    for (let i = 0; i < 12 && rows.length === 0; i++) { await H.sleep(2500); rows = OTP_ROWS(tail); }
    if (!rows.length) return H.FAIL('G1', 'no CORE.SMS.OTP row in nb_dispatch_log within 30s — is novu-bridge consuming egov.core.notification.sms?');
    const [status, code] = rows[0];
    if (status === 'SENT') return H.PASS('G1', `OTP SMS SENT through the bridge for ***${tail.slice(-3)}`);
    if (status === 'SKIPPED' && code === 'NB_NO_PROVIDER') return H.PASS('G1', 'OTP row present as SKIPPED/NB_NO_PROVIDER (SMS disabled for the tenant) — honest, not silent');
    return H.FAIL('G1', `unexpected OTP row status=${status} code=${code}`);
  }));

  results.push(await H.guard('G2', async () => {
    if (!sent) return H.SKIP('G2', 'G1 did not produce an OTP send');
    const rows = OTP_ROWS(tail);
    if (!rows.length) return H.SKIP('G2', 'no OTP row to inspect');
    const leak = rows.some(([, , receipt, err]) => /\b\d{6}\b/.test(receipt) || /\b\d{6}\b/.test(err));
    return leak ? H.FAIL('G2', 'a 6-digit code appears in provider_response/last_error_message of the OTP row')
                : H.PASS('G2', 'OTP row stores no 6-digit code (body is not persisted)');
  }));

  return results;
}

module.exports = { run };
