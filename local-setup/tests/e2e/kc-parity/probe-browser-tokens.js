#!/usr/bin/env node
/**
 * Does the browser ever hold a DIGIT uuid token under Keycloak?
 *
 * The request audit only proves what is SENT. token-exchange-svc resolves and
 * caches the acting user's DIGIT token server-side, so the question worth asking
 * is whether any of it is handed back to the SPA — in an auth response body, or
 * in localStorage / sessionStorage.
 *
 * Values are never printed, only their shape.
 *
 *   B=https://<keycloak-deployment> WHO=citizen node probe-browser-tokens.js
 */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const B = (process.env.B || 'http://localhost:18080').replace(/\/$/, '');
const WHO = process.env.WHO || 'citizen';
const MOBILE = process.env.CITIZEN_MOBILE || '712345678';
const OTP = process.env.OTP || '123456';
const EMP_USER = process.env.EMP_USER || 'ADMIN';
const EMP_PASS = process.env.EMP_PASS || 'eGov@123';
const EMP_CITY = process.env.EMP_CITY || 'Bomet County';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;

function shape(v) {
  if (typeof v !== 'string' || !v) return null;
  if (JWT.test(v)) return 'jwt';
  if (UUID.test(v)) return 'uuid';
  return null;
}

/** Walk parsed JSON looking for uuid/jwt-shaped strings, reporting their paths. */
function scan(obj, prefix, hits, depth = 0) {
  if (depth > 6 || obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    const s = shape(obj);
    if (s) hits.push(`${prefix} = <${s}>`);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scan(v, `${prefix}[${i}]`, hits, depth + 1));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) scan(v, prefix ? `${prefix}.${k}` : k, hits, depth + 1);
  }
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true });

  // Any auth-ish response that could hand a DIGIT token back to the SPA.
  p.on('response', async (r) => {
    if (!/oauth\/token|openid-connect\/token|_login|authenticate|token-exchange/.test(r.url())) return;
    try {
      const j = await r.json();
      const hits = [];
      scan(j, '', hits);
      console.log(`RESPONSE ${r.status()} ${r.url().replace(/\?.*$/, '')}`);
      console.log('  top-level keys:', JSON.stringify(Object.keys(j)));
      console.log('  token-shaped values:', hits.length ? JSON.stringify(hits) : '(none)');
    } catch (_) { /* not JSON */ }
  });

  try {
    if (WHO === 'citizen') {
      await p.goto(`${B}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await p.waitForTimeout(6000);
      await p.locator('input[type="tel"], input[name="mobileNumber"]').first().fill(MOBILE);
      await p.locator('button:has-text("Continue"), button[type="submit"]').first().click();
      await p.waitForTimeout(7000);
      const boxes = p.locator('input[type="tel"], input[maxlength="1"]');
      const n = await boxes.count();
      if (n >= 6) { for (let i = 0; i < 6; i++) await boxes.nth(i).fill(OTP[i]); }
      else if (n >= 1) { await boxes.first().fill(OTP); }
      const next = p.locator('button:has-text("Continue"), button:has-text("Verify"), button[type="submit"]').first();
      if (await next.count()) await next.click();
      await p.waitForTimeout(12000);
    } else {
      await p.goto(`${B}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await p.waitForTimeout(6000);
      await p.locator('#emp-username').first().fill(EMP_USER);
      await p.locator('#emp-password').first().fill(EMP_PASS);
      const cityBtn = p.locator('button:has-text("Select city")').first();
      if (await cityBtn.count()) {
        await cityBtn.click(); await p.waitForTimeout(1200);
        await p.locator(`li:has-text("${EMP_CITY}")`).first().click({ timeout: 8000 }).catch(() => {});
      }
      const lbl = p.locator('label[for="privacy-component-check"]').first();
      if (await lbl.count()) await lbl.click();
      await p.waitForTimeout(700);
      await p.locator('button[type="submit"]').first().click();
      await p.waitForTimeout(12000);
      for (let i = 0; i < 3 && /language-selection/.test(p.url()); i++) {
        const l = p.locator('button:has-text("English")').first();
        if (await l.count()) { await l.click(); await p.waitForTimeout(900); }
        const c = p.locator('button:has-text("Continue")').first();
        if (await c.count()) await c.click();
        await p.waitForTimeout(7000);
      }
    }
    console.log('landed:', p.url());

    const store = await p.evaluate(() => {
      const dump = (s) => {
        const out = {};
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          out[k] = s.getItem(k);
        }
        return out;
      };
      return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
    });

    for (const [where, bag] of Object.entries(store)) {
      console.log(`\n--- ${where}Storage: ${Object.keys(bag).length} keys`);
      for (const [k, raw] of Object.entries(bag)) {
        const hits = [];
        const direct = shape(raw);
        if (direct) hits.push(`<${direct}>`);
        try { scan(JSON.parse(raw), '', hits); } catch (_) { /* plain string */ }
        if (hits.length) console.log(`  ${k}: ${JSON.stringify(hits)}`);
      }
      const uuidKeys = Object.entries(bag).filter(([, raw]) => {
        if (shape(raw) === 'uuid') return true;
        try { const h = []; scan(JSON.parse(raw), '', h); return h.some((x) => x.endsWith('<uuid>')); }
        catch (_) { return false; }
      }).map(([k]) => k);
      console.log(`  >> uuid-shaped values present in ${where}Storage: ${uuidKeys.length ? JSON.stringify(uuidKeys) : 'NONE'}`);
    }
  } catch (e) {
    console.log('ERROR:', String((e && e.message) || e).slice(0, 250));
  }
  await b.close();
})();
