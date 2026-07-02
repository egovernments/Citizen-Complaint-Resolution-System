#!/usr/bin/env node
/*
 * ============================================================================
 * Live E2E: role-based, multi-channel PGR notifications
 * (runs ON the pilot server where the DIGIT compose stack runs)
 * ============================================================================
 *
 * Proves the goal end-to-end: a workflow transition whose RAINMAKER-PGR.NotificationRouting
 * rows declare role-based notifications fans the notification out to the RIGHT
 * ROLE-HOLDERS across SMS / WhatsApp / Email. After each transition we read the
 * novu-bridge `nb_dispatch_log` (keyed by the complaint number) and cross-reference
 * each recipient's uuid against `eg_userrole_v1` to assert the right AUDIENCE (role)
 * got each CHANNEL, with the right terminal status.
 *
 * Flows exercised (E2E-1):
 *   Complaint A : APPLY -> ASSIGN(PENDINGATLME) -> RESOLVE(RESOLVED)
 *                       -> citizen RATE(CLOSEDAFTERRESOLUTION)
 *   Complaint B : APPLY -> employee REJECT(REJECTED) -> citizen REOPEN(PENDINGFORASSIGNMENT)
 *   Complaint C : APPLY -> employee REJECT(REJECTED) -> citizen RATE(CLOSEDAFTERREJECTION)
 *
 * The EXPECT matrix is NOT hardcoded: it is read at startup from the server's own
 * MDMS (RAINMAKER-PGR.NotificationRouting) so the script is correct on both seed
 * lineages (splitter policy that authors only APPLY/ASSIGN/RESOLVE, and the legacy
 * dev seed). Any (action,toState) with no routing rows becomes the E2E-4 negative
 * (assert ZERO dispatch rows). See E2E-0.3.
 *
 * WhatsApp: this repo carries W1 (channel gate + Baileys removal), so WHATSAPP is a
 * HARD assertion (E2E-5): every expected (audience, WHATSAPP) row must land as a
 * `SKIPPED` row with `last_error_code='NB_NO_PROVIDER'`, and no SMS row may carry a
 * `:WHATSAPP` transactionId suffix (no SMS fallback). There is NO Baileys delivery
 * testing anywhere.
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

// ---- Router-parity constants (must mirror NotificationRouter.java) ----
const VALID_CHANNELS = new Set(['SMS', 'WHATSAPP', 'EMAIL']);
const NON_NOTIFIABLE_AUDIENCES = new Set(['AUTO_ESCALATE', 'SYSTEM']);

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
// Flat list of {action, toState, aud, ch}. Mirrors NotificationRouter.route():
// skip active===false, drop non-notifiable audiences, keep only valid channels,
// uppercase everything, filter to the PGR businessService.
let EXPECT_ROWS = [];

function loadExpectMatrix() {
  // MDMS v2 stores each flattened NotificationRouting row's JSON in the `data` jsonb
  // column of eg_mdms_data. Confirm table/column names once on first run with
  // `\d eg_mdms_data` — DIGIT MDMS v2 uses (schemacode, uniqueidentifier, data, isactive, tenantid).
  const sql = "SELECT data FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.NotificationRouting' "
    + `AND isactive=true AND tenantid='${STATE_TENANT}'`;
  let lines;
  try {
    lines = psqlRaw(sql);
  } catch (e) {
    throw new Error('Failed reading RAINMAKER-PGR.NotificationRouting from eg_mdms_data: ' + e.message);
  }
  const rows = [];
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.active === false) continue;
    const bs = String(d.businessService || '').trim().toUpperCase();
    if (bs && bs !== BUSINESS_SERVICE) continue;
    const aud = String(d.audience || '').trim().toUpperCase();
    const ch = String(d.channel || '').trim().toUpperCase();
    const action = String(d.action || '').trim().toUpperCase();
    const toState = String(d.toState || '').trim().toUpperCase();
    if (!aud || !action || !toState) continue;
    if (NON_NOTIFIABLE_AUDIENCES.has(aud)) continue;
    if (!VALID_CHANNELS.has(ch)) continue;
    rows.push({ action, toState, aud, ch });
  }
  // dedupe identical (action,toState,aud,ch)
  const seen = new Set();
  EXPECT_ROWS = rows.filter((r) => {
    const k = `${r.action}|${r.toState}|${r.aud}|${r.ch}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Expected audience/channel groups for a specific (action, toState).
function specsFor(action, toState) {
  const A = String(action).toUpperCase(), S = String(toState).toUpperCase();
  const byAud = new Map();
  for (const r of EXPECT_ROWS) {
    if (r.action !== A || r.toState !== S) continue;
    if (!byAud.has(r.aud)) byAud.set(r.aud, new Set());
    byAud.get(r.aud).add(r.ch);
  }
  return [...byAud.entries()].map(([aud, chs]) => ({ aud, ch: [...chs] }));
}

// Lower-bound row count for a (action,toState) = number of (aud,ch) tuples.
function tupleCount(action, toState) {
  return specsFor(action, toState).reduce((n, s) => n + s.ch.length, 0);
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

// All dispatch rows for a complaint. transactionId format (NotificationService.java):
//   serviceRequestId:action:toState:tenantId:subKey:channel   (6 colon-separated parts;
// subKey is normally the recipient uuid). E2E-0.4: include last_error_code for E2E-5.
function queryDispatch(complaintId) {
  return psql(`SELECT channel, recipient_value, status, transaction_id, last_error_code `
    + `FROM nb_dispatch_log WHERE reference_number='${complaintId}'`)
    .map(([channel, recipient, status, txn, lastError]) => {
      const parts = (txn || '').split(':');
      const action = (parts[1] || '').toUpperCase();
      const toState = (parts[2] || '').toUpperCase();
      const uuid = parts.length >= 6 ? parts[parts.length - 2] : '';
      return { channel, recipient, status, txn, lastError, action, toState, uuid };
    });
}

function filterRows(complaintId, action, toState) {
  const A = String(action).toUpperCase(), S = toState ? String(toState).toUpperCase() : null;
  return queryDispatch(complaintId).filter((r) => r.action === A && (!S || r.toState === S));
}

// Poll nb_dispatch_log for a specific transition's rows. When minRows<=0 (a negative
// leg), wait the settle window and return whatever exists (expected: nothing).
async function dispatchesFor(complaintId, action, toState, minRows) {
  if (minRows <= 0) {
    await sleep(NEG_WAIT_MS);
    return filterRows(complaintId, action, toState);
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
  return rows;
}

// ============================================================================
// Assertions
// ============================================================================
function assertTransition(action, toState, complaintId, rows, citizenUuid) {
  const specs = specsFor(action, toState);
  console.log(`\n[assert ${action}->${toState}] complaint=${complaintId} — ${rows.length} dispatch row(s), `
    + `${specs.length} expected audience group(s)`);

  // E2E-4 negative: no routing rows for this transition => zero dispatch rows.
  if (specs.length === 0) {
    if (rows.length === 0) ok(`${action}->${toState}: empty routing → zero dispatch rows (E2E-4 negative verified)`);
    else no(`${action}->${toState}: expected ZERO dispatch rows (no routing) but found ${rows.length}`);
    return;
  }

  for (const spec of specs) {
    for (const ch of spec.ch) {
      let matches = rows.filter((r) => (r.channel || '').toUpperCase() === ch);
      if (spec.aud === 'CITIZEN') matches = matches.filter((r) => r.uuid === citizenUuid);
      else matches = matches.filter((r) => r.uuid && r.uuid !== citizenUuid && rolesOf(r.uuid).has(spec.aud));

      if (ch === 'WHATSAPP') {
        // E2E-5 hard assertion (W1 is in this repo): SKIPPED + NB_NO_PROVIDER, never SMS.
        if (matches.length === 0) {
          no(`${spec.aud} on WHATSAPP: NO dispatch row (W1 requires a SKIPPED/NB_NO_PROVIDER row)`);
          continue;
        }
        const bad = matches.filter((m) => (m.status || '').toUpperCase() !== 'SKIPPED' || (m.lastError || '') !== 'NB_NO_PROVIDER');
        if (bad.length === 0) {
          ok(`${spec.aud} on WHATSAPP: SKIPPED/NB_NO_PROVIDER × ${matches.length} (no-provider gate honored)`);
        } else {
          no(`${spec.aud} on WHATSAPP: expected all SKIPPED/NB_NO_PROVIDER, got `
            + `${[...new Set(bad.map((m) => (m.status || '') + '/' + (m.lastError || '')))].join(',')}`);
        }
      } else {
        if (matches.length > 0) {
          const statuses = [...new Set(matches.map((m) => m.status))].join('/');
          ok(`${spec.aud} on ${ch}: ${matches.length} recipient(s), status=${statuses}`);
        } else {
          no(`${spec.aud} on ${ch}: NO dispatch row found`);
        }
      }
    }
  }

  // E2E-5 item 2: no SMS fallback for WhatsApp. A WhatsApp body smuggled through the
  // SMS workflow would show up as an SMS-channel row whose transactionId ends ':WHATSAPP'.
  const smuggled = rows.filter((r) => (r.channel || '').toUpperCase() === 'SMS'
    && (r.txn || '').toUpperCase().endsWith(':WHATSAPP'));
  if (smuggled.length === 0) ok(`${action}->${toState}: no SMS row carries a :WHATSAPP txn suffix (no SMS fallback)`);
  else no(`${action}->${toState}: ${smuggled.length} SMS row(s) end in :WHATSAPP — WhatsApp smuggled via SMS`);
}

// E2E-2: multi-holder pool-size completeness + dual-role dedupe.
function assertPgrLmePool(rows, poolCount, assignActorUuid) {
  console.log(`\n[E2E-2 pool] PGR_LME pool=${poolCount}, ASSIGN actor=${assignActorUuid}`);
  if (poolCount > 10) {
    warn(`PGR_LME pool=${poolCount} > egov-user default page size (10) — the equality check may `
      + `UNDER-count until the pagination fix (W3) is deployed on the target server; not silently passing`);
  }
  const smsLme = rows.filter((r) => (r.channel || '').toUpperCase() === 'SMS'
    && r.uuid && rolesOf(r.uuid).has('PGR_LME'));
  const distinctLme = new Set(smsLme.map((r) => r.uuid));
  if (poolCount > 0 && distinctLme.size === poolCount) {
    ok(`E2E-2: PGR_LME SMS fan-out reached all ${poolCount} pool holder(s) (equality)`);
  } else {
    no(`E2E-2: PGR_LME SMS reached ${distinctLme.size} of ${poolCount} pool holder(s) (expected equality)`);
  }
  // Dual-role dedupe: the ASSIGN actor holds GRO+PGR_LME; must appear exactly once per channel.
  for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
    const forActor = rows.filter((r) => r.uuid === assignActorUuid && (r.channel || '').toUpperCase() === ch);
    if (forActor.length === 0) continue; // channel not authored for this actor's audiences
    if (forActor.length === 1) ok(`E2E-2: dual-role actor deduped on ${ch} (exactly 1 row)`);
    else no(`E2E-2: dual-role actor has ${forActor.length} ${ch} rows — channel|subscriber dedupe failed`);
  }
}

function pgrLmePoolCount() {
  const rows = psql(`SELECT COUNT(DISTINCT u.uuid) FROM eg_userrole_v1 ur `
    + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid `
    + `WHERE ur.role_code='PGR_LME' AND u.tenantid='${TENANT}' AND u.active=true `
    + `AND (u.mobilenumber IS NOT NULL OR u.emailid IS NOT NULL)`);
  return rows.length ? (parseInt(rows[0][0], 10) || 0) : 0;
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
// Returns the (possibly updated) service and the dispatch rows observed.
async function step(label, tok, ui, service, action, toState, citizenUuid, opts) {
  const min = tupleCount(action, toState);
  service = await transition(tok, ui, service, action, opts);
  ok(`${label}: ${action} -> ${service.applicationStatus}`);
  const rows = await dispatchesFor(service.serviceRequestId, action, toState, min);
  assertTransition(action, toState, service.serviceRequestId, rows, citizenUuid);
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
  const body = {
    RequestInfo: { ...RI(), action: '_update', authToken: empTok, userInfo: empUi },
    Mdms: { tenantId: STATE_TENANT, schemaCode: 'RAINMAKER-PGR.NotificationRouting',
      uniqueIdentifier: uid, isActive: true, data: { ...dataObj, active } },
  };
  const r = await call('/mdms-v2/v2/_update/RAINMAKER-PGR.NotificationRouting', body,
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
  const lines = psqlRaw("SELECT uniqueidentifier || '" + SEP + "' || data::text FROM eg_mdms_data "
    + "WHERE schemacode='RAINMAKER-PGR.NotificationRouting' AND isactive=true "
    + `AND tenantid='${STATE_TENANT}'`);
  let target = null;
  for (const line of lines) {
    const sep = line.indexOf(SEP);
    if (sep < 0) continue;
    const uid = line.slice(0, sep);
    let d; try { d = JSON.parse(line.slice(sep + SEP.length)); } catch { continue; }
    if (String(d.action || '').toUpperCase() === 'APPLY' && d.active !== false) { target = { uid, data: d }; break; }
  }
  if (!target) { warn('E2E-4 deact: no active APPLY routing row found to deactivate — skipping'); return; }

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
    const aud = String(target.data.audience || '').toUpperCase();
    const ch = String(target.data.channel || '').toUpperCase();
    const offending = rows.filter((r) => (r.channel || '').toUpperCase() === ch
      && (aud === 'CITIZEN' ? r.uuid === citizen.ui.uuid : r.uuid && rolesOf(r.uuid).has(aud)));
    if (offending.length === 0) ok(`E2E-4 deact: deactivated ${aud}/${ch} produced ZERO APPLY rows on complaint ${svc.serviceRequestId}`);
    else no(`E2E-4 deact: deactivated ${aud}/${ch} still produced ${offending.length} APPLY row(s)`);
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
  const actions = [...new Set(EXPECT_ROWS.map((r) => r.action))].sort();
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
  const poolCount = pgrLmePoolCount();
  if (poolCount < 2) {
    warn(`E2E-2: PGR_LME pool has ${poolCount} holder(s) (<2). Pool-completeness is weak. `
      + `Provision another PGR_LME employee via HRMS /egov-hrms/employees/_create (dept matching `
      + `${SERVICE_CODE}) then re-run; not auto-creating to avoid untested HRMS mutations.`);
  }

  // ---------------- Complaint A: APPLY -> ASSIGN -> RESOLVE -> RATE ----------------
  console.log('\n########## Complaint A ##########');
  let A = await createComplaint(cTok, cUi, citizenContact);
  const idA = A.serviceRequestId;
  ok(`A created ${idA} status=${A.applicationStatus}`);
  let rowsA = await dispatchesFor(idA, 'APPLY', 'PENDINGFORASSIGNMENT', tupleCount('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idA, rowsA, citizenUuid);
  await verifyNovu(rowsA);

  // ASSIGN to the employee themselves (so they can RESOLVE).
  let wA = await search(eTok, eUi, idA);
  let sA = await step('A', eTok, eUi, wA.service, 'ASSIGN', 'PENDINGATLME', citizenUuid, { assignes: [empUuid] });
  assertPgrLmePool(sA.rows, poolCount, empUuid); // E2E-2 on the ASSIGN fan-out

  wA = await search(eTok, eUi, idA);
  await step('A', eTok, eUi, wA.service, 'RESOLVE', 'RESOLVED', citizenUuid, {});

  // Citizen RATE -> CLOSEDAFTERRESOLUTION (toState disambiguation, live).
  wA = await search(cTok, cUi, idA);
  await step('A', cTok, cUi, wA.service, 'RATE', 'CLOSEDAFTERRESOLUTION', citizenUuid, { rating: RATING });

  // ---------------- Complaint B: APPLY -> REJECT -> REOPEN ----------------
  console.log('\n########## Complaint B ##########');
  let B = await createComplaint(cTok, cUi, citizenContact);
  const idB = B.serviceRequestId;
  ok(`B created ${idB} status=${B.applicationStatus}`);
  let rowsB = await dispatchesFor(idB, 'APPLY', 'PENDINGFORASSIGNMENT', tupleCount('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idB, rowsB, citizenUuid);
  await verifyNovu(rowsB);

  let wB = await search(eTok, eUi, idB);
  await step('B', eTok, eUi, wB.service, 'REJECT', 'REJECTED', citizenUuid, {});

  wB = await search(cTok, cUi, idB);
  await step('B', cTok, cUi, wB.service, 'REOPEN', 'PENDINGFORASSIGNMENT', citizenUuid, {});

  // ---------------- Complaint C: APPLY -> REJECT -> RATE(after rejection) ----------------
  console.log('\n########## Complaint C ##########');
  let C = await createComplaint(cTok, cUi, citizenContact);
  const idC = C.serviceRequestId;
  ok(`C created ${idC} status=${C.applicationStatus}`);
  let rowsC = await dispatchesFor(idC, 'APPLY', 'PENDINGFORASSIGNMENT', tupleCount('APPLY', 'PENDINGFORASSIGNMENT'));
  assertTransition('APPLY', 'PENDINGFORASSIGNMENT', idC, rowsC, citizenUuid);
  await verifyNovu(rowsC);

  let wC = await search(eTok, eUi, idC);
  await step('C', eTok, eUi, wC.service, 'REJECT', 'REJECTED', citizenUuid, {});

  wC = await search(cTok, cUi, idC);
  await step('C', cTok, cUi, wC.service, 'RATE', 'CLOSEDAFTERREJECTION', citizenUuid, { rating: RATING });

  // ---------------- E2E-4 optional: negative via deactivation ----------------
  if (NEG_DEACT) {
    await negativeViaDeactivation(citizenBundle);
  }

  // ---------------- Full dispatch-log dump ----------------
  for (const [label, id] of [['A', idA], ['B', idB], ['C', idC]]) {
    console.log(`\n=== full dispatch log for ${label} ${id} ===`);
    for (const r of psql(`SELECT transaction_id, channel, status, last_error_code, recipient_value `
      + `FROM nb_dispatch_log WHERE reference_number='${id}' ORDER BY transaction_id`)) {
      console.log('  ' + r.join('  |  '));
    }
  }

  console.log(`\n${'='.repeat(56)}\nRESULT: ${pass} passed, ${fail} failed, ${warns} warning(s)\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('\nFATAL: ' + e.message); process.exit(1); });
