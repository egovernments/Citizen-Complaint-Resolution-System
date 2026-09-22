#!/usr/bin/env node
'use strict';
/*
 * ============================================================================
 * capture.js — record every network call a DIGIT UI journey makes
 * ============================================================================
 *
 * Drives the SAME user journey against two deployments of the SAME digit-ui
 * build that differ only in globalConfigs auth provider:
 *
 *   baseline : authProvider=digit    (native-auth deployment)
 *   kc       : authProvider=keycloak (keycloak deployment)
 *
 * Keycloak is meant to be a pass-through: token-exchange-svc should make the
 * app emit the SAME downstream DIGIT calls the default UI does. This captures
 * the evidence; diff.js turns two captures into a parity verdict.
 *
 * Usage:
 *   node capture.js --base=https://host --journey=boot|citizen|employee \
 *                   --out=file.json [--user=U --pass=P] [--mobile=M --otp=123456]
 *                   [--headed] [--timeout=60000]
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(resolvePlaywright());

function resolvePlaywright() {
  // playwright lives in local-setup/tests/node_modules
  const candidates = [
    path.resolve(__dirname, '../../node_modules/playwright'),
    path.resolve(__dirname, '../../../node_modules/playwright'),
    'playwright',
  ];
  for (const c of candidates) { try { require.resolve(c); return c; } catch { /* next */ } }
  throw new Error('playwright not found — run npm i in local-setup/tests');
}

// ---------------------------------------------------------------- args
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const BASE = (args.base || '').replace(/\/$/, '');
const JOURNEY = args.journey || 'boot';
const OUT = args.out || `capture-${JOURNEY}.json`;
const TIMEOUT = parseInt(args.timeout || '60000', 10);
if (!BASE) { console.error('ERROR: --base=<url> required'); process.exit(2); }

// ------------------------------------------------------- normalization
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Collapse volatile path segments so two runs are comparable. */
function normalizePath(pathname) {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (UUID_RE.test(seg)) return ':uuid';
      if (/^\d+$/.test(seg)) return ':n';
      if (/^[A-Z]{2}-[A-Z]+-\d{4}-\d{2}-\d{2}-\d+$/.test(seg)) return ':complaintId';
      return seg;
    })
    .join('/');
}

/** What KIND of credential is this — the crux of the KC-vs-DIGIT comparison. */
function tokenShape(tok) {
  if (!tok) return 'none';
  if (JWT_RE.test(tok)) return 'jwt';       // Keycloak RS256 access token
  if (UUID_RE.test(tok)) return 'uuid';     // native DIGIT (egov-user) token
  return 'other';
}

/** Structural fingerprint of a JSON body: keys only, never values (no PII/secrets). */
function bodyShape(raw) {
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); } catch {
    // form-urlencoded (login posts). Record keys + the non-secret discriminators
    // that decide DIGIT behaviour — never the password.
    if (/^[^=&]+=[^&]*(&|$)/.test(raw)) {
      const p = new URLSearchParams(raw);
      const form = { _form: true, keys: [...p.keys()].sort() };
      for (const k of ['grant_type', 'tenantId', 'userType', 'scope', 'client_id']) {
        if (p.has(k)) form[k] = p.get(k);
      }
      if (p.has('username')) form.usernameLen = (p.get('username') || '').length;
      return form;
    }
    return { _nonJson: true, _len: raw.length };
  }
  if (!obj || typeof obj !== 'object') return { _scalar: typeof obj };
  const shape = { keys: Object.keys(obj).sort() };
  const ri = obj.RequestInfo;
  if (ri && typeof ri === 'object') {
    shape.RequestInfo = {
      keys: Object.keys(ri).sort(),
      authTokenShape: tokenShape(ri.authToken),
      hasUserInfo: !!ri.userInfo,
      userInfoKeys: ri.userInfo && typeof ri.userInfo === 'object'
        ? Object.keys(ri.userInfo).sort() : undefined,
      userInfoRoleCount: Array.isArray(ri.userInfo && ri.userInfo.roles)
        ? ri.userInfo.roles.length : undefined,
      userInfoTenantId: ri.userInfo ? ri.userInfo.tenantId : undefined,
    };
  }
  return shape;
}

// ------------------------------------------------------------ journeys
async function journeyBoot(page) {
  await page.goto(`${BASE}/digit-ui/citizen`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(6000); // let boot MDMS/localization settle
  return 'loaded citizen landing (unauthenticated boot)';
}

async function journeyCitizen(page) {
  const mobile = args.mobile || '9999999999';
  const otp = args.otp || '123456';
  await page.goto(`${BASE}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(3000);
  const mob = page.locator('input[name="mobileNumber"], input[type="tel"]').first();
  if (await mob.count()) {
    await mob.fill(mobile);
    await page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("CONTINUE")').first().click();
    await page.waitForTimeout(5000);
    const otpBoxes = page.locator('input[type="tel"], input[name*="otp" i], input[maxlength="1"]');
    const n = await otpBoxes.count();
    if (n >= 6) { for (let i = 0; i < 6; i++) await otpBoxes.nth(i).fill(otp[i]); }
    else if (n >= 1) { await otpBoxes.first().fill(otp); }
    const next = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Verify")').first();
    if (await next.count()) await next.click();
    await page.waitForTimeout(7000);
  }
  // Put both sessions in the SAME state before measuring. The Keycloak adapter
  // auto-selects the citizen's home city at login; a native login leaves it
  // unset until the citizen picks one on /citizen/select-location. Comparing
  // "has a home city" against "hasn't" measures onboarding state, not the auth
  // path -- and the home-city key is what gates TopBar's notification-count
  // request. So perform the normal selection on both runs (idempotent where the
  // adapter already did it).
  try {
    await page.goto(`${BASE}/digit-ui/citizen/select-location`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(5000);
    const city = page.locator(`text=${args.city || 'Bomet County'}`).first();
    if (await city.count()) { await city.click({ timeout: 8000 }); await page.waitForTimeout(1200); }
    const cont = page.locator('button:has-text("Continue")').first();
    if (await cont.count()) await cont.click({ timeout: 8000 });
    await page.waitForTimeout(9000);
  } catch { /* best effort */ }

  await page.waitForTimeout(12000);
  return `citizen login attempted (mobile=${mobile})`;
}

async function journeyEmployee(page) {
  const user = args.user || 'bometadmin';
  const pass = args.pass || 'eGov@123';
  const city = args.city || '';
  await page.goto(`${BASE}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(6000);
  const u = page.locator('#emp-username, input[name="username"]').first();
  if (await u.count()) {
    await u.fill(user);
    await page.locator('#emp-password, input[name="password"]').first().fill(pass);

    // City is a button-driven <li> dropdown and is mandatory.
    try {
      const cityBtn = page.locator('button:has-text("Select city")').first();
      if (await cityBtn.count()) {
        await cityBtn.click({ timeout: 5000 });
        await page.waitForTimeout(1200);
        await page.locator(`li:has-text("${city}")`).first().click({ timeout: 6000 });
      }
    } catch { /* best effort */ }

    // Privacy consent gates the submit button. The <input> is React-controlled —
    // only a click on its <label> actually toggles it.
    try {
      const lbl = page.locator('label[for="privacy-component-check"]').first();
      if (await lbl.count()) await lbl.click({ timeout: 5000 });
    } catch { /* best effort */ }

    await page.waitForTimeout(800);
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click({ timeout: 15000 });
      await page.waitForTimeout(12000);
    } else {
      throw new Error('login submit stayed disabled (city/privacy/creds not satisfied)');
    }

    // Post-login interstitial: the language-selection screen appears on first
    // login for a session. Clear it so both runs reach the same home screen —
    // otherwise the run that stops here looks like it "never called" the
    // home-screen APIs and the diff reports phantom divergences.
    for (let i = 0; i < 3; i++) {
      if (!/language-selection/.test(page.url())) break;
      try {
        // a language must be chosen before Continue does anything
        const lang = page.locator(`button:has-text("${args.lang || 'English'}")`).first();
        if (await lang.count()) { await lang.click({ timeout: 6000 }); await page.waitForTimeout(800); }
        const cont = page.locator('button:has-text("Continue"), button:has-text("CONTINUE")').first();
        if (await cont.count()) await cont.click({ timeout: 8000 });
      } catch { /* best effort */ }
      await page.waitForTimeout(7000);
    }
  }
  // exercise an authenticated screen so post-login API calls are captured
  try {
    await page.goto(`${BASE}/digit-ui/employee`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(5000);
  } catch { /* best effort */ }
  return `employee login attempted (user=${user})`;
}

/**
 * The surface an officer actually works on: inbox list, then a complaint detail
 * page (which pulls workflow history, HRMS actors, boundary and MDMS config).
 * Far more DIGIT calls than login, so it's the real parity test.
 */
async function journeyInbox(page) {
  const note = await journeyEmployee(page);
  const seen = [];
  for (const path of ['/digit-ui/employee/pgr/inbox', '/digit-ui/employee']) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(9000);
      seen.push(`${path} -> ${page.url().replace(BASE, '')}`);
      // open the first complaint if the inbox rendered any
      const link = page.locator('a[href*="pgr/complaint"], a[href*="/complaint/"]').first();
      if (await link.count()) {
        await link.click({ timeout: 8000 });
        await page.waitForTimeout(9000);
        seen.push(`opened -> ${page.url().replace(BASE, '')}`);
        break;
      }
    } catch { /* best effort */ }
  }
  return `${note}; ${seen.join(' | ')}`;
}

const JOURNEYS = { boot: journeyBoot, citizen: journeyCitizen, employee: journeyEmployee, inbox: journeyInbox };

// ---------------------------------------------------------------- main
(async () => {
  if (!JOURNEYS[JOURNEY]) { console.error(`ERROR: unknown journey ${JOURNEY}`); process.exit(2); }
  const browser = await chromium.launch({ headless: !args.headed, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const calls = [];
  const consoleErrors = [];
  const byReq = new Map();

  page.on('request', (req) => { byReq.set(req, Date.now()); });

  page.on('requestfinished', async (req) => {
    try {
      const url = new URL(req.url());
      const rt = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(rt)) return;
      let status = null;
      try { const r = await req.response(); status = r ? r.status() : null; } catch { /* ignore */ }
      const authHeader = (req.headers()['authorization'] || '').replace(/^Bearer\s+/i, '');
      calls.push({
        method: req.method(),
        origin: url.origin,
        path: url.pathname,
        normPath: normalizePath(url.pathname),
        searchKeys: [...url.searchParams.keys()].sort(),
        resourceType: rt,
        status,
        authHeaderShape: tokenShape(authHeader),
        body: bodyShape(req.postData()),
      });
    } catch { /* ignore */ }
  });

  page.on('requestfailed', (req) => {
    try {
      const url = new URL(req.url());
      calls.push({
        method: req.method(), origin: url.origin, path: url.pathname,
        normPath: normalizePath(url.pathname), searchKeys: [...url.searchParams.keys()].sort(),
        resourceType: req.resourceType(), status: 'FAILED',
        failure: (req.failure() || {}).errorText, authHeaderShape: 'none', body: bodyShape(req.postData()),
      });
    } catch { /* ignore */ }
  });

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

  let note = '', error = null;
  try { note = await JOURNEYS[JOURNEY](page); }
  catch (e) { error = String(e && e.message || e); }

  // post-journey session evidence (does the app consider itself logged in?)
  let session = {};
  try {
    session = await page.evaluate(() => {
      const pick = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
      const tok = pick('token') || pick('Citizen.token') || pick('Employee.token');
      const ui = pick('user-info') || pick('Citizen.user-info') || pick('Employee.user-info');
      let parsedUi = null; try { parsedUi = ui ? JSON.parse(ui) : null; } catch { /* */ }
      return {
        hasToken: !!tok,
        tokenLen: tok ? tok.length : 0,
        tokenSample: tok ? tok.slice(0, 12) : null,
        userInfoKeys: parsedUi ? Object.keys(parsedUi).sort() : null,
        userTenantId: parsedUi ? parsedUi.tenantId : null,
        userRoleCount: parsedUi && Array.isArray(parsedUi.roles) ? parsedUi.roles.length : null,
        url: location.href,
      };
    });
  } catch { /* ignore */ }
  if (session.tokenSample) session.tokenShape = tokenShape(session.tokenSample.length >= 12 ? null : null) || undefined;

  try { await page.screenshot({ path: OUT.replace(/\.json$/, '.png'), fullPage: false }); } catch { /* */ }

  const out = {
    meta: { base: BASE, journey: JOURNEY, note, error, at: new Date().toISOString(), finalUrl: session.url || null },
    session,
    consoleErrors: consoleErrors.slice(0, 25),
    calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`captured ${calls.length} calls -> ${OUT}${error ? `  (journey error: ${error})` : ''}`);
  await browser.close();
})();
