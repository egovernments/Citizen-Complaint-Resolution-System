// Diagnostic probe for the ASSIGN -> RESOLVE workflow race.
//
// PGR calls egov-workflow-v2 to transition a complaint. Workflow validates the
// requested action against the complaint's currently persisted state, publishes
// the new state to the `save-wf-transitions` Kafka topic, and returns 200. A
// separate consumer (egov-persister) writes it to eg_wf_processinstance_v2.
// The next transition validates by reading that table, so the 200 means
// "accepted and queued", not "committed".
//
// Three modes:
//   MODE=nosleep  CREATE -> ASSIGN -> RESOLVE back to back, no think time.
//                 If the race is real this should fail at trivial load.
//   MODE=sleep    Same, with the standard 1-3s think time. Control arm.
//   MODE=lag      After ASSIGN returns 200, poll egov-workflow-v2 until the
//                 transition is visible, and record how long that took.
//                 Measures the race window directly instead of probing for it.
//
// Bounded by per-vu-iterations so a live deployment sees a known, small
// number of writes.
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import { login, makeRequestInfo } from '../helpers/auth.js';
import { createComplaint } from '../helpers/pgr.js';
import { SERVICE_CODES, LOCALITIES } from './pgr-lifecycle.js';
import { getEnv } from '../config/environments.js';

const MODE = __ENV.MODE || 'nosleep';
const ITERS = parseInt(__ENV.ITERS || '25', 10);
const VUS = parseInt(__ENV.VUS || '2', 10);

export const options = {
  scenarios: {
    main: { executor: 'per-vu-iterations', vus: VUS, iterations: ITERS, maxDuration: '15m' },
  },
  // No thresholds: this probe is meant to surface errors, not to pass or fail.
};

const invalidAction = new Counter('race_invalid_action');
const resolveOk = new Counter('race_resolve_ok');
const resolveOtherErr = new Counter('race_resolve_other_error');
const assignCommitLag = new Trend('assign_commit_lag_ms', true);
const lagPollCount = new Trend('assign_commit_polls');

let token = null;
let userInfo = null;

function auth(env) {
  if (token) return true;
  const a = login(env.baseUrl, env.username, env.password, env.tenant, 'EMPLOYEE');
  if (!a) return false;
  token = a.token;
  userInfo = a.userInfo;
  return true;
}

// Deliberately does NOT retry. helpers/pgr.js backs off on INVALID_UPDATE,
// which would hide exactly the timing effect being measured here.
function updateRaw(env, service, action) {
  return http.post(
    `${env.baseUrl}/pgr-services/v2/request/_update`,
    JSON.stringify({
      workflow: { action: action, assignes: [], comments: `race-probe ${MODE}` },
      service: service,
      RequestInfo: makeRequestInfo(token, userInfo),
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: `PGR_${action}` }, timeout: '60s' }
  );
}

// Reads eg_wf_processinstance_v2 through the workflow service: the exact table
// the next transition validates against.
function wfCurrentAction(env, businessId) {
  const res = http.post(
    `${env.baseUrl}/egov-workflow-v2/egov-wf/process/_search?tenantId=${env.tenant}&businessIds=${businessId}&history=true`,
    JSON.stringify({ RequestInfo: makeRequestInfo(token, userInfo) }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'WF_Search' }, timeout: '30s' }
  );
  if (res.status !== 200) return null;
  let body;
  try { body = res.json(); } catch (e) { return null; }
  const pis = body.ProcessInstances || [];
  if (pis.length === 0) return null;
  // Most recent transition recorded for this complaint.
  return pis.map(function (p) { return p.action; });
}

export default function () {
  const env = getEnv();
  if (!auth(env)) return;

  // SERVICE_CODES / LOCALITIES already fall back to the seed defaults when the
  // env config supplies none, so this scenario runs against dev and prod too
  // rather than throwing on iteration one.
  const i = exec.vu.idInTest + exec.scenario.iterationInTest;
  const serviceCode = SERVICE_CODES[i % SERVICE_CODES.length];
  const locality = LOCALITIES[i % LOCALITIES.length];
  const citizenPhone = env.citizenPhone || `9900000${String((i % 100) + 1).padStart(3, '0')}`;
  const citizenName = env.citizenName || `LoadTestCitizen_${(i % 100) + 1}`;

  const service = createComplaint(
    env.baseUrl, token, userInfo, env.tenant, serviceCode,
    citizenPhone, citizenName, locality, env.city
  );
  if (!service) return;

  if (MODE === 'sleep') sleep(Math.random() * 2 + 1);

  const assignRes = updateRaw(env, service, 'ASSIGN');
  if (assignRes.status !== 200) {
    console.error(`ASSIGN failed: ${assignRes.status} ${assignRes.body}`);
    return;
  }
  const assigned = assignRes.json().ServiceWrappers[0].service;
  const tAssign = Date.now();

  if (MODE === 'lag') {
    // Poll until the ASSIGN transition is visible to the workflow service.
    let polls = 0;
    let seen = false;
    while (Date.now() - tAssign < 30000) {
      polls++;
      const actions = wfCurrentAction(env, service.serviceRequestId);
      if (actions && actions.indexOf('ASSIGN') !== -1) { seen = true; break; }
    }
    assignCommitLag.add(seen ? Date.now() - tAssign : 30000);
    lagPollCount.add(polls);
    if (!seen) console.warn(`ASSIGN never became visible for ${service.serviceRequestId}`);
  } else if (MODE === 'sleep') {
    sleep(Math.random() * 2 + 1);
  }
  // MODE=nosleep falls straight through with no delay at all.

  const resolveRes = updateRaw(env, assigned, 'RESOLVE');
  if (resolveRes.status === 200) {
    resolveOk.add(1);
  } else if (resolveRes.body && resolveRes.body.indexOf('not found in config for the businessId') !== -1) {
    invalidAction.add(1);
    console.error(`INVALID ACTION after ${Date.now() - tAssign}ms: ${service.serviceRequestId}`);
  } else {
    resolveOtherErr.add(1);
    console.error(`RESOLVE failed: ${resolveRes.status} ${resolveRes.body}`);
  }
}
