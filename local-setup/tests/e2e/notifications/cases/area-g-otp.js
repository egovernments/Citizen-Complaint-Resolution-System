'use strict';
/*
 * Area G — Login OTP through the bridge. user-otp publishes the OTP SMS on
 * egov.core.notification.sms; novu-bridge translates it (CORE_SMS / CORE.SMS.OTP) and
 * delivers it through the tenant's channel policy. SKIPs when the `otp` profile is not
 * running (the Kong mock answers with an empty identity and no row is ever written).
 */
const H = require('../notif-harness');

// Rows for the WHOLE national number, not a tail of it: a tail short enough to survive a
// mangled number (the old 9-digit tail matched both 9415787824 and 415787824) lets the
// assertion agree with the bug it should catch.
const OTP_ROWS = (national) => H.psql(
  `SELECT status, COALESCE(last_error_code,''), COALESCE(provider_response_jsonb::text,''), COALESCE(last_error_message,''), recipient_value ` +
  `FROM nb_dispatch_log WHERE event_name = 'CORE.SMS.OTP' AND recipient_value LIKE '%${national}' ` +
  `AND created_time > (EXTRACT(EPOCH FROM now()) * 1000 - 120000) ORDER BY created_time DESC LIMIT 3`);

async function run(ctx) {
  const results = [];
  const national = H.TEST_PHONE_NATIONAL;
  let sent = null;

  results.push(await H.guard('G1', async () => {
    // The number sent must be exactly the configured national number: guards the
    // derivation itself (a greedy country-code strip took one digit too many).
    if (H.TEST_PHONE_NATIONAL_ERROR) return H.FAIL('G1', H.TEST_PHONE_NATIONAL_ERROR);
    if (!/^\d{6,14}$/.test(national) || !H.TEST_PHONE.replace(/\D/g, '').endsWith(national)) {
      return H.FAIL('G1', `national number ${national} is not the tail of TEST_PHONE ${H.TEST_PHONE} — check TEST_PHONE_COUNTRY_CODE / TEST_PHONE_NATIONAL`);
    }
    const r = await H.post('/user-otp/v1/_send',
      { RequestInfo: H.RI(), otp: { mobileNumber: national, tenantId: H.STATE_TENANT || H.TENANT, type: 'login', userType: 'citizen' } },
      { 'Content-Type': 'application/json' });
    if (r.status !== 200) return H.FAIL('G1', `/user-otp/v1/_send returned ${r.status}: ${r.text.slice(0, 120)}`);
    const identity = r.json && r.json.otp && r.json.otp.identity;
    if (!identity) return H.SKIP('G1', 'Kong still answers /user-otp with the mock (empty identity) — otp profile / real OTP not enabled on this box');
    sent = r.json.otp;
    let rows = [];
    for (let i = 0; i < 12 && rows.length === 0; i++) { await H.sleep(2500); rows = OTP_ROWS(national); }
    if (!rows.length) return H.FAIL('G1', `no CORE.SMS.OTP row for ***${national.slice(-3)} (all ${national.length} digits) in nb_dispatch_log within 30s — is novu-bridge consuming egov.core.notification.sms, and did the OTP go to this number?`);
    const [status, code, , , recipient] = rows[0];
    // The ledger's recipient must END WITH the whole national number and carry nothing but
    // an optional country code in front of it — not merely share a tail with it.
    const recipientDigits = String(recipient || '').split(':').pop().replace(/\D/g, '');
    const prefix = recipientDigits.slice(0, recipientDigits.length - national.length);
    if (!recipientDigits.endsWith(national) || (prefix && prefix !== H.TEST_PHONE_COUNTRY_CODE)) {
      return H.FAIL('G1', `OTP row recipient ***${recipientDigits.slice(-4)} is not ${H.TEST_PHONE_COUNTRY_CODE ? '(+' + H.TEST_PHONE_COUNTRY_CODE + ') ' : ''}***${national.slice(-4)}`);
    }
    if (status === 'SENT') return H.PASS('G1', `OTP SMS SENT through the bridge for ***${national.slice(-3)}`);
    if (status === 'SKIPPED' && code === 'NB_NO_PROVIDER') return H.PASS('G1', 'OTP row present as SKIPPED/NB_NO_PROVIDER (SMS disabled for the tenant) — honest, not silent');
    return H.FAIL('G1', `unexpected OTP row status=${status} code=${code}`);
  }));

  results.push(await H.guard('G2', async () => {
    if (!sent) return H.SKIP('G2', 'G1 did not produce an OTP send');
    const rows = OTP_ROWS(national);
    if (!rows.length) return H.SKIP('G2', 'no OTP row to inspect');
    const leak = rows.some(([, , receipt, err]) => /\b\d{6}\b/.test(receipt) || /\b\d{6}\b/.test(err));
    return leak ? H.FAIL('G2', 'a 6-digit code appears in provider_response/last_error_message of the OTP row')
                : H.PASS('G2', 'OTP row stores no 6-digit code (body is not persisted)');
  }));

  return results;
}

module.exports = { run };
