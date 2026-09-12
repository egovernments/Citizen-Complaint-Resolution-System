#!/usr/bin/env node
/**
 * Employee-side probe: log in, open a complaint's detail page, and dump what is
 * actually rendered (URL, buttons, headings). Used to pin down the assign/resolve
 * interactions without paying for a full Playwright spec run.
 *
 *   B=https://<native-auth-deployment> CID=PG-PGR-... node probe-employee.js
 */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const B = (process.env.B || 'http://localhost:18080').replace(/\/$/, '');
const CID = process.env.CID || '';
const USER = process.env.EMP_USER || 'ADMIN';
const PASS = process.env.EMP_PASS || 'eGov@123';
const CITY = process.env.EMP_CITY || 'Bomet County';

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true });
  try {
    await p.goto(`${B}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await p.locator('#emp-username, input[name="username"]').first().fill(USER);
    await p.locator('#emp-password, input[name="password"]').first().fill(PASS);
    const cityBtn = p.locator('button:has-text("Select city")').first();
    if (await cityBtn.count()) {
      await cityBtn.click(); await p.waitForTimeout(1200);
      await p.locator(`li:has-text("${CITY}")`).first().click({ timeout: 8000 });
    }
    const lbl = p.locator('label[for="privacy-component-check"]').first();
    if (await lbl.count()) await lbl.click();
    await p.waitForTimeout(800);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForTimeout(12000);
    for (let i = 0; i < 3 && /language-selection/.test(p.url()); i++) {
      const lang = p.locator('button:has-text("English")').first();
      if (await lang.count()) { await lang.click(); await p.waitForTimeout(800); }
      const cont = p.locator('button:has-text("Continue")').first();
      if (await cont.count()) await cont.click();
      await p.waitForTimeout(7000);
    }
    console.log('  after employee login:', p.url());

    // what does the employee home actually offer this user?
    await p.goto(`${B}/digit-ui/employee`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(11000);
    const home = await p.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
      links: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && h.includes('/employee')))].slice(0, 20),
    }));
    console.log('  home url:', home.url);
    console.log('  home text:', home.text);
    console.log('  home links:', JSON.stringify(home.links));

    // inbox first — confirms the employee can see work at all
    await p.goto(`${B}/digit-ui/employee/pgr/inbox`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(9000);
    const inbox = await p.evaluate(() => ({
      url: location.href,
      rows: document.querySelectorAll('a[href*="pgr/complaint"], tr').length,
      text: document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '),
    }));
    console.log('  inbox:', JSON.stringify(inbox));

    // The Inbox is jurisdiction-scoped; "Search Complaint" is not. Try reaching
    // the complaint that way, which is what a real officer would do.
    if (CID) {
      // The home "cards" are divs, not links — click the ancestor that actually
      // handles the navigation, and report where it lands.
      const searchCard = p.locator('div,span,a,button').filter({ hasText: /^Search Complaint$/i }).last();
      if (await searchCard.count()) {
        await searchCard.click({ force: true }).catch(() => {});
        await p.waitForTimeout(8000);
        console.log('  search page:', p.url());
        const sp = await p.evaluate(() => ({
          text: document.body.innerText.slice(0, 260).replace(/\n+/g, ' | '),
          inputs: [...document.querySelectorAll('input')].map((i) => ({ id: i.id, ph: i.placeholder })).slice(0, 8),
        }));
        console.log('  search screen:', JSON.stringify(sp));
        const inp = p.locator('input[type="text"]').first();
        if (await inp.count()) {
          await inp.fill(CID);
          const go = p.locator('button').filter({ hasText: /Search|SEARCH/i }).first();
          if (await go.count()) await go.click();
          await p.waitForTimeout(8000);
          const res = await p.evaluate(() => ({
            url: location.href,
            links: [...document.querySelectorAll('a[href*="complaint"]')].map((a) => a.getAttribute('href')).slice(0, 5),
            text: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '),
          }));
          console.log('  search result:', JSON.stringify(res));
          const link = p.locator('a[href*="complaint"]').first();
          if (await link.count()) { await link.click(); await p.waitForTimeout(9000); console.log('  opened via search:', p.url()); }
        }
      }
    }

    if (CID) {
      await p.goto(`${B}/digit-ui/employee/pgr/complaint/details/${CID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(11000);
      const d = await p.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 500).replace(/\n+/g, ' | '),
        buttons: [...document.querySelectorAll('button')].map((x) => (x.innerText || '').trim()).filter(Boolean).slice(0, 14),
      }));
      console.log('  detail url:', d.url);
      console.log('  detail buttons:', JSON.stringify(d.buttons));
      console.log('  detail text:', d.text);
    }
  } catch (e) {
    console.log('  ERROR:', String((e && e.message) || e).slice(0, 220));
  }
  await b.close();
})();
