#!/usr/bin/env node
/**
 * Bomet's employee login lists TWO cities labelled "Bomet County" — one bound to
 * the state tenant `ke`, one to `ke.bomet`. Picking the wrong one silently fails
 * the login (the form just re-renders). This tries each matching entry in turn
 * and reports which index actually logs the user in.
 *
 *   B=<url> EMP_USER=... EMP_PASS=... node probe-city-index.js
 */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const B = (process.env.B || 'http://localhost:18080').replace(/\/$/, '');
const USER = process.env.EMP_USER || 'ADMIN';
const PASS = process.env.EMP_PASS || 'eGov@123';
const LABEL = process.env.EMP_CITY || 'Bomet County';

(async () => {
  for (let idx = 0; idx < 3; idx++) {
    const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const p = await b.newPage({ ignoreHTTPSErrors: true });
    try {
      await p.goto(`${B}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(6000);
      await p.locator('#emp-username').first().fill(USER);
      await p.locator('#emp-password').first().fill(PASS);
      await p.locator('button:has-text("Select city")').first().click();
      await p.waitForTimeout(1500);
      const opts = p.locator(`li:has-text("${LABEL}")`);
      const n = await opts.count();
      if (idx === 0) console.log(`  "${LABEL}" entries: ${n}`);
      if (idx >= n) { await b.close(); break; }
      await opts.nth(idx).click();
      await p.waitForTimeout(800);
      const lbl = p.locator('label[for="privacy-component-check"]').first();
      if (await lbl.count()) await lbl.click();
      await p.waitForTimeout(600);
      await p.locator('button[type="submit"]').first().click();
      await p.waitForTimeout(11000);
      const ok = !/user\/login/.test(p.url());
      console.log(`  index ${idx}: ${ok ? 'LOGGED IN' : 'failed'} -> ${p.url().replace(B, '')}`);
      if (ok) { await b.close(); break; }
    } catch (e) {
      console.log(`  index ${idx}: ERROR ${String((e && e.message) || e).slice(0, 90)}`);
    }
    await b.close();
  }
})();
