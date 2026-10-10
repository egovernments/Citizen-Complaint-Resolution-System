#!/usr/bin/env node
/**
 * Employee probe against the REAL routes.
 *
 * The earlier probe used `/pgr/inbox` and `/pgr/complaint/details/:id`, neither of
 * which is registered. An unmatched PrivateRoute renders the chrome and nothing
 * else — which is why the screens looked "broken" (no buttons, 0 rows) when they
 * were simply never reached. The registered routes are:
 *     /digit-ui/employee/pgr/inbox-v2
 *     /digit-ui/employee/pgr/complaint-details/:id
 * and "Search Complaint" on the home page is the link to inbox-v2.
 *
 * inbox-v2 also defaults to the MY tab, so an employee with nothing assigned to
 * them sees 0 rows until ALL is selected.
 *
 *   B=... EMP_USER=ADMIN EMP_PASS=... CID=PG-PGR-... node probe-employee-v2.js
 */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const B = (process.env.B || 'http://localhost:18080').replace(/\/$/, '');
const CID = process.env.CID || '';
const USER = process.env.EMP_USER || 'ADMIN';
const PASS = process.env.EMP_PASS || 'eGov@123';
const CITY = process.env.EMP_CITY || 'Bomet County';

const dump = (o) => JSON.stringify(o);

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  p.on('response', (r) => {
    if (r.status() >= 400 && /pgr|inbox|workflow|access|mdms|hrms/i.test(r.url())) {
      errs.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`);
    }
  });

  try {
    await p.goto(`${B}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await p.locator('#emp-username, input[name="username"]').first().fill(USER);
    await p.locator('#emp-password, input[name="password"]').first().fill(PASS);
    const cityBtn = p.locator('button:has-text("Select city")').first();
    if (await cityBtn.count()) {
      await cityBtn.click();
      await p.waitForTimeout(1200);
      await p.locator(`li:has-text("${CITY}")`).first().click({ timeout: 8000 }).catch(() => {});
    }
    const lbl = p.locator('label[for="privacy-component-check"]').first();
    if (await lbl.count()) await lbl.click();
    await p.waitForTimeout(700);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForTimeout(12000);
    for (let i = 0; i < 3 && /language-selection/.test(p.url()); i++) {
      const lang = p.locator('button:has-text("English")').first();
      if (await lang.count()) { await lang.click(); await p.waitForTimeout(900); }
      const cont = p.locator('button:has-text("Continue")').first();
      if (await cont.count()) await cont.click();
      await p.waitForTimeout(7000);
    }
    console.log('login landed:', p.url());

    // --- the real inbox ---
    await p.goto(`${B}/digit-ui/employee/pgr/inbox-v2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(12000);
    const inbox = await p.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 500).replace(/\n+/g, ' | '),
      tabs: [...document.querySelectorAll('button,div,li,span')]
        .map((e) => (e.innerText || '').trim())
        .filter((t) => /^(MY|ALL|My Complaints|All Complaints)$/i.test(t)),
      links: [...new Set([...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && /complaint/i.test(h)))].slice(0, 8),
      rows: document.querySelectorAll('tr').length,
    }));
    console.log('inbox-v2:', dump(inbox));

    // switch to the ALL tab — MY is the default and will be empty for a fresh officer
    const allTab = p.locator('button,div,li,span').filter({ hasText: /^(ALL|All Complaints)$/i }).first();
    if (await allTab.count()) {
      await allTab.click({ force: true }).catch(() => {});
      await p.waitForTimeout(10000);
      const after = await p.evaluate(() => ({
        rows: document.querySelectorAll('tr').length,
        links: [...new Set([...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && /complaint/i.test(h)))].slice(0, 8),
        text: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
      }));
      console.log('inbox-v2 ALL tab:', dump(after));
    } else {
      console.log('inbox-v2 ALL tab: not found');
    }

    // --- the real detail route ---
    if (CID) {
      await p.goto(`${B}/digit-ui/employee/pgr/complaint-details/${CID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(12000);
      const d = await p.evaluate(() => ({
        url: location.href,
        buttons: [...document.querySelectorAll('button')].map((x) => (x.innerText || '').trim()).filter(Boolean).slice(0, 16),
        headings: [...document.querySelectorAll('h1,h2,h3')].map((x) => (x.innerText || '').trim()).filter(Boolean).slice(0, 8),
        text: document.body.innerText.slice(0, 600).replace(/\n+/g, ' | '),
      }));
      console.log('complaint-details:', dump(d));

      // open the action menu so we can see the real ASSIGN/RESOLVE option labels
      const ta = p.locator('button').filter({ hasText: /Take Action|ACTION/i }).first();
      if (await ta.count()) {
        await ta.click({ force: true }).catch(() => {});
        await p.waitForTimeout(3000);
        const menu = await p.evaluate(() => ({
          options: [...document.querySelectorAll('.header-dropdown-option, [role="menuitem"], li')]
            .map((x) => (x.innerText || '').trim()).filter(Boolean).slice(0, 14),
        }));
        console.log('action menu:', dump(menu));
      } else {
        console.log('action menu: no Take Action button');
      }
    }
    console.log('errors:', dump(errs.slice(0, 12)));
  } catch (e) {
    console.log('ERROR:', String((e && e.message) || e).slice(0, 250));
    console.log('errors:', dump(errs.slice(0, 12)));
  }
  await b.close();
})();
