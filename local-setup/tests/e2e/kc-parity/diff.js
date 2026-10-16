#!/usr/bin/env node
'use strict';
/*
 * ============================================================================
 * diff.js — parity verdict: does the Keycloak path emit the SAME DIGIT calls?
 * ============================================================================
 *
 * Keycloak is a pass-through. token-exchange-svc is supposed to make the
 * KC-enabled UI behave EXACTLY like the default one from DIGIT's point of
 * view. Anything this reports as a divergence must be fixed in
 * token-exchange-svc or the Keycloak realm — never in the UI.
 *
 *   node diff.js baseline.json kc.json [--json=report.json]
 *
 * Divergence classes (in severity order):
 *   MISSING      endpoint the baseline calls that KC never does
 *   EXTRA        endpoint only the KC run calls (KC/overlay traffic is
 *                classified separately as EXPECTED-AUTH, not a failure)
 *   STATUS       same endpoint, different response status (e.g. 200 -> 401)
 *   AUTH_SHAPE   same endpoint, different credential kind (uuid vs jwt) —
 *                DIGIT services expect the native uuid token
 *   BODY_SHAPE   same endpoint, different request payload keys / RequestInfo
 * ============================================================================
 */
const fs = require('fs');

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--'))
  .map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] === undefined ? true : m[2]]; }));
if (files.length < 2) { console.error('usage: diff.js baseline.json kc.json [--json=report.json]'); process.exit(2); }

const A = JSON.parse(fs.readFileSync(files[0], 'utf8')); // baseline (digit auth)
const B = JSON.parse(fs.readFileSync(files[1], 'utf8')); // kc

/**
 * Auth-plane traffic — the login mechanism itself, which is EXPECTED to differ:
 * the default UI mints a session at /user/oauth/token, the KC build does it via
 * Keycloak + the token-exchange overlay. Parity is about the DIGIT calls that
 * come AFTER login, not about how the session was obtained.
 */
function isAuthPlane(c) {
  const p = c.normPath;
  return /\/auth\/realms\//.test(p) || /\/token-exchange\//.test(p)
      || /openid-connect/.test(p) || /\/realms\//.test(p)
      || /^\/user\/oauth\/token$/.test(p);
}

/**
 * The KC build prefixes DIGIT calls with /kc so token-exchange-svc sees them
 * first, swaps the Keycloak JWT for a real DIGIT token, and forwards the SAME
 * request upstream. So /kc/user/_search IS /user/_search from DIGIT's point of
 * view — compare on the effective endpoint, or every proxied call would look
 * like a divergence.
 */
function effectivePath(c) { return c.normPath.replace(/^\/kc(?=\/)/, ''); }

/**
 * Paths the KC deployment routes through token-exchange-svc. /kc/* is explicit
 * in the URL; others (e.g. /mdms-v2/) are routed at the nginx layer and so look
 * identical to the browser. On these the browser legitimately presents a KC JWT
 * while DIGIT still receives a native uuid token.
 */
const OVERLAY_PATHS = String(flags['overlay-paths'] || '/kc/,/mdms-v2/,/localization/')
  .split(',').map((x) => x.trim()).filter(Boolean);
function isOverlayRouted(c) {
  return OVERLAY_PATHS.some((pre) => c.normPath.startsWith(pre));
}
/** Static asset / app shell noise we don't want in the verdict. */
function isAppNoise(c) {
  return c.resourceType === 'document' || /\.(js|css|map|json|svg|png|ico|woff2?)$/i.test(c.path)
      || /^\/digit-ui\//.test(effectivePath(c));
}
/** The DIGIT API surface — what parity is actually about. */
function isDigitApi(c) { return !isAuthPlane(c) && !isAppNoise(c); }

const key = (c) => `${c.method} ${effectivePath(c)}`;

function index(cap) {
  const m = new Map();
  for (const c of cap.calls) {
    if (!isDigitApi(c)) continue;
    const k = key(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}
const ia = index(A), ib = index(B);
const findings = [];
const proxied = [];  // by-design overlay translations (browser jwt -> DIGIT uuid)

// endpoints the baseline exercises that KC does not
for (const [k, aCalls] of ia) {
  if (!ib.has(k)) { findings.push({ type: 'MISSING', endpoint: k, detail: `baseline called it ${aCalls.length}x; KC never did` }); }
}
// endpoints only KC makes (non-auth-plane => genuinely extra)
for (const [k, bCalls] of ib) {
  if (!ia.has(k)) { findings.push({ type: 'EXTRA', endpoint: k, detail: `KC-only call (${bCalls.length}x, status ${[...new Set(bCalls.map((c) => c.status))].join('/')})` }); }
}
// shared endpoints: compare status / credential kind / payload shape
for (const [k, aCalls] of ia) {
  const bCalls = ib.get(k); if (!bCalls) continue;
  const sA = [...new Set(aCalls.map((c) => String(c.status)))].sort().join(',');
  const sB = [...new Set(bCalls.map((c) => String(c.status)))].sort().join(',');
  if (sA !== sB) findings.push({ type: 'STATUS', endpoint: k, detail: `baseline=${sA} kc=${sB}` });

  const tA = [...new Set(aCalls.map((c) => (c.body && c.body.RequestInfo && c.body.RequestInfo.authTokenShape) || c.authHeaderShape || 'none'))].sort().join(',');
  const tB = [...new Set(bCalls.map((c) => (c.body && c.body.RequestInfo && c.body.RequestInfo.authTokenShape) || c.authHeaderShape || 'none'))].sort().join(',');
  // A jwt-vs-uuid difference on an overlay-proxied (/kc/...) call is BY DESIGN:
  // the browser legitimately holds a Keycloak JWT, and token-exchange-svc swaps
  // it for a native DIGIT token before forwarding. What DIGIT receives is the
  // uuid token — verify that in the overlay's [UPSTREAM] log lines, not here.
  const allProxied = bCalls.every(isOverlayRouted);
  if (tA !== tB) {
    // On overlay-routed paths the ONLY legitimate difference is the credential
    // kind: wherever the default UI sends a DIGIT uuid, the KC build sends a KC
    // jwt (unauthenticated calls stay 'none' on both). If substituting uuid for
    // jwt makes the two sets identical, nothing else diverged.
    const tBasIfTranslated = tB.split(',').map((x) => (x === 'jwt' ? 'uuid' : x)).sort().join(',');
    if (allProxied && tBasIfTranslated === tA.split(',').sort().join(',')) {
      proxied.push({ endpoint: k, detail: `browser sends jwt; token-exchange-svc forwards a DIGIT uuid token upstream` });
    } else {
      findings.push({ type: 'AUTH_SHAPE', endpoint: k, detail: `baseline token=${tA} kc token=${tB}` });
    }
  }

  const shape = (calls) => [...new Set(calls.map((c) => (c.body && c.body.keys ? c.body.keys.join('+') : '-')))].sort().join(' | ');
  const kA = shape(aCalls), kB = shape(bCalls);
  if (kA !== kB) findings.push({ type: 'BODY_SHAPE', endpoint: k, detail: `baseline keys=[${kA}] kc keys=[${kB}]` });
}

// ------------------------------------------------------------- report
const authPlane = B.calls.filter(isAuthPlane);
const order = { MISSING: 0, STATUS: 1, AUTH_SHAPE: 2, BODY_SHAPE: 3, EXTRA: 4 };
findings.sort((x, y) => order[x.type] - order[y.type] || x.endpoint.localeCompare(y.endpoint));

const line = '='.repeat(78);
console.log(line);
console.log(`KC PARITY REPORT — journey=${A.meta.journey}`);
console.log(`  baseline : ${A.meta.base}  (${A.calls.length} calls, ${ia.size} DIGIT endpoints)`);
console.log(`  keycloak : ${B.meta.base}  (${B.calls.length} calls, ${ib.size} DIGIT endpoints)`);
console.log(line);

console.log('\nSESSION (did the app end up authenticated?)');
const sess = (c, s) => `  ${c.padEnd(9)} token=${s.hasToken ? 'YES' : 'NO '} len=${String(s.tokenLen || 0).padEnd(5)} tenant=${s.userTenantId || '-'} roles=${s.userRoleCount ?? '-'} url=${(s.url || '-').replace(/^https?:\/\/[^/]+/, '')}`;
console.log(sess('baseline', A.session || {}));
console.log(sess('keycloak', B.session || {}));

console.log(`\nAUTH-PLANE CALLS (KC-only, expected): ${authPlane.length}`);
for (const c of [...new Map(authPlane.map((c) => [key(c), c])).values()].slice(0, 12)) {
  console.log(`  ${String(c.status).padEnd(6)} ${c.method} ${c.normPath}`);
}

if (proxied.length) {
  console.log(`\nBY-DESIGN OVERLAY TRANSLATIONS: ${proxied.length} (browser JWT -> DIGIT uuid, same endpoint)`);
  for (const p of proxied) console.log(`  ${p.endpoint}\n               ${p.detail}`);
}

if (!findings.length) {
  console.log('\n✅ FULL PARITY — the Keycloak build emits the same DIGIT calls as the default UI.');
} else {
  console.log(`\n❌ ${findings.length} DIVERGENCE(S) — fix in token-exchange-svc or realm settings only:\n`);
  for (const f of findings) console.log(`  [${f.type.padEnd(10)}] ${f.endpoint}\n               ${f.detail}`);
}

if (A.meta.error || B.meta.error) {
  console.log('\nJOURNEY ERRORS');
  if (A.meta.error) console.log(`  baseline: ${A.meta.error}`);
  if (B.meta.error) console.log(`  keycloak: ${B.meta.error}`);
}
if ((B.consoleErrors || []).length) {
  console.log('\nKC CONSOLE ERRORS (first 5)');
  for (const e of B.consoleErrors.slice(0, 5)) console.log(`  - ${e}`);
}
console.log(`\n${line}`);

if (flags.json) {
  fs.writeFileSync(flags.json, JSON.stringify({
    journey: A.meta.journey, baseline: A.meta.base, kc: B.meta.base,
    sessions: { baseline: A.session, kc: B.session },
    authPlaneCount: authPlane.length, findings,
  }, null, 2));
  console.log(`report -> ${flags.json}`);
}
process.exit(findings.length ? 1 : 0);
