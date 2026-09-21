'use strict';
/*
 * Area B — Routing & channel config (the routing master + the channel gate).
 * Reads the shared complaint fixture; non-mutating.
 *
 * Which routing master is read is NOT hardcoded here: it comes from the harness's
 * single per-tenant rule (`H.notificationSource()` / `H.notifMaster('Routing')`),
 * so these cases are correct on a tenant that has been copied to NOTIFICATIONS.*
 * and on one still served its legacy RAINMAKER-PGR.Notification* rows.
 */
const H = require('../notif-harness');

async function run(ctx) {
  const results = [];
  const src = H.notificationSource();
  const routingCode = H.notifSchemaCode('Routing');

  // ---- B1: City has no routing → falls back to state ----
  results.push(await H.guard('B1', async () => {
    const state = await H.notifMaster('Routing', H.STATE_TENANT);
    const stateN = state.rows ? state.rows.length : 0;
    // MDMS inherits root → a city read returns the inherited rows. The distinguishing
    // fact is that NO routing row is authored AT the city tenant, yet complaints dispatch.
    const cityOwn = H.mdmsRowCount(routingCode, H.TENANT);
    const cmp = await H.ensureComplaint(ctx);
    const dispatched = cmp.rows.length > 0;
    if (stateN > 0 && cityOwn === 0 && dispatched)
      return H.PASS('B1', `${routingCode}: state(${H.STATE_TENANT}) has ${stateN} rows; city(${H.TENANT}) authors 0; complaint ${cmp.id} still dispatched ${cmp.rows.length} rows → state fallback [source: ${src.label}]`);
    return H.FAIL('B1', `${routingCode} stateRows=${stateN} cityOwnRows=${cityOwn} dispatched=${dispatched}`);
  }));

  // ---- B2: Disable a channel (routing active=false) → no dispatch ----
  results.push(H.SKIP('B2',
    `needs fresh stack — requires flipping a ${routingCode} row to active=false (+ a pgr-services restart on the pre-move path to drop the routing cache); unsafe on live Bomet`));

  // ---- B3: Per-audience × channel fan-out ----
  results.push(await H.guard('B3', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const rows = cmp.rows;
    const master = await H.notifMaster('Routing', H.STATE_TENANT);
    // What the tenant's own routing rows say about APPLY, rather than a hardcoded
    // "CITIZEN(SMS,EMAIL,WHATSAPP) + GRO(SMS)" that was only ever true on one seed.
    const expect = H.C.buildExpectRows({
      source: src.source,
      rows: master.rows || [],
      businessService: H.BUSINESS_SERVICE,
    }).rows;
    const specs = H.C.specsFor(expect, 'APPLY', 'PENDINGFORASSIGNMENT');
    if (!specs.length) return H.SKIP('B3', `no APPLY routing rows in ${routingCode} to fan out`);

    const rowCtx = { citizenUuid: cmp.citizenUuid, assigneeUuid: null, rolesOf: H.rolesOf };
    const covered = [];
    const missing = [];
    for (const spec of specs) {
      for (const ch of spec.channels) {
        const hit = rows.some((r) => r.channel === ch && H.C.rowMatchesAudience(spec.terms, r, rowCtx));
        (hit ? covered : missing).push(`${spec.label}/${ch}`);
      }
    }
    if (!missing.length)
      return H.PASS('B3', `per-audience×channel fan-out honored for every routed tuple: ${covered.join(', ')}`);
    // An audience with nobody in this tenant is a legitimate empty, not a fan-out fault;
    // it is named rather than folded away.
    return H.FAIL('B3', `no dispatch row for ${missing.join(', ')} (covered: ${covered.join(', ') || 'none'})`);
  }));

  // ---- B4: WhatsApp — the outcome the tenant's own channel policy predicts ----
  results.push(await H.guard('B4', async () => {
    const cmp = await H.ensureComplaint(ctx);
    const policy = H.C.channelPolicyFrom({
      newRows: H.mdmsDataRows(H.C.schemaCodeFor('Channel', H.C.SOURCE.NEXT)),
      legacyRows: H.mdmsDataRows(H.C.schemaCodeFor('Channel', H.C.SOURCE.LEGACY)),
      envEnabled: [],
    });
    const wa = cmp.rows.filter((r) => r.channel === 'WHATSAPP');
    const expectation = H.C.channelExpectation({
      channel: 'WHATSAPP',
      policy,
      // The fixture's APPLY/citizen tuple is the one that exercises WhatsApp.
      approvedProviderTemplates: approvedWhatsappTemplates(src, 'APPLY', 'PENDINGFORASSIGNMENT'),
      providerUsable: null,
    });
    if (!wa.length)
      return H.FAIL('B4', `no WHATSAPP rows at all (expected ${expectation.status}/${expectation.code || '-'} — ${expectation.reason})`);
    const bad = wa.map((r) => ({ r, v: H.C.judgeRow(expectation, r) })).filter((x) => x.v.verdict === 'mismatch');
    if (bad.length)
      return H.FAIL('B4', `WHATSAPP rows disagree with the channel policy (${policy.source}): expected `
        + `${expectation.status}/${expectation.code || '-'}, got ${[...new Set(bad.map((x) => x.v.note))].join(', ')}`);
    // No SMS row may carry a :WHATSAPP txn suffix (no SMS fallback) — unchanged, always.
    const smuggled = cmp.rows.filter((r) => r.channel === 'SMS' && (r.txn || '').toUpperCase().endsWith(':WHATSAPP'));
    if (smuggled.length) return H.FAIL('B4', `${smuggled.length} SMS row(s) end in :WHATSAPP — WA smuggled via SMS`);
    return H.PASS('B4', `${wa.length} WHATSAPP row(s) match what ${policy.source} predicts `
      + `(${expectation.status}/${expectation.code || '-'}: ${expectation.reason}); no SMS fallback`);
  }));

  return results;
}

/** Approved WhatsApp provider templates for a transition, from the serving namespace. */
function approvedWhatsappTemplates(src, action, toState) {
  const routing = H.mdmsDataRows(H.notifSchemaCode('Routing'));
  const count = H.C.providerTemplateCounter({
    source: src.source,
    rows: H.mdmsDataRows(H.notifSchemaCode('ProviderTemplate')),
    audienceIndex: src.source === H.C.SOURCE.LEGACY ? H.C.buildAudienceIndex(routing) : null,
  });
  // The citizen is the audience the fixture's WhatsApp row targets.
  return count(action, toState, 'ACTOR:citizen', 'WHATSAPP');
}

module.exports = { run };
