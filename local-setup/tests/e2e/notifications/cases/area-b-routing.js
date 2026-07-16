'use strict';
/*
 * Area B — Routing & channel config (MDMS NotificationRouting + channel gate).
 * Reads the shared complaint fixture; non-mutating.
 */
const H = require('../notif-harness');

async function run(ctx) {
  const results = [];

  // ---- B1: City has no routing → falls back to state ----
  results.push(await H.guard('B1', async () => {
    const state = await H.mdmsSearch('RAINMAKER-PGR', 'NotificationRouting', H.STATE_TENANT);
    const city = await H.mdmsSearch('RAINMAKER-PGR', 'NotificationRouting', H.TENANT);
    const stateN = state.rows ? state.rows.length : 0;
    // MDMS inherits root → a city read returns the inherited rows. The distinguishing
    // fact is that NO routing row is authored AT the city tenant, yet complaints dispatch.
    const cityOwn = H.psqlRaw(`SELECT count(*) FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.NotificationRouting' `
      + `AND isactive=true AND tenantid='${H.TENANT}'`)[0];
    const cmp = await H.ensureComplaint(ctx);
    const dispatched = cmp.rows.length > 0;
    if (stateN > 0 && Number(cityOwn) === 0 && dispatched)
      return H.PASS('B1', `state(${H.STATE_TENANT}) has ${stateN} routing rows; city(${H.TENANT}) authors 0; complaint ${cmp.id} still dispatched ${cmp.rows.length} rows → state fallback`);
    return H.FAIL('B1', `stateRows=${stateN} cityOwnRows=${cityOwn} dispatched=${dispatched}`);
  }));

  // ---- B2: Disable a channel (routing active=false) → no dispatch ----
  results.push(H.SKIP('B2',
    'needs fresh stack — requires flipping a NotificationRouting row to active=false + pgr-services restart to drop routing cache; unsafe on live Bomet'));

  // ---- B3: Per-audience × channel fan-out ----
  results.push(await H.guard('B3', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const rows = cmp.rows;
    // APPLY routing @ ke: CITIZEN(SMS,EMAIL,WHATSAPP) + GRO(SMS).
    const citizenRows = rows.filter((r) => r.uuid === cmp.citizenUuid);
    const citizenCh = new Set(citizenRows.map((r) => r.channel));
    const groSms = rows.filter((r) => r.channel === 'SMS' && r.uuid && r.uuid !== cmp.citizenUuid
      && H.rolesOf(r.uuid).has('GRO'));
    const okCitizen = citizenCh.has('SMS') && citizenCh.has('EMAIL');
    const okGro = groSms.length > 0;
    if (okCitizen && okGro)
      return H.PASS('B3', `fan-out: CITIZEN channels={${[...citizenCh].join(',')}}, GRO(SMS) recipients=${groSms.length} → per-audience×channel routing honored`);
    return H.FAIL('B3', `okCitizen=${okCitizen} (channels ${[...citizenCh].join(',')}) okGro=${okGro} (gro sms ${groSms.length})`);
  }));

  // ---- B4: WhatsApp gated off → WA rows SKIPPED/NB_NO_PROVIDER, no SMS fallback ----
  results.push(await H.guard('B4', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const wa = cmp.rows.filter((r) => r.channel === 'WHATSAPP');
    if (!wa.length) return H.FAIL('B4', 'no WHATSAPP rows at all (expected SKIPPED/NB_NO_PROVIDER for CITIZEN)');
    const bad = wa.filter((r) => r.status !== 'SKIPPED' || (r.lastError || '') !== 'NB_NO_PROVIDER');
    if (bad.length) return H.FAIL('B4', `WA rows not all SKIPPED/NB_NO_PROVIDER: ${bad.map((r) => r.status + '/' + r.lastError).join(',')}`);
    // No SMS row may carry a :WHATSAPP txn suffix (no SMS fallback).
    const smuggled = cmp.rows.filter((r) => r.channel === 'SMS' && (r.txn || '').toUpperCase().endsWith(':WHATSAPP'));
    if (smuggled.length) return H.FAIL('B4', `${smuggled.length} SMS row(s) end in :WHATSAPP — WA smuggled via SMS`);
    return H.PASS('B4', `${wa.length} WHATSAPP row(s) all SKIPPED/NB_NO_PROVIDER; no SMS fallback (CHANNELS_ENABLED=SMS,EMAIL)`);
  }));

  return results;
}

module.exports = { run };
