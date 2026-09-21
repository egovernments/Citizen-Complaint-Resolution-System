#!/usr/bin/env node
/*
 * ============================================================================
 * Live E2E: role-based, multi-channel PGR notifications
 * (runs ON the pilot server where the DIGIT compose stack runs)
 * ============================================================================
 *
 * Proves the goal end-to-end: a workflow transition whose routing rows declare
 * role-based notifications fans the notification out to the RIGHT ROLE-HOLDERS across
 * SMS / WhatsApp / Email. After each transition we read the novu-bridge
 * `nb_dispatch_log` (keyed by the complaint number) and cross-reference each
 * recipient's uuid against `eg_userrole_v1` to assert the right AUDIENCE got each
 * CHANNEL, with the right terminal status.
 *
 * Flows exercised (E2E-1):
 *   Complaint A : APPLY -> ASSIGN(PENDINGATLME) -> RESOLVE(RESOLVED)
 *                       -> citizen RATE(CLOSEDAFTERRESOLUTION)
 *   Complaint B : APPLY -> employee REJECT(REJECTED) -> citizen REOPEN(PENDINGFORASSIGNMENT)
 *   Complaint C : APPLY -> employee REJECT(REJECTED) -> citizen RATE(CLOSEDAFTERREJECTION)
 *
 * --------------------------------------------------------------------------
 * WHICH CONFIG NAMESPACE THIS READS  (design 5.2)
 * --------------------------------------------------------------------------
 * The EXPECT matrix is NOT hardcoded: it is read at startup from the server's own
 * MDMS, from whichever namespace is actually serving that tenant — mirroring the
 * bridge's own rule, per tenant and all-or-nothing:
 *
 *   NOTIFICATIONS.Routing has active rows at the state tenant  -> read those
 *                                     (eventName = <PREFIX>.<ACTION>.<TOSTATE>,
 *                                      audience = a scheme reference)
 *   zero rows there                   -> read RAINMAKER-PGR.NotificationRouting
 *                                      and adapt each row on the way in
 *
 * So the script is correct on a pre-copy tenant, a copied tenant, and on both seed
 * lineages (splitter policy that authors only APPLY/ASSIGN/RESOLVE, and the legacy
 * dev seed). Any (action,toState) with no routing rows becomes the E2E-4 negative.
 * The rules themselves live in ./notif-config.js and are unit-tested without a
 * server (`node --test notif-config.test.js`).
 *
 * E2E-4 (no routing for a transition) CHANGED with the thin-event path: the box now
 * records the decision it used to take silently, as exactly ONE channel-less row —
 * channel `NONE`, `SKIPPED` / `NB_NO_ROUTING`, transactionId `<seed>:NONE`. On a
 * server still running the pre-move producer the answer is still zero rows, and the
 * script accepts whichever matches the producer path it observed (`source_path`).
 *
 * WhatsApp (E2E-5) is a HARD assertion but no longer a hardcoded one: the expected
 * outcome is derived from the tenant's own channel policy —
 *
 *   WHATSAPP off for the tenant             -> SKIPPED / NB_NO_PROVIDER
 *   on, no approved provider template        -> SKIPPED / NB_TEMPLATE_NOT_APPROVED
 *   on, template ok, provider unusable       -> SKIPPED / NB_PROVIDER_UNAVAILABLE
 *   on and everything in place               -> SENT
 *
 * — so the script stops failing on a tenant where an operator switched WhatsApp on.
 * No SMS row may carry a `:WHATSAPP` transactionId suffix (no SMS fallback), always.
 * There is NO Baileys delivery testing anywhere.
 *
 * `SKIPPED / NB_CONTACT_MISSING` rows (a resolved recipient with no phone/email for
 * the routed channel) are EXPECTED on the thin path and accounted for explicitly —
 * they used to be a silent producer-side filter and are now a row.
 *
 * --------------------------------------------------------------------------
 * ENVIRONMENT VARIABLES
 * --------------------------------------------------------------------------
 * Required:
 *   E2E_EMP_USER          employee login username (ASSIGN actor; holds GRO+PGR_LME)   [FAIL FAST if unset]
 *   E2E_EMP_PASS          employee login password                                     [FAIL FAST if unset]
 *
 * Connection / tenant (defaults shown):
 *   E2E_TENANT            city tenant                    default ke.bomet
 *   E2E_STATE_TENANT      state/root tenant for MDMS     default = first label of E2E_TENANT (ke)
 *   E2E_KONG             Kong base URL                   default http://localhost:18000
 *   E2E_BUSINESS_SERVICE workflow businessService        default PGR
 *   SERVICE_CODE         complaint serviceCode           default AmbulanceDelay
 *   LOCALITY             boundary locality code          default BOMET_BOMET_CENTRAL_CHESOEN
 *   PG_CONTAINER         postgres container name         default docker-postgres
 *   PG_USER / PG_DB      psql user / db                  default egov / egov
 *
 * Live delivery (E2E-0.2 / §1). CITIZEN identity is the owner's own contacts and is
 * AUTHORIZED for live runs; LME/GRO have NO defaults and MUST be supplied by the owner
 * at run time — when unset the contact-update is skipped (dispatch-log assertions still
 * run; only human-received verification is skipped). NEVER commit real LME/GRO values.
 *   LIVE_DELIVERY=1        turn on live-delivery mode (update citizen + role-holder contacts)
 *   LIVE_CITIZEN_PHONE     default +919415787824   (authorized owner contact)
 *   LIVE_CITIZEN_CC        default +91             (country code stripped to derive local part)
 *   LIVE_CITIZEN_EMAIL     default contact@theflywheel.in (authorized owner contact)
 *   LME_PHONE              <LME_PHONE>  placeholder — owner supplies; no default
 *   LME_EMAIL              <LME_EMAIL>  placeholder — owner supplies; no default
 *   GRO_PHONE              <GRO_PHONE>  placeholder — owner supplies; no default
 *   GRO_EMAIL              <GRO_EMAIL>  placeholder — owner supplies; no default
 *
 * Novu-side verification (E2E-3), off by default:
 *   VERIFY_NOVU=1          verify each SENT SMS/EMAIL reached Novu and rendered
 *   NOVU_API_URL           default http://localhost:14002 (compose maps novu-api 14002:3000)
 *   NOVU_API_KEY           Novu API key — NEVER committed; supplied at run time only
 *
 * Negative-via-deactivation (E2E-4), off by default (mutates server config):
 *   NEGATIVE_VIA_DEACTIVATION=1  deactivate an APPLY routing row via MDMS, restart
 *                                pgr-services, file a complaint, assert ZERO rows, restore
 *
 * Channel-policy probe (optional, read-only):
 *   NOVU_BRIDGE_CONTAINER  container to read NOVU_BRIDGE_CHANNELS_ENABLED from
 *                          (default novu-bridge) — only used when the tenant has NO
 *                          channel-policy rows at all, which is when the bridge itself
 *                          falls back to that env var
 *
 * --------------------------------------------------------------------------
 * RUN (on the target server, repo checked out; run where the compose stack runs
 * because it shells out to `docker exec <PG_CONTAINER> psql`):
 *
 *   E2E_EMP_USER=... E2E_EMP_PASS=... \
 *     node local-setup/tests/e2e/notifications/e2e-role-notifications.js
 *
 * Live citizen legs + Novu verify:
 *   E2E_EMP_USER=... E2E_EMP_PASS=... LIVE_DELIVERY=1 VERIFY_NOVU=1 NOVU_API_KEY=... \
 *     node local-setup/tests/e2e/notifications/e2e-role-notifications.js
 *
 * NOTE: `local-setup/tests/e2e/playwright.config.ts` sets `testDir: './specs'`, so this
 * plain `.js` file under `notifications/` is invisible to Playwright and is run with node.
 * ============================================================================
 */
const { execSync } = require('child_process');
// Pure config rules (source selection, eventName parsing, audience schemes, the
// channel-outcome expectation table). No I/O, no env — unit-tested by
// `node --test notif-config.test.js` without a server.
const C = require('./notif-config');

// ---- Connection / tenant config (all env-driven; no secrets in this file) ----
const KONG = process.env.E2E_KONG || 'http://localhost:18000';
const TENANT = process.env.E2E_TENANT || 'ke.bomet';
const STATE_TENANT = process.env.E2E_STATE_TENANT || TENANT.split('.')[0];
const ROOT = STATE_TENANT; // citizen registration happens at the state/root tenant
const BUSINESS_SERVICE = (process.env.E2E_BUSINESS_SERVICE || 'PGR').toUpperCase();
const OTP = '123456'; // mock OTP (Kong request-termination returns 200 for /user-otp)
const SERVICE_CODE = process.env.SERVICE_CODE || 'AmbulanceDelay';
const LOCALITY = process.env.LOCALITY || 'BOMET_BOMET_CENTRAL_CHESOEN';
const NAME = 'E2E Role Test Citizen';
const RATING = parseInt(process.env.RATING || '5', 10);

const PG_CONTAINER = process.env.PG_CONTAINER || 'docker-postgres';
const PG_USER = process.env.PG_USER || 'egov';
const PG_DB = process.env.PG_DB || 'egov';

// Stock DIGIT public OAuth client — base64 of "egov-user-client:" (client id, empty
// secret). This is the well-known public client used by every DIGIT UI; it is NOT a
// tenant credential. Overridable via env for non-default deployments.
const BASIC = process.env.E2E_BASIC_AUTH || 'Basic ZWdvdi11c2VyLWNsaWVudDo=';

// ---- Required employee credentials (FAIL FAST) ----
const EMP_USER = process.env.E2E_EMP_USER;
const EMP_PASS = process.env.E2E_EMP_PASS;
if (!EMP_USER || !EMP_PASS) {
  console.error('FATAL: E2E_EMP_USER and E2E_EMP_PASS must be set (employee login for ASSIGN/RESOLVE/REJECT).');
  console.error('  Example: E2E_EMP_USER=<user> E2E_EMP_PASS=<pass> node ' + __filename.split('/').slice(-1)[0]);
  process.exit(2);
}

// ---- Live delivery config ----
const LIVE = process.env.LIVE_DELIVERY === '1';
const LIVE_CITIZEN_PHONE = process.env.LIVE_CITIZEN_PHONE || '+919415787824';
const LIVE_CITIZEN_CC = process.env.LIVE_CITIZEN_CC || '+91';
const LIVE_CITIZEN_EMAIL = process.env.LIVE_CITIZEN_EMAIL || 'contact@theflywheel.in';
const LME_PHONE = process.env.LME_PHONE; // no default — owner supplies
const LME_EMAIL = process.env.LME_EMAIL; // no default — owner supplies
const GRO_PHONE = process.env.GRO_PHONE; // no default — owner supplies
const GRO_EMAIL = process.env.GRO_EMAIL; // no default — owner supplies

// ---- Novu verify config ----
const VERIFY_NOVU = process.env.VERIFY_NOVU === '1';
const NOVU_API_URL = process.env.NOVU_API_URL || 'http://localhost:14002';
const NOVU_API_KEY = process.env.NOVU_API_KEY || '';

// ---- Negative-via-deactivation config ----
const NEG_DEACT = process.env.NEGATIVE_VIA_DEACTIVATION === '1';

// ---- novu-bridge container, for the env channel fallback (read-only docker inspect) ----
const NOVU_BRIDGE_CONTAINER = process.env.NOVU_BRIDGE_CONTAINER || 'novu-bridge';

// ---- Tunables ----
const POLL_MS = 90000;   // per-transition dispatch poll window
const NEG_WAIT_MS = 60000; // negative-assertion settle window (assert zero rows)

// ---- Result counters ----
let pass = 0, fail = 0, warns = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const no = (m) => { fail++; console.log('  ✗ ' + m); };
const warn = (m) => { warns++; console.log('  ⚠ ' + m); };

// ============================================================================
// Low-level helpers
// ============================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// psql, split each line by '|' into columns (use only for multi-column SELECTs).
function psql(sql) {
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -t -A -F'|' -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
}

// psql, single-column SELECT: return each row's raw value un-split (safe for JSON that
// might itself contain '|'). Used for the MDMS `data` jsonb read.
function psqlRaw(sql) {
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

async function call(path, body, headers, form) {
  const b = form ? new URLSearchParams(body).toString() : JSON.stringify(body);
  const r = await fetch(KONG + path, { method: 'POST', headers, body: b });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, text: t, json: j };
}

const RI = () => ({ apiId: 'Rainmaker', msgId: `${Date.now()}|en_IN`, action: '_create' });

async function token(username, password, userType, tenantId) {
  const r = await call('/user/oauth/token',
    { grant_type: 'password', username, password, tenantId, scope: 'read', userType },
    { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: BASIC }, true);
  if (r.status !== 200) throw new Error(`auth ${username} failed ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}

// ============================================================================
// Dynamic EXPECT matrix — read from the server's own MDMS (E2E-0.3)
// ============================================================================
// Flat list of {action, toState, eventName, audience (a scheme ref), label, terms,
// channel}, built from whichever namespace is serving this tenant. The filtering
// rules live in notif-config.js, which is where they are unit-tested; this function
// only decides WHICH rows to feed them.
let EXPECT_ROWS = [];
let CONFIG_SOURCE = null;          // 'NOTIFICATIONS' | 'RAINMAKER-PGR'
let CHANNEL_POLICY = null;         // {source, byChannel}
let APPROVED_PROVIDER_TEMPLATES = () => 0;
let PROVIDER_USABLE = null;        // true | false | null (not probed from here)

// Read every ACTIVE row of a schema at the state tenant, as parsed JSON.
// MDMS v2 stores each flattened row's JSON in the `data` jsonb column of
// eg_mdms_data — (schemacode, uniqueidentifier, data, isactive, tenantid).
function mdmsRows(schemaCode) {
  if (!schemaCode) return [];
  const sql = `SELECT data FROM eg_mdms_data WHERE schemacode='${schemaCode}' `
    + `AND isactive=true AND tenantid='${STATE_TENANT}'`;
  let lines;
  try {
    lines = psqlRaw(sql);
  } catch (e) {
    throw new Error(`Failed reading ${schemaCode} from eg_mdms_data: ${e.message}`);
  }
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* a row we cannot parse is not a row */ }
  }
  return out;
}

// The deployment-wide channel allowlist, read off the running bridge. Only
// consulted when the tenant has NO channel-policy rows at all — which is exactly
// when the bridge itself falls back to it. Defaults to EMPTY (= every channel off),
// which is the bridge's own default.
function envChannelsEnabled() {
  try {
    const out = execSync(
      `docker inspect ${NOVU_BRIDGE_CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}'`,
      { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('NOVU_BRIDGE_CHANNELS_ENABLED='));
    if (!line) return [];
    return line.slice('NOVU_BRIDGE_CHANNELS_ENABLED='.length).split(',').map((c) => c.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Optional read-only probe: is the provider the tenant pinned on a channel actually
// usable? Answering needs Novu, which this script may not be able to reach, so a
// failure leaves PROVIDER_USABLE null — "unknown", which makes NB_PROVIDER_UNAVAILABLE
// a reported warning rather than either a silent pass or a false failure.
async function probeProviderUsable(policy) {
  const pinned = Object.values((policy && policy.byChannel) || {})
    .map((p) => p.provider).filter(Boolean);
  if (!pinned.length) return true;   // nothing pinned = nothing that can be unusable
  try {
    const r = await fetch(KONG + '/novu-bridge/novu-adapter/v1/integrations', { method: 'GET' });
    if (r.status !== 200) return null;
    const body = await r.json();
    const list = (body && (body.data || body.integrations)) || [];
    if (!Array.isArray(list) || !list.length) return null;
    const ids = new Set(list.filter((i) => i && i.active !== false)
      .map((i) => String(i.identifier || i._id || '')));
    return pinned.every((p) => ids.has(String(p)));
  } catch {
    return null;
  }
}

function loadExpectMatrix() {
  // The bridge's rule, mirrored: a tenant with active NOTIFICATIONS.Routing rows is
  // served the new masters; a tenant with none is served the legacy ones through the
  // read adapter. Per tenant, all-or-nothing, never per row.
  const newRouting = mdmsRows(C.schemaCodeFor('Routing', C.SOURCE.NEXT));
  CONFIG_SOURCE = C.selectSource(newRouting.filter((r) => C.isActive(r)).length);

  const routingRows = CONFIG_SOURCE === C.SOURCE.NEXT
    ? newRouting
    : mdmsRows(C.schemaCodeFor('Routing', C.SOURCE.LEGACY));

  const built = C.buildExpectRows({
    source: CONFIG_SOURCE,
    rows: routingRows,
    businessService: BUSINESS_SERVICE,
  });
  EXPECT_ROWS = built.rows;
  for (const [row, why] of built.skipped) {
    console.log(`  (routing row not in the matrix: ${why}) ${JSON.stringify(row).slice(0, 160)}`);
  }

  // Channel policy: NOTIFICATIONS.Channel, else the legacy channel master, else the
  // bridge's env allowlist — exactly ChannelPolicyClient's own order.
  CHANNEL_POLICY = C.channelPolicyFrom({
    newRows: mdmsRows(C.schemaCodeFor('Channel', C.SOURCE.NEXT)),
    legacyRows: mdmsRows(C.schemaCodeFor('Channel', C.SOURCE.LEGACY)),
    envEnabled: envChannelsEnabled(),
  });

  // Approved provider templates, from the same namespace, joined on the audience
  // string routing produced (the hazard notifications_convert.py documents).
  APPROVED_PROVIDER_TEMPLATES = C.providerTemplateCounter({
    source: CONFIG_SOURCE,
    rows: mdmsRows(C.schemaCodeFor('ProviderTemplate', CONFIG_SOURCE)),
    audienceIndex: CONFIG_SOURCE === C.SOURCE.LEGACY ? C.buildAudienceIndex(routingRows) : null,
  });
}

// Expected audience/channel groups for a specific (action, toState).
const specsFor = (action, toState) => C.specsFor(EXPECT_ROWS, action, toState);

// Lower-bound row count for a (action,toState) = number of (audience,channel) tuples.
const tupleCount = (action, toState) => C.tupleCount(EXPECT_ROWS, action, toState);

// What a row for this (audience, channel) should say, from this tenant's own config.
function expectationFor(action, toState, audience, channel) {
  return C.channelExpectation({
    channel,
    policy: CHANNEL_POLICY,
    approvedProviderTemplates: APPROVED_PROVIDER_TEMPLATES(action, toState, audience, channel),
    providerUsable: PROVIDER_USABLE,
  });
}

// ============================================================================
// Role cross-check + dispatch-log parsing
// ============================================================================
// Roles held by a uuid (cross-check audience). Returns set of role codes.
const _rolesCache = new Map();
function rolesOf(uuid) {
  if (_rolesCache.has(uuid)) return _rolesCache.get(uuid);
  const rows = psql(`SELECT DISTINCT ur.role_code FROM eg_userrole_v1 ur `
    + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid WHERE u.uuid='${uuid}'`);
  const set = new Set(rows.map((r) => r[0]));
  _rolesCache.set(uuid, set);
  return set;
}

// Is `source_path` on this deployment's nb_dispatch_log? The column arrives with the
// thin-event release; a pre-move box has not got it and selecting it would be a SQL
// error, not a test result. Probed once.
let _hasSourcePath = null;
function hasSourcePathColumn() {
  if (_hasSourcePath !== null) return _hasSourcePath;
  try {
    const rows = psqlRaw("SELECT count(*) FROM information_schema.columns "
      + "WHERE table_name='nb_dispatch_log' AND column_name='source_path'");
    _hasSourcePath = Number(rows[0] || 0) > 0;
  } catch {
    _hasSourcePath = false;
  }
  return _hasSourcePath;
}

// Which producer path this deployment is on, learned from the rows themselves rather
// than from a config nobody can read at 2am: `source_path=RESOLVED` means the box
// routed and rendered (thin event), `PRERENDERED` means the producer did.
// null until a row has been seen.
let THIN_PATH = null;
function noteSourcePath(rows) {
  for (const r of rows) {
    const sp = (r.sourcePath || '').toUpperCase();
    if (sp === 'RESOLVED') { THIN_PATH = true; return; }
    if (sp === 'PRERENDERED') { THIN_PATH = false; }
  }
}

// All dispatch rows for a complaint. transactionId format (design 2.5, unchanged):
//   serviceRequestId:action:toState:tenantId:subKey:channel   (6 colon-separated parts;
// subKey is normally the recipient uuid) — or `<seed>:NONE` (4 parts) for a
// channel-less resolution decision. E2E-0.4: include last_error_code for E2E-5.
function queryDispatch(complaintId) {
  const sp = hasSourcePathColumn() ? 'source_path' : `''`;
  return psql(`SELECT channel, recipient_value, status, transaction_id, last_error_code, ${sp} `
    + `FROM nb_dispatch_log WHERE reference_number='${complaintId}'`)
    .map(([channel, recipient, status, txn, lastError, sourcePath]) => {
      const t = C.parseTransactionId(txn);
      return {
        channel: (channel || '').toUpperCase(),
        recipient,
        status: (status || '').toUpperCase(),
        txn,
        lastError: lastError || '',
        sourcePath: sourcePath || '',
        action: t.action,
        toState: t.toState,
        uuid: t.uuid,
        channelLess: t.channelLess,
        txnWellFormed: t.wellFormed,
      };
    });
}

function filterRows(complaintId, action, toState) {
  const A = String(action).toUpperCase(), S = toState ? String(toState).toUpperCase() : null;
  return queryDispatch(complaintId).filter((r) => r.action === A && (!S || r.toState === S));
}

// How many rows this transition must produce AT LEAST.
//   routing rows exist        -> one per (audience, channel) tuple, as always
//   no routing, thin path     -> exactly ONE channel-less NB_NO_ROUTING row
//   no routing, pre-move path -> zero, and we wait the settle window to prove it
function rowFloor(action, toState) {
  const tuples = tupleCount(action, toState);
  if (tuples > 0) return tuples;
  return THIN_PATH === true ? 1 : 0;
}

// Poll nb_dispatch_log for a specific transition's rows. When minRows<=0 (a negative
// leg on a deployment that writes nothing), wait the settle window and return whatever
// exists (expected: nothing).
async function dispatchesFor(complaintId, action, toState, minRows) {
  if (minRows <= 0) {
    await sleep(NEG_WAIT_MS);
    const rows = filterRows(complaintId, action, toState);
    noteSourcePath(rows);
    return rows;
  }
  const start = Date.now();
  let rows = filterRows(complaintId, action, toState);
  let prev = -1, stable = 0;
  while (Date.now() - start < POLL_MS) {
    rows = filterRows(complaintId, action, toState);
    if (rows.length >= minRows) {
      if (rows.length === prev) { stable++; if (stable >= 2) break; } else { stable = 0; }
    }
    prev = rows.length;
    await sleep(3000);
  }
  noteSourcePath(rows);
  return rows;
}

// ============================================================================
// Assertions
// ============================================================================
// Can this audience resolve to anybody at all on this transition? Used ONLY to tell a
// real miss apart from an audience that provably has nobody to notify — the case the
// box now records as NB_NO_RECIPIENTS when it is the only audience, and as nothing at
// all when it is one of several. A "nobody to notify" verdict is reported as a WARNING,
// never as a pass, so it can never quietly stand in for a missing row.
const _poolCache = new Map();
function roleHolderCount(role) {
  if (_poolCache.has(role)) return _poolCache.get(role);
  let n = 0;
  try {
    const rows = psql(`SELECT count(DISTINCT u.uuid) FROM eg_userrole_v1 ur `
      + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid `
      + `WHERE ur.role_code='${role}' AND u.active=true`);
    n = Number((rows[0] || [])[0] || 0);
  } catch { n = 0; }
  _poolCache.set(role, n);
  return n;
}

function assertTransition(action, toState, complaintId, rows, ctx) {
  const citizenUuid = ctx.citizenUuid;
  const specs = specsFor(action, toState);
  console.log(`\n[assert ${action}->${toState}] complaint=${complaintId} — ${rows.length} dispatch row(s), `
    + `${specs.length} expected audience group(s)`);

  // --------------------------------------------------------------------------
  // E2E-4 negative: no routing rows for this transition.
  //   pre-move producer : zero rows, as before
  //   thin-event path   : exactly ONE channel-less row — channel NONE, SKIPPED,
  //                       NB_NO_ROUTING, transactionId <seed>:NONE
  // The silence became a row; that is the whole point of §6.6.
  // --------------------------------------------------------------------------
  if (specs.length === 0) {
    const want = C.noRoutingExpectation(THIN_PATH);
    const noRouting = rows.filter((r) => (r.channel || '').toUpperCase() === C.CHANNEL_NONE
      && r.status === 'SKIPPED' && r.lastError === 'NB_NO_ROUTING');
    const others = rows.filter((r) => !noRouting.includes(r));

    if (want.rows === 0) {
      if (rows.length === 0) ok(`${action}->${toState}: empty routing → zero dispatch rows (pre-move producer; E2E-4 verified)`);
      else no(`${action}->${toState}: expected ZERO dispatch rows (no routing, pre-move producer) but found ${rows.length}`);
      return;
    }
    if (want.rows === 1) {
      if (noRouting.length === 1 && others.length === 0) {
        const txnOk = (noRouting[0].txn || '').toUpperCase().endsWith(':NONE');
        if (txnOk) ok(`${action}->${toState}: empty routing → exactly 1 SKIPPED/NB_NO_ROUTING row at channel NONE, txn ${noRouting[0].txn} (E2E-4 verified)`);
        else no(`${action}->${toState}: the NB_NO_ROUTING row's txn does not end ':NONE' — ${noRouting[0].txn}`);
      } else {
        no(`${action}->${toState}: expected exactly 1 channel-less SKIPPED/NB_NO_ROUTING row, got `
          + `${noRouting.length} NB_NO_ROUTING + ${others.length} other row(s): `
          + `${others.map((r) => r.channel + '/' + r.status + '/' + r.lastError).join(', ') || '(none)'}`);
      }
      return;
    }
    // Producer path not yet observed: accept either shape, and say which was seen.
    if (rows.length === 0) ok(`${action}->${toState}: empty routing → zero rows (producer path not yet observed; pre-move shape)`);
    else if (noRouting.length === 1 && others.length === 0) ok(`${action}->${toState}: empty routing → 1 SKIPPED/NB_NO_ROUTING row at channel NONE (thin shape)`);
    else no(`${action}->${toState}: empty routing produced ${rows.length} row(s) that are neither shape: `
      + rows.map((r) => r.channel + '/' + r.status + '/' + r.lastError).join(', '));
    return;
  }

  // --------------------------------------------------------------------------
  // E2E-1 / E2E-5: per (audience, channel), a row that genuinely belongs to that
  // audience, carrying the status this tenant's own config predicts.
  // --------------------------------------------------------------------------
  for (const spec of specs) {
    for (const ch of spec.channels) {
      const byChannel = rows.filter((r) => (r.channel || '').toUpperCase() === ch);
      const matches = byChannel.filter((r) => C.rowMatchesAudience(spec.terms, r, ctx));
      const expectation = expectationFor(action, toState, spec.audience, ch);

      if (matches.length === 0) {
        // No row. Is that a miss, or does this audience genuinely resolve to nobody?
        const resolved = C.resolveAudience(spec.terms, {
          hasActor: (name) => (name === 'citizen' ? !!citizenUuid : name === 'assignee' ? !!ctx.assigneeUuid : false),
          roleHolderCount,
          hasEventRecipients: false,
        });
        if (!resolved.term) {
          warn(`${spec.label} on ${ch}: no dispatch row, and the audience resolves to nobody `
            + `(${resolved.reason}) — legitimately empty, NOT counted as a pass`);
        } else {
          no(`${spec.label} on ${ch}: NO dispatch row found, though ${resolved.reason} `
            + `(expected ${expectation.status}${expectation.code ? '/' + expectation.code : ''})`);
        }
        continue;
      }

      const verdicts = matches.map((m) => ({ row: m, v: C.judgeRow(expectation, m) }));
      const mismatched = verdicts.filter((x) => x.v.verdict === 'mismatch');
      const warned = verdicts.filter((x) => x.v.verdict === 'tolerated' && x.v.warn);
      const contactMissing = matches.filter((m) => m.lastError === 'NB_CONTACT_MISSING');

      if (mismatched.length === 0) {
        const seen = [...new Set(verdicts.map((x) => x.v.note))].join(', ');
        ok(`${spec.label} on ${ch}: ${matches.length} recipient(s) — ${seen} `
          + `(expected ${expectation.status}${expectation.code ? '/' + expectation.code : ''}: ${expectation.reason})`
          + (contactMissing.length ? ` [${contactMissing.length} NB_CONTACT_MISSING, accounted]` : ''));
      } else {
        no(`${spec.label} on ${ch}: expected ${expectation.status}${expectation.code ? '/' + expectation.code : ''} `
          + `(${expectation.reason}), got ${[...new Set(mismatched.map((x) => x.v.note))].join(', ')}`);
      }
      for (const w of warned) {
        warn(`${spec.label} on ${ch}: ${w.v.note}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rows nobody claimed. Previously invisible; now named, because an unexplained
  // row is exactly what "every outcome visible as a row" is supposed to surface.
  // --------------------------------------------------------------------------
  const claimed = new Set();
  for (const spec of specs) {
    for (const ch of spec.channels) {
      for (const r of rows) {
        if ((r.channel || '').toUpperCase() === ch && C.rowMatchesAudience(spec.terms, r, ctx)) claimed.add(r.txn);
      }
    }
  }
  const unclaimed = rows.filter((r) => !claimed.has(r.txn));
  const unclaimedContactMissing = unclaimed.filter((r) => r.lastError === 'NB_CONTACT_MISSING');
  const unclaimedOther = unclaimed.filter((r) => r.lastError !== 'NB_CONTACT_MISSING');
  if (unclaimedContactMissing.length) {
    ok(`${action}->${toState}: ${unclaimedContactMissing.length} NB_CONTACT_MISSING row(s) for recipients `
      + `outside the asserted audience groups — expected on the resolution path, accounted for`);
  }
  if (unclaimedOther.length) {
    warn(`${action}->${toState}: ${unclaimedOther.length} dispatch row(s) match no expected audience group: `
      + unclaimedOther.map((r) => `${r.channel}/${r.status}/${r.lastError || 'ok'}`).join(', '));
  }

  // --------------------------------------------------------------------------
  // The transactionId contract (design 2.5): six colon-separated parts, or the
  // four-part `<seed>:NONE` channel-less shape. If this breaks, the design is wrong.
  // --------------------------------------------------------------------------
  const malformed = rows.filter((r) => !r.txnWellFormed);
  if (malformed.length === 0) ok(`${action}->${toState}: every transactionId keeps its documented shape`);
  else no(`${action}->${toState}: ${malformed.length} malformed transactionId(s): ${malformed.map((r) => r.txn).join(', ')}`);

  // E2E-5 item 2: no SMS fallback for WhatsApp. A WhatsApp body smuggled through the
  // SMS workflow would show up as an SMS-channel row whose transactionId ends ':WHATSAPP'.
  const smuggled = rows.filter((r) => (r.channel || '').toUpperCase() === 'SMS'
    && (r.txn || '').toUpperCase().endsWith(':WHATSAPP'));
  if (smuggled.length === 0) ok(`${action}->${toState}: no SMS row carries a :WHATSAPP txn suffix (no SMS fallback)`);
  else no(`${action}->${toState}: ${smuggled.length} SMS row(s) end in :WHATSAPP — WhatsApp smuggled via SMS`);
}

// E2E-2: multi-holder pool completeness + no-overreach + dual-role dedupe.
// The PGR_LME SMS fan-out must reach EVERY contactful pool holder (completeness)
// and every recipient must genuinely hold PGR_LME (no over-reach). Note the
// assignee is ALSO notified via the EMPLOYEE (assignee-alias) audience; if that
// assignee holds PGR_LME they are a LEGITIMATE recipient that may sit outside the
// city-level contactful pool (e.g. a state-level or differently-scoped holder),
// so "extra" holders are reported as info, not a failure. Strict pool-size
// equality would false-fail on that overlap, which is what this check avoids.
function assertPgrLmePool(rows, poolUuids, assignActorUuid) {
  const poolCount = poolUuids.size;
  console.log(`\n[E2E-2 pool] PGR_LME contactful pool=${poolCount}, ASSIGN actor=${assignActorUuid}`);
  if (poolCount > 10) {
    warn(`PGR_LME pool=${poolCount} > egov-user default page size (10) — fan-out may UNDER-count `
      + `until role-pool pagination is deployed on the target server; not silently passing`);
  }
  const smsLme = rows.filter((r) => (r.channel || '').toUpperCase() === 'SMS'
    && r.uuid && rolesOf(r.uuid).has('PGR_LME'));
  const distinctLme = new Set(smsLme.map((r) => r.uuid));
  // Completeness: every contactful pool holder must be reached. A holder REACHED but
  // skipped as NB_CONTACT_MISSING still counts as reached — the fan-out found them and
  // the ledger says why nothing was sent, which is the outcome the pool check is about.
  // The pool query admits an email-only holder, so on SMS that outcome is expected; it
  // is broken out rather than folded away.
  const contactMissing = smsLme.filter((r) => r.lastError === 'NB_CONTACT_MISSING');
  const missing = [...poolUuids].filter((u) => !distinctLme.has(u));
  if (poolCount > 0 && missing.length === 0) {
    ok(`E2E-2: PGR_LME SMS fan-out reached all ${poolCount} contactful pool holder(s)`
      + (contactMissing.length ? ` (${contactMissing.length} of them SKIPPED/NB_CONTACT_MISSING — no phone for SMS)` : ''));
  } else {
    no(`E2E-2: PGR_LME SMS missed ${missing.length}/${poolCount} pool holder(s): ${missing.join(',') || '(pool empty)'}`);
  }
  // Extras beyond the city pool are legitimate PGR_LME holders reached via the
  // EMPLOYEE (assignee) audience — report, do not fail. (Every distinctLme uuid
  // already holds PGR_LME by construction, so there is no over-reach to flag.)
  const extra = [...distinctLme].filter((u) => !poolUuids.has(u));
  if (extra.length) {
    ok(`E2E-2: ${extra.length} extra PGR_LME holder(s) reached via the assignee audience (deduped): ${extra.join(',')}`);
  }
  // Dual-role dedupe: the ASSIGN actor holds GRO+PGR_LME; must appear exactly once per channel.
  for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
    const forActor = rows.filter((r) => r.uuid === assignActorUuid && (r.channel || '').toUpperCase() === ch);
    if (forActor.length === 0) continue; // channel not authored for this actor's audiences
    if (forActor.length === 1) ok(`E2E-2: dual-role actor deduped on ${ch} (exactly 1 row)`);
    else no(`E2E-2: dual-role actor has ${forActor.length} ${ch} rows — channel|subscriber dedupe failed`);
  }
}

function pgrLmePoolUuids() {
  const rows = psql(`SELECT DISTINCT u.uuid FROM eg_userrole_v1 ur `
    + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid `
    + `WHERE ur.role_code='PGR_LME' AND u.tenantid='${TENANT}' AND u.active=true `
    + `AND (u.mobilenumber IS NOT NULL OR u.emailid IS NOT NULL)`);
  return new Set(rows.map((r) => r[0]).filter(Boolean));
}

// ============================================================================
// E2E-3: Novu-side verification (behind VERIFY_NOVU=1)
// ============================================================================
async function novuGet(path) {
  const r = await fetch(NOVU_API_URL + path, { headers: { Authorization: `ApiKey ${NOVU_API_KEY}` } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, json: j, text: t };
}

async function verifyNovu(rows) {
  if (!VERIFY_NOVU) return;
  if (!NOVU_API_KEY) { warn('VERIFY_NOVU=1 but NOVU_API_KEY is unset — skipping Novu-side verification'); return; }
  for (const r of rows) {
    if ((r.status || '').toUpperCase() !== 'SENT') continue;
    const ch = (r.channel || '').toUpperCase();
    if (ch !== 'SMS' && ch !== 'EMAIL') continue; // WHATSAPP is SKIPPED per E2E-5
    const txn = r.txn;
    // Novu CE 2.3.0 activity feed. VERIFY the exact query-param name once against the
    // running instance (some versions use transactionIds[]); fall back to /v1/messages.
    let res = await novuGet(`/v1/notifications?transactionId=${encodeURIComponent(txn)}`);
    let acts = res.json && (res.json.data || res.json.notifications);
    if (!Array.isArray(acts) || acts.length === 0) {
      // fallback: some builds want transactionIds[]
      res = await novuGet(`/v1/notifications?transactionIds[]=${encodeURIComponent(txn)}`);
      acts = res.json && (res.json.data || res.json.notifications);
    }
    if (!Array.isArray(acts) || acts.length === 0) {
      warn(`E2E-3: no Novu activity found for txn ${txn} (verify /v1/notifications param name on this instance)`);
      continue;
    }
    // Flatten job/step statuses across the returned activities.
    const jobs = [];
    for (const a of acts) if (Array.isArray(a.jobs)) jobs.push(...a.jobs);
    const anyFailed = jobs.some((j) => String(j.status || '').toLowerCase() === 'failed');
    if (anyFailed) { no(`E2E-3: Novu reports a failed job for txn ${txn} (${ch})`); continue; }
    if (ch === 'EMAIL') {
      const content = jobs.map((j) => (j.step && (j.step.template ? JSON.stringify(j.step.template) : '')) || '').join('');
      if (content && content.length > 2) ok(`E2E-3: Novu EMAIL activity for txn ${txn} has rendered content, no failed job`);
      else warn(`E2E-3: Novu EMAIL activity for txn ${txn} present but content shape not confirmed (inspect step.template)`);
    } else {
      ok(`E2E-3: Novu SMS activity for txn ${txn} exists with no failed job`);
    }
  }
}

// ============================================================================
// PGR flow primitives
// ============================================================================
async function citizenLogin(regPhone) {
  await call(`/user-otp/v1/_send?tenantId=${ROOT}`,
    { otp: { mobileNumber: regPhone, tenantId: ROOT, userType: 'citizen', type: 'register' } },
    { 'Content-Type': 'application/json' });
  await call(`/user/citizen/_create?tenantId=${ROOT}`,
    { RequestInfo: RI(), User: { name: NAME, username: regPhone, mobileNumber: regPhone,
        emailId: LIVE ? LIVE_CITIZEN_EMAIL : 'contact@theflywheel.in', otpReference: OTP, tenantId: ROOT, type: 'CITIZEN' } },
    { 'Content-Type': 'application/json' });
  return token(regPhone, OTP, 'citizen', ROOT);
}

async function createComplaint(tok, ui, citizenContact) {
  const r = await call(`/pgr-services/v2/request/_create?tenantId=${TENANT}`, {
    RequestInfo: { ...RI(), authToken: tok, userInfo: ui },
    service: { tenantId: TENANT, serviceCode: SERVICE_CODE, description: `role-notif e2e ${Date.now()}`,
      source: 'web', address: { city: TENANT, locality: { code: LOCALITY, name: 'Chesoen' },
        geoLocation: { latitude: -0.7813, longitude: 35.3416 } },
      citizen: { name: NAME, mobileNumber: citizenContact.mobileNumber, countryCode: citizenContact.countryCode,
        emailId: citizenContact.emailId, type: 'CITIZEN', tenantId: ROOT, uuid: ui.uuid } },
    workflow: { action: 'APPLY' },
  }, { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` });
  if (r.status !== 200) throw new Error(`create failed ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json.ServiceWrappers[0].service;
}

async function search(tok, ui, srid) {
  const r = await call(`/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    { RequestInfo: { ...RI(), authToken: tok, userInfo: ui } },
    { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` });
  return r.json.ServiceWrappers[0];
}

async function transition(tok, ui, service, action, opts) {
  opts = opts || {};
  // Strip read-only enrichment that _update can't deserialize back.
  const { processInstance, ...svc } = service;
  if (opts.rating != null) svc.rating = opts.rating;
  const workflow = { action, comments: `e2e ${action}` };
  if (opts.assignes) workflow.assignes = opts.assignes;
  const r = await call(`/pgr-services/v2/request/_update`, {
    RequestInfo: { ...RI(), action: '_update', authToken: tok, userInfo: ui },
    service: svc,
    workflow,
  }, { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` });
  if (r.status !== 200) throw new Error(`${action} failed ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json.ServiceWrappers[0].service;
}

// Drive one transition end-to-end: transition -> poll dispatches -> assert -> Novu verify.
// `ctx` carries {citizenUuid, assigneeUuid, rolesOf} — the assignee is what lets
// ACTOR:assignee be checked by uuid rather than by "holds the EMPLOYEE role".
// Returns the (possibly updated) service and the dispatch rows observed.
async function step(label, tok, ui, service, action, toState, ctx, opts) {
  const min = rowFloor(action, toState);
  service = await transition(tok, ui, service, action, opts);
  ok(`${label}: ${action} -> ${service.applicationStatus}`);
  const rows = await dispatchesFor(service.serviceRequestId, action, toState, min);
  assertTransition(action, toState, service.serviceRequestId, rows, ctx);
  await verifyNovu(rows);
  return { service, rows };
}

// ============================================================================
// LIVE-delivery contact wiring (E2E-0.2 / §1)
// ============================================================================
async function userSearchByUuid(empTok, empUi, uuid) {
  const r = await call('/user/_search',
    { RequestInfo: { ...RI(), authToken: empTok, userInfo: empUi }, uuid: [uuid], tenantId: TENANT },
    { 'Content-Type': 'application/json', Authorization: `Bearer ${empTok}` });
  const users = (r.json && r.json.user) || [];
  return users[0] || null;
}

// Update a user's contact via the internal, format-skipping endpoint.
async function updateUserContact(empTok, empUi, user, phone, email, countryCode) {
  const updated = { ...user };
  if (phone) updated.mobileNumber = phone;
  if (email) updated.emailId = email;
  if (countryCode) updated.countryCode = countryCode;
  const r = await call(`/user/users/${user.id}/_updatenovalidate`,
    { RequestInfo: { ...RI(), authToken: empTok, userInfo: empUi }, user: updated },
    { 'Content-Type': 'application/json', Authorization: `Bearer ${empTok}` });
  return r.status === 200;
}

// LIVE: set live contacts on all holders of a role so role-pool fan-out reaches a real device.
async function wireRoleHolderContacts(empTok, empUi, roleCode, phone, email, envLabel) {
  if (!phone && !email) {
    console.log(`  (skip) ${roleCode} live contact update — ${envLabel}_PHONE/${envLabel}_EMAIL unset (placeholder policy; owner supplies at run time)`);
    return;
  }
  const uuids = psql(`SELECT DISTINCT u.uuid FROM eg_userrole_v1 ur `
    + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid `
    + `WHERE ur.role_code='${roleCode}' AND u.tenantid='${TENANT}' AND u.active=true`).map((r) => r[0]);
  let n = 0;
  for (const uuid of uuids) {
    const u = await userSearchByUuid(empTok, empUi, uuid);
    if (!u) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await updateUserContact(empTok, empUi, u, phone, email, null)) n++;
  }
  console.log(`  LIVE: updated ${n}/${uuids.length} ${roleCode} holder contact(s)`);
}

// ============================================================================
// E2E-4: negative via routing-row deactivation (behind NEGATIVE_VIA_DEACTIVATION=1)
// ============================================================================
async function mdmsUpdateRoutingActive(empTok, empUi, uid, dataObj, active) {
  // Whichever namespace is serving this tenant is the one whose row must be flipped:
  // deactivating a legacy row on a tenant already served NOTIFICATIONS.Routing would
  // change nothing and the negative would silently pass for the wrong reason.
  const schemaCode = C.schemaCodeFor('Routing', CONFIG_SOURCE);
  const body = {
    RequestInfo: { ...RI(), action: '_update', authToken: empTok, userInfo: empUi },
    Mdms: { tenantId: STATE_TENANT, schemaCode,
      uniqueIdentifier: uid, isActive: true, data: { ...dataObj, active } },
  };
  const r = await call(`/mdms-v2/v2/_update/${schemaCode}`, body,
    { 'Content-Type': 'application/json', Authorization: `Bearer ${empTok}` });
  return r.status >= 200 && r.status < 300;
}

async function restartPgrAndWait() {
  // No-TTL cache pre-W4 requires a restart to drop the routing cache (finding #8/PGR-3).
  // Post-W4 (TTL) this can become a wait rather than a restart.
  execSync(`docker restart pgr-services`, { encoding: 'utf8' });
  const start = Date.now();
  while (Date.now() - start < 120000) {
    try {
      const r = await fetch(KONG + '/pgr-services/v2/request/_search?tenantId=' + TENANT + '&limit=1',
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: RI() }) });
      if (r.status < 500) break;
    } catch { /* not up yet */ }
    await sleep(3000);
  }
}

async function negativeViaDeactivation(citizen) {
  console.log('\n=== E2E-4: negative via routing-row deactivation (mutates server config) ===');
  const emp = await token(EMP_USER, EMP_PASS, 'EMPLOYEE', TENANT);
  const eUi = emp.UserRequest, eTok = emp.access_token;
  // Pick one active APPLY routing row to deactivate. Emit "<uid>::E2ESEP::<json>" per row
  // so the uid and the (single-line) jsonb can be split unambiguously (JSON never contains it).
  const SEP = '::E2ESEP::';
  const routingSchema = C.schemaCodeFor('Routing', CONFIG_SOURCE);
  const lines = psqlRaw("SELECT uniqueidentifier || '" + SEP + "' || data::text FROM eg_mdms_data "
    + `WHERE schemacode='${routingSchema}' AND isactive=true `
    + `AND tenantid='${STATE_TENANT}'`);
  let target = null;
  for (const line of lines) {
    const sep = line.indexOf(SEP);
    if (sep < 0) continue;
    const uid = line.slice(0, sep);
    let d; try { d = JSON.parse(line.slice(sep + SEP.length)); } catch { continue; }
    if (d.active === false) continue;
    // In NOTIFICATIONS.* the action is inside the eventName; in the legacy master it is
    // its own column. One lookup, both shapes.
    const parsed = d.eventName ? C.parseEventName(d.eventName) : null;
    const action = parsed ? parsed.action : String(d.action || '').toUpperCase();
    if (action === 'APPLY') { target = { uid, data: d, audience: d.audience, channel: d.channel }; break; }
  }
  if (!target) { warn(`E2E-4 deact: no active APPLY routing row in ${routingSchema} to deactivate — skipping`); return; }

  let restored = false;
  try {
    if (!await mdmsUpdateRoutingActive(eTok, eUi, target.uid, target.data, false)) {
      warn('E2E-4 deact: MDMS _update to active=false did not return 2xx — skipping (confirm mdms-v2 update envelope)');
      return;
    }
    await restartPgrAndWait();
    // File a fresh complaint; APPLY should now emit ZERO rows for the deactivated (audience,channel).
    const svc = await createComplaint(citizen.tok, citizen.ui, citizen.contact);
    const rows = await dispatchesFor(svc.serviceRequestId, 'APPLY', 'PENDINGFORASSIGNMENT', 0);
    // The deactivated row's (audience,channel) must be absent; assert no row matches it.
    // The audience is read through the same scheme parser both namespaces use, so a
    // legacy `GRO`+assigneeOnly and a new `ACTOR:assignee|ROLE:GRO` are one check.
    const aud = C.parseAudience(target.audience, target.data.assigneeOnly);
    const ch = String(target.channel || '').toUpperCase();
    const ctx = { citizenUuid: citizen.ui.uuid, assigneeUuid: null, rolesOf };
    const offending = rows.filter((r) => (r.channel || '').toUpperCase() === ch
      && C.rowMatchesAudience(aud.terms, r, ctx));
    if (offending.length === 0) ok(`E2E-4 deact: deactivated ${aud.label}/${ch} produced ZERO APPLY rows on complaint ${svc.serviceRequestId}`);
    else no(`E2E-4 deact: deactivated ${aud.label}/${ch} still produced ${offending.length} APPLY row(s)`);
  } finally {
    // Restore + restart no matter what.
    try {
      if (await mdmsUpdateRoutingActive(eTok, eUi, target.uid, target.data, true)) {
        await restartPgrAndWait();
        restored = true;
      }
    } catch (e) { console.error('  restore error: ' + e.message); }
    if (restored) console.log('  E2E-4 deact: routing row restored + pgr-services restarted');
    else warn('E2E-4 deact: FAILED to auto-restore the routing row — restore manually and restart pgr-services');
  }
}

// ============================================================================
// Main
// ============================================================================
(async () => {
  console.log(`\n=== Role-based multi-channel notification E2E @ ${TENANT} (state=${STATE_TENANT}) ===`);
  console.log(`Kong=${KONG} businessService=${BUSINESS_SERVICE} serviceCode=${SERVICE_CODE} LIVE_DELIVERY=${LIVE ? 'on' : 'off'}`);

  loadExpectMatrix();
  PROVIDER_USABLE = await probeProviderUsable(CHANNEL_POLICY);
  const actions = [...new Set(EXPECT_ROWS.map((r) => r.action))].sort();
  console.log(`Config source: ${CONFIG_SOURCE === C.SOURCE.NEXT
    ? 'NOTIFICATIONS.* (this tenant has been copied)'
    : 'RAINMAKER-PGR.Notification* (legacy — the bridge reads these through its adapter)'}`);
  console.log(`Channel policy: from ${CHANNEL_POLICY.source} — `
    + C.VALID_CHANNELS.map((ch) => `${ch}=${CHANNEL_POLICY.byChannel[ch].enabled ? 'on' : 'off'}`
      + (CHANNEL_POLICY.byChannel[ch].provider ? `(${CHANNEL_POLICY.byChannel[ch].provider})` : '')).join(' '));
  console.log(`Provider usability probe: ${PROVIDER_USABLE === null ? 'not answerable from here (NB_PROVIDER_UNAVAILABLE becomes a warning)' : PROVIDER_USABLE}`);
  console.log(`EXPECT matrix: ${EXPECT_ROWS.length} routing tuple(s) across actions [${actions.join(', ')}]`);
  const legacyLegs = ['REJECT', 'REOPEN', 'RATE'].filter((a) => actions.includes(a));
  console.log(`Seed mode: ${legacyLegs.length ? 'routing present for ' + legacyLegs.join('/') + ' (legacy-style)' : 'splitter-style (only APPLY/ASSIGN/RESOLVE authored) — REJECT/REOPEN/RATE are E2E-4 negatives'}`);

  // Citizen registration (Kenya-valid local number for /user/citizen/_create).
  const regPhone = '7' + String(Date.now()).slice(-8);
  const citizen = await citizenLogin(regPhone);
  const cUi = citizen.UserRequest, cTok = citizen.access_token, citizenUuid = cUi.uuid;
  console.log('citizen registered uuid=' + citizenUuid + ' regPhone=' + regPhone);

  // Employee actor (ASSIGN/RESOLVE/REJECT). Holds GRO+PGR_LME; department matches the complaint.
  const emp = await token(EMP_USER, EMP_PASS, 'EMPLOYEE', TENANT);
  const eUi = emp.UserRequest, eTok = emp.access_token, empUuid = eUi.uuid;
  console.log('employee logged in uuid=' + empUuid);

  // Citizen contact block that the complaint carries (NotificationService reads service.citizen).
  let citizenContact;
  if (LIVE) {
    const cc = LIVE_CITIZEN_CC;
    let local = LIVE_CITIZEN_PHONE;
    if (cc && local.startsWith(cc)) local = local.slice(cc.length);
    else if (local.startsWith('+')) local = local.replace(/^\+\d{1,3}/, '');
    citizenContact = { mobileNumber: local, countryCode: cc, emailId: LIVE_CITIZEN_EMAIL };
    // Update the registered citizen's stored contact via the internal endpoint.
    const cUser = await userSearchByUuid(eTok, eUi, citizenUuid);
    if (cUser) {
      const okUpd = await updateUserContact(eTok, eUi, cUser, local, LIVE_CITIZEN_EMAIL, cc);
      console.log(`  LIVE: citizen contact update ${okUpd ? 'ok' : 'FAILED (verify _updatenovalidate + UserValidation)'}`);
    }
    // Role-holder contacts (skipped silently when the placeholders are unset).
    await wireRoleHolderContacts(eTok, eUi, 'PGR_LME', LME_PHONE, LME_EMAIL, 'LME');
    await wireRoleHolderContacts(eTok, eUi, 'GRO', GRO_PHONE, GRO_EMAIL, 'GRO');
  } else {
    citizenContact = { mobileNumber: regPhone, countryCode: null, emailId: 'contact@theflywheel.in' };
  }
  const citizenBundle = { tok: cTok, ui: cUi, contact: citizenContact };

  // E2E-2: measure the PGR_LME pool before we fan out.
  const poolUuids = pgrLmePoolUuids();
  const poolCount = poolUuids.size;
  if (poolCount < 2) {
    warn(`E2E-2: PGR_LME pool has ${poolCount} holder(s) (<2). Pool-completeness is weak. `
      + `Provision another PGR_LME employee via HRMS /egov-hrms/employees/_create (dept matching `
      + `${SERVICE_CODE}) then re-run; not auto-creating to avoid untested HRMS mutations.`);
  }

  // Assertion context. `assigneeUuid` is per complaint and is what turns the
  // ACTOR:assignee audience from "somebody holding EMPLOYEE" into an exact identity.
  const ctxFor = (assigneeUuid) => ({ citizenUuid, assigneeUuid: assigneeUuid || null, rolesOf });

  // ---------------- Complaint A: APPLY -> ASSIGN -> RESOLVE -> RATE ----------------
  console.log('\n########## Complaint A ##########');
  const svcA = await createComplaint(cTok, cUi, citizenContact);
  const idA = svcA.serviceRequestId;
  ok(`A created ${idA} status=${svcA.applicationStatus}`);
  let rowsA = await dispatchesFor(idA, 'APPLY', 'PENDINGFORASSIGNMENT', rowFloor('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idA, rowsA, ctxFor(null));
  await verifyNovu(rowsA);

  // ASSIGN to the employee themselves (so they can RESOLVE). From here on the
  // assignee is known, so ACTOR:assignee is asserted by uuid.
  let wA = await search(eTok, eUi, idA);
  let sA = await step('A', eTok, eUi, wA.service, 'ASSIGN', 'PENDINGATLME', ctxFor(empUuid), { assignes: [empUuid] });
  assertPgrLmePool(sA.rows, poolUuids, empUuid); // E2E-2 on the ASSIGN fan-out

  wA = await search(eTok, eUi, idA);
  await step('A', eTok, eUi, wA.service, 'RESOLVE', 'RESOLVED', ctxFor(empUuid), {});

  // Citizen RATE -> CLOSEDAFTERRESOLUTION (toState disambiguation, live).
  wA = await search(cTok, cUi, idA);
  await step('A', cTok, cUi, wA.service, 'RATE', 'CLOSEDAFTERRESOLUTION', ctxFor(empUuid), { rating: RATING });

  // ---------------- Complaint B: APPLY -> REJECT -> REOPEN ----------------
  console.log('\n########## Complaint B ##########');
  const svcB = await createComplaint(cTok, cUi, citizenContact);
  const idB = svcB.serviceRequestId;
  ok(`B created ${idB} status=${svcB.applicationStatus}`);
  let rowsB = await dispatchesFor(idB, 'APPLY', 'PENDINGFORASSIGNMENT', rowFloor('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idB, rowsB, ctxFor(null));
  await verifyNovu(rowsB);

  let wB = await search(eTok, eUi, idB);
  await step('B', eTok, eUi, wB.service, 'REJECT', 'REJECTED', ctxFor(null), {});

  wB = await search(cTok, cUi, idB);
  await step('B', cTok, cUi, wB.service, 'REOPEN', 'PENDINGFORASSIGNMENT', ctxFor(null), {});

  // ---------------- Complaint C: APPLY -> REJECT -> RATE(after rejection) ----------------
  console.log('\n########## Complaint C ##########');
  const svcC = await createComplaint(cTok, cUi, citizenContact);
  const idC = svcC.serviceRequestId;
  ok(`C created ${idC} status=${svcC.applicationStatus}`);
  let rowsC = await dispatchesFor(idC, 'APPLY', 'PENDINGFORASSIGNMENT', rowFloor('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idC, rowsC, ctxFor(null));
  await verifyNovu(rowsC);

  let wC = await search(eTok, eUi, idC);
  await step('C', eTok, eUi, wC.service, 'REJECT', 'REJECTED', ctxFor(null), {});

  wC = await search(cTok, cUi, idC);
  await step('C', cTok, cUi, wC.service, 'RATE', 'CLOSEDAFTERREJECTION', ctxFor(null), { rating: RATING });

  // ---------------- E2E-4 optional: negative via deactivation ----------------
  if (NEG_DEACT) {
    await negativeViaDeactivation(citizenBundle);
  }

  // ---------------- Full dispatch-log dump ----------------
  const spCol = hasSourcePathColumn() ? ', source_path' : '';
  for (const [label, id] of [['A', idA], ['B', idB], ['C', idC]]) {
    console.log(`\n=== full dispatch log for ${label} ${id} ===`);
    for (const r of psql(`SELECT transaction_id, channel, status, last_error_code, recipient_value${spCol} `
      + `FROM nb_dispatch_log WHERE reference_number='${id}' ORDER BY transaction_id`)) {
      console.log('  ' + r.join('  |  '));
    }
  }

  console.log(`\nProducer path observed: ${THIN_PATH === true ? 'RESOLVED (thin event — the box routed and rendered)'
    : THIN_PATH === false ? 'PRERENDERED (the producer rendered)'
      : 'not observed (no source_path column, or no rows)'}`);
  console.log(`\n${'='.repeat(56)}\nRESULT: ${pass} passed, ${fail} failed, ${warns} warning(s)\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('\nFATAL: ' + e.message); process.exit(1); });
