#!/usr/bin/env node
/**
 * Wizard cascade probe. Logs in as a citizen, opens the create-complaint form,
 * then walks the N-level "Select…" cascade printing what each level offers.
 * Debugging the spec through this is far faster than through Playwright's runner.
 *
 *   B=https://<your-deployment> node probe-cascade.js
 */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const B = (process.env.B || 'http://localhost:18080').replace(/\/$/, '');
const MOBILE = process.env.MOBILE || '712345678';
const OTP = process.env.OTP || '123456';
const WANT = new RegExp(process.env.WANT || 'garbage', 'i');

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true });
  try {
    await p.goto(`${B}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(4000);
    await p.locator('input[type="tel"]').first().fill(MOBILE);
    await p.locator('button:has-text("Continue")').first().click();
    await p.waitForTimeout(5000);
    const bx = p.locator('input[type="tel"], input[maxlength="1"]');
    const n = await bx.count();
    if (n >= 6) { for (let i = 0; i < 6; i++) await bx.nth(i).fill(OTP[i]); }
    else if (n >= 1) await bx.first().fill(OTP);
    const nx = p.locator('button:has-text("Continue"), button:has-text("Verify"), button[type=submit]').first();
    if (await nx.count()) await nx.click();
    await p.waitForTimeout(9000);
    console.log('  after login:', p.url());

    await p.goto(`${B}/digit-ui/citizen/pgr/create-complaint`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(9000);

    for (let lvl = 0; lvl < 6; lvl++) {
      const trig = p.locator('button', { hasText: /^Select(…|\s|$)/ }).first();
      if (!(await trig.count())) { console.log(`  L${lvl}: no 'Select…' left`); break; }
      if (!(await trig.isEnabled().catch(() => false))) { console.log(`  L${lvl}: disabled`); break; }
      await trig.click();
      await p.waitForTimeout(1500);
      const opts = p.locator('li, [role="option"], .digit-dropdown-item');
      const oc = await opts.count();
      const sample = [];
      for (let i = 0; i < Math.min(oc, 8); i++) sample.push(((await opts.nth(i).innerText().catch(() => '')) || '').trim().slice(0, 26));
      console.log(`  L${lvl}: options=${oc} ${JSON.stringify(sample)}`);
      if (!oc) break;
      let idx = 0;
      for (let i = 0; i < oc; i++) {
        const t = ((await opts.nth(i).innerText().catch(() => '')) || '');
        if (WANT.test(t)) { idx = i; break; }
      }
      await opts.nth(idx).click();
      await p.waitForTimeout(2000);
      console.log(`      picked[${idx}]="${sample[idx] || ''}"`);
    }

    // Walk the wizard steps, showing what each one requires before NEXT enables.
    for (let step = 0; step < 6; step++) {
      const dump = await p.evaluate(() => ({
        text: document.body.innerText.slice(0, 220).replace(/\n+/g, ' | '),
        inputs: [...document.querySelectorAll('input,textarea')].map((i) => ({ t: i.type || i.tagName, n: i.name, id: i.id, ph: i.placeholder, v: (i.value||'').slice(0,14) })).slice(0, 8),
        sel: [...document.querySelectorAll('button')].filter((x) => /^Select(…|\s|$)/.test((x.innerText||'').trim())).length,
        next: (() => { const b=[...document.querySelectorAll('button')].find(x=>/^(NEXT|SUBMIT)$/i.test((x.innerText||'').trim())); return b?{t:b.innerText.trim(),d:b.disabled}:null; })(),
      }));
      console.log(`  STEP${step}: next=${JSON.stringify(dump.next)} selects=${dump.sel}`);
      if (/Pin Complaint Location/i.test(dump.text)) {
        const sb = p.locator('input[placeholder="Search here"]').first();
        if (await sb.count()) {
          await sb.click();
          await sb.fill('');
          await sb.pressSequentially(process.env.PLACE || 'Bomet', { delay: 120 });
          await p.waitForTimeout(3500);
          const sug = p.locator('li, [role="option"], [class*="suggestion" i], [class*="result" i]');
          const sc = await sug.count();
          const names = [];
          for (let i=0;i<Math.min(sc,5);i++) names.push(((await sug.nth(i).innerText().catch(()=>''))||'').trim().slice(0,30));
          console.log(`     map suggestions=${sc} ${JSON.stringify(names)}`);
          if (sc) { await sug.first().click(); await p.waitForTimeout(4000); console.log('     picked first suggestion'); }
          else {
            const box = await p.locator('canvas, [class*="map" i]').first().boundingBox().catch(()=>null);
            if (box) { await p.mouse.click(box.x + box.width/2, box.y + box.height/2); await p.waitForTimeout(3500); console.log('     clicked map centre'); }
          }
        }
      }
      if (/Location Details/i.test(dump.text)) {
        const full = await p.evaluate(() => document.body.innerText.replace(/\n+/g,' | ').slice(0, 700));
        console.log(`     FULL Location Details: ${full}`);
      }
      console.log(`     text: ${dump.text}`);
      console.log(`     inputs: ${JSON.stringify(dump.inputs)}`);
      if (!dump.next) break;
      if (dump.next.d) {
        console.log('     >>> NEXT DISABLED — filling fields to see what unlocks it');
        // fill() sets .value but React may never see it; real keystrokes + blur do.
        for (const mode of ['type+blur', 'fill+blur', 'type-only']) {
          const el = p.locator('#postal-code');
          const lm = p.locator('#landmark');
          if (await el.count()) {
            await el.click(); await el.press('Control+a').catch(()=>{}); await el.press('Backspace').catch(()=>{});
            if (mode.startsWith('type')) await el.pressSequentially('20400', { delay: 90 });
            else await el.fill('20400');
          }
          if (await lm.count()) {
            await lm.click();
            if (mode.startsWith('type')) await lm.pressSequentially('Near the market', { delay: 30 });
            else await lm.fill('Near the market');
          }
          if (mode.endsWith('blur')) { await p.keyboard.press('Tab'); }
          const pc = mode;
          await p.waitForTimeout(1800);
          const st2 = await p.evaluate(() => ({
            d: (() => { const b=[...document.querySelectorAll('button')].find(x=>/^(NEXT|SUBMIT)$/i.test((x.innerText||'').trim())); return b?b.disabled:null; })(),
            errs: [...document.querySelectorAll('[class*=error i],[class*=Error]')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,3),
            sel: [...document.querySelectorAll('button')].filter(x=>/^Select(…|\s|$)/.test((x.innerText||'').trim())).length,
            inputs: [...document.querySelectorAll('input,textarea')].map(i=>({id:i.id, v:(i.value||'').slice(0,12)})).slice(0,8),
          }));
          console.log(`     postal="${pc}" -> nextDisabled=${st2.d} selects=${st2.sel} errs=${JSON.stringify(st2.errs)} inputs=${JSON.stringify(st2.inputs)}`);
          if (st2.d === false) { console.log('     >>> UNLOCKED with postal=' + pc); break; }
        }
        const again = await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/^(NEXT|SUBMIT)$/i.test((x.innerText||'').trim())); return b?b.disabled:true; });
        if (again) break;
      }
      const nb = p.locator('button').filter({ hasText: /^(NEXT|SUBMIT)$/i }).last();
      await nb.click();
      await p.waitForTimeout(6000);
    }
  } catch (e) {
    console.log('  ERROR:', String(e && e.message || e).slice(0, 200));
  }
  await b.close();
})();
