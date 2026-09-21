'use strict';
/*
 * ============================================================================
 * Area H — the thin-event path
 * ============================================================================
 *
 * The other areas assert notification BEHAVIOUR and are deliberately blind to
 * which half of the system produced it. These three assert the move itself:
 *
 *   H1  GET /novu-adapter/v1/config/source reports which namespace is serving
 *       this tenant, per master, with non-zero row counts. There is no setting
 *       to read — the data chooses — so this endpoint IS the observability, and
 *       an endpoint that answers nothing is the failure mode.
 *
 *   H2  POST /novu-adapter/v1/dispatch/_resolve on an APPLY-shaped thin event
 *       returns the envelopes the box WOULD mint, and writes NO ledger row. The
 *       "writes nothing" half is asserted by counting the ledger before and
 *       after — a dry run that quietly wrote rows would be worse than no dry run,
 *       because operators would point it at production.
 *
 *   H3  A real complaint's ledger rows carry source_path=RESOLVED — the column
 *       that answers "which path is this deployment on", per message, in
 *       production.
 *
 * EVERY case SKIPs cleanly, with the reason, on a server still running the
 * pre-move producer: a 404 from the endpoint, or a missing source_path column,
 * means "this build does not have the thin path yet", which is a deployment
 * fact, not a test failure.
 * ============================================================================
 */
const H = require('../notif-harness');

const MISSING_ENDPOINT = (path, status) =>
  `${path} answered ${status} — this novu-bridge build has no resolution stage yet (pre-move producer). `
  + 'Not a failure: the thin path is not deployed here.';

async function run(ctx) {
  const results = [];

  // ---- H1: /config/source reports the namespace in effect, with counts ----
  results.push(await H.guard('H1', async () => {
    const r = await H.configSource(H.TENANT, ctx.empToken);
    if (r.status === 404 || r.status === 405)
      return H.SKIP('H1', MISSING_ENDPOINT('GET /config/source', r.status));
    if (r.status === 401 || r.status === 403)
      return H.SKIP('H1', `GET /config/source returned ${r.status} — the proxy-auth gate is on and this run has no accepted token`);
    if (r.status !== 200 || !r.json)
      return H.FAIL('H1', `GET /config/source returned ${r.status}: ${String(r.text).slice(0, 160)}`);

    const masters = r.json.masters || {};
    const names = Object.keys(masters);
    if (!names.length)
      return H.FAIL('H1', 'GET /config/source answered 200 with no masters — it reports nothing, which is the one thing it must never do');

    const zero = names.filter((n) => !(Number(masters[n].rows) > 0));
    const summary = names.map((n) => `${n}=${masters[n].schemaCode}(${masters[n].rows}${masters[n].legacy ? ', legacy' : ''}${masters[n].stale ? ', stale' : ''})`).join(' ');

    // Cross-check against what this host can see in the database directly: the
    // endpoint and eg_mdms_data must agree about which namespace is in play.
    const local = H.notificationSource();
    const anyLegacy = r.json.anyLegacy === true || names.some((n) => masters[n].legacy);
    const agrees = anyLegacy === (local.source === H.C.SOURCE.LEGACY)
      // A partially-copied tenant legitimately has SOME masters legacy while
      // Routing is not; only disagree when routing itself disagrees.
      || (masters.routing || masters.Routing || {}).legacy === (local.source === H.C.SOURCE.LEGACY);

    if (zero.length)
      return H.FAIL('H1', `masters reporting zero rows: ${zero.join(', ')} — a served master with no rows notifies nobody. ${summary}`);
    if (!agrees)
      return H.FAIL('H1', `/config/source and eg_mdms_data disagree: endpoint says anyLegacy=${anyLegacy}, this host reads ${local.label}. ${summary}`);
    return H.PASS('H1', `tenant=${r.json.tenantId || H.TENANT} state=${r.json.stateTenantId || H.STATE_TENANT}: ${summary} — agrees with eg_mdms_data (${local.label})`);
  }));

  // ---- H2: /dispatch/_resolve is a dry run that writes nothing ----
  results.push(await H.guard('H2', async () => {
    const before = await ledgerCount(ctx);
    if (before == null) return H.SKIP('H2', 'could not read the ledger count to prove the dry run wrote nothing');

    const event = thinApplyEvent();
    const r = await H.resolveThinEvent({ RequestInfo: H.RI(), event }, ctx.empToken);
    if (r.status === 404 || r.status === 405)
      return H.SKIP('H2', MISSING_ENDPOINT('POST /dispatch/_resolve', r.status));
    if (r.status === 401 || r.status === 403)
      return H.SKIP('H2', `POST /dispatch/_resolve returned ${r.status} — it is admin-only (it expands role pools and returns recipient contacts); supply an admin token via E2E_EMP_USER/E2E_EMP_PASS`);
    if (r.status !== 200 || !r.json)
      return H.FAIL('H2', `POST /dispatch/_resolve returned ${r.status}: ${String(r.text).slice(0, 200)}`);

    const envelopes = r.json.envelopes || [];
    const terminal = r.json.terminalCode || null;
    const diagnostics = r.json.diagnostics || [];

    // The dry run must not have written anything. Settle briefly first: a row
    // written asynchronously a second later would still be a row written.
    await H.sleep(4000);
    const after = await ledgerCount(ctx);
    if (after !== before)
      return H.FAIL('H2', `the dry run wrote to the ledger: ${before} rows before, ${after} after. `
        + '_resolve must be safe to point at a production tenant.');

    if (!envelopes.length && !terminal)
      return H.FAIL('H2', `_resolve returned neither envelopes nor a terminalCode — it answered nothing. diagnostics=${JSON.stringify(diagnostics).slice(0, 200)}`);

    if (!envelopes.length)
      return H.PASS('H2', `_resolve would send nothing and says why: ${terminal} `
        + `(${diagnostics.slice(0, 3).join('; ') || 'no diagnostics'}); ledger unchanged at ${after} rows`);

    // A would-be envelope must be a COMPLETE v1 envelope: the point of the dry
    // run is seeing the finished message, not a promise of one.
    const shapeless = envelopes.filter((e) => !e || !e.channel || !e.subscriberId || !e.renderedBody || !e.transactionId);
    if (shapeless.length)
      return H.FAIL('H2', `${shapeless.length}/${envelopes.length} would-be envelope(s) miss a required v1 field (channel/subscriberId/renderedBody/transactionId)`);
    const badTxn = envelopes.filter((e) => !H.C.parseTransactionId(e.transactionId).wellFormed);
    if (badTxn.length)
      return H.FAIL('H2', `${badTxn.length} would-be transactionId(s) do not keep the documented shape, e.g. ${badTxn[0].transactionId}`);

    const channels = [...new Set(envelopes.map((e) => String(e.channel).toUpperCase()))].join(',');
    return H.PASS('H2', `_resolve returned ${envelopes.length} would-be envelope(s) over [${channels}] with complete v1 fields and well-formed transactionIds; ledger unchanged at ${after} rows`);
  }));

  // ---- H3: real rows carry source_path=RESOLVED ----
  results.push(await H.guard('H3', async () => {
    if (!H.hasSourcePathColumn())
      return H.SKIP('H3', 'nb_dispatch_log has no source_path column — this deployment predates the thin-event release');
    const cmp = await H.ensureComplaint(ctx);
    if (!cmp.rows.length) return H.SKIP('H3', 'the fixture complaint produced no dispatch rows to inspect');

    const paths = {};
    for (const r of cmp.rows) paths[r.sourcePath || '(blank)'] = (paths[r.sourcePath || '(blank)'] || 0) + 1;
    const summary = Object.entries(paths).map(([p, n]) => `${p}=${n}`).join(' ');

    if (paths.PRERENDERED && !paths.RESOLVED)
      return H.SKIP('H3', `every row is source_path=PRERENDERED — pgr-services on this box still renders and emits one envelope per recipient. The thin path is not deployed here (${summary})`);
    if (paths.RESOLVED && paths.PRERENDERED)
      return H.FAIL('H3', `one complaint produced BOTH paths (${summary}) — two producers are live at once, which is the rolling-cutover double-send risk (design R1). Stop the old instance.`);
    if (!paths.RESOLVED)
      return H.FAIL('H3', `no row carries source_path=RESOLVED or PRERENDERED (${summary}) — the column is there but nothing fills it`);
    return H.PASS('H3', `complaint ${cmp.id}: all ${cmp.rows.length} ledger row(s) carry source_path=RESOLVED — the box routed, resolved and rendered (${summary})`);
  }));

  return results;
}

/** Total ledger rows for this tenant, via the bridge's own /logs API. */
async function ledgerCount(ctx) {
  const r = await H.logsList({ tenantId: H.TENANT, limit: 1 }, ctx.empToken);
  if (r.status !== 200 || !r.json || typeof r.json.total !== 'number') return null;
  return r.json.total;
}

/**
 * An APPLY-shaped thin event. Deliberately NOT a real complaint: the dry run is
 * about what the CONFIG would do, and inventing an entity id keeps the ledger
 * and the Logs screen free of a row that never corresponded to anything.
 *
 * `transactionSeed` uses the documented `<entityId>:<ACTION>:<TOSTATE>` form so
 * the returned transactionIds have exactly the production shape.
 */
function thinApplyEvent() {
  const entityId = `ZZ-E2E-RESOLVE-${Date.now()}`;
  return {
    kind: 'THIN',
    schemaVersion: '1',
    eventId: `zz-e2e-${Date.now()}`,
    eventType: 'COMPLAINTS_WORKFLOW_TRANSITIONED',
    eventTime: new Date().toISOString(),
    producer: 'notif-e2e-suite',
    module: 'Complaints',
    eventName: 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT',
    ledgerEventName: 'COMPLAINTS.WORKFLOW.APPLY',
    entityType: 'Complaint',
    entityId,
    tenantId: H.TENANT,
    transactionSeed: `${entityId}:APPLY:PENDINGFORASSIGNMENT`,
    actors: {
      citizen: {
        name: 'zz-e2e Resolve Probe',
        phone: H.TEST_PHONE,
        email: H.TEST_EMAIL,
        type: 'CITIZEN',
      },
    },
    data: {
      id: entityId,
      date: new Date().toLocaleDateString('en-GB'),
      complaint_type: H.SERVICE_NAME,
      status: 'PENDINGFORASSIGNMENT',
    },
    localized: {
      complaint_type: [`COMPLAINT_HIERARCHY.${H.SERVICE_CODE}`, `pgr.complaint.category.${H.SERVICE_CODE}`],
      status: ['CS_COMMON_PENDINGFORASSIGNMENT'],
    },
    localizationModules: ['rainmaker-pgr', 'rainmaker-common'],
    payload: { referenceNumber: entityId, action: 'APPLY', toState: 'PENDINGFORASSIGNMENT' },
  };
}

module.exports = { run, thinApplyEvent };
