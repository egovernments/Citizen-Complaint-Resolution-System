import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, type Page } from '@playwright/test';
import { enterHostedUsername, hostedSignIn, selectContext } from '../utils/identity-bff';

// Browser fixture checks only; the hosted form and landing application are doubles.
let browser: Awaited<ReturnType<typeof chromium.launch>>;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

type Options = { split?: boolean; result?: 'complete' | 'failed'; existingSession?: boolean; denySession?: boolean; consent?: boolean };
async function fixture(options: Options, run: (page: Page, baseURL: string, state: {
  paths: string[]; submissions: string[][]; resultReads: number;
}) => Promise<void>) {
  const state = { paths: [] as string[], submissions: [] as string[][], resultReads: 0 };
  const formPage = (passwordOnly = false) => `<form method="post" action="${passwordOnly ? '/auth/realms/test/password' : '/auth/realms/test/login'}">
    ${passwordOnly ? '' : '<input id="username" name="username">'}
    ${passwordOnly || !options.split ? '<input id="password" name="password" type="password" autocomplete="current-password">' : ''}
    ${options.consent ? `<div style="position:relative;display:inline-flex">
      <input id="privacy-component-check" type="checkbox" style="position:absolute;left:0;top:0;width:18px;height:18px;margin:0;opacity:0">
      <label for="privacy-component-check" class="dg-checkbox__box" style="display:block;width:18px;height:18px;border:1px solid">✓</label>
      <label for="privacy-component-check">Privacy consent</label>
    </div><input id="unrelated-checkbox" type="checkbox">` : ''}
    <button id="kc-login" type="submit" ${options.consent ? 'disabled' : ''}>Log in</button></form>
    ${options.consent ? `<script>
      const form = document.querySelector('form');
      const consent = document.getElementById('privacy-component-check');
      const button = document.getElementById('kc-login');
      const allowed = () => form.username.value.trim() && form.password.value.trim() && consent.checked;
      const update = () => { button.disabled = !allowed(); };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      form.addEventListener('submit', event => { if (!allowed()) event.preventDefault(); });
    </script>` : ''}`;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    state.paths.push(path);
    if (path === '/identity/v1/authorize') {
      response.writeHead(302, { Location: '/auth/realms/test/login' }).end();
    } else if (path === '/auth/realms/test/login' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html');
      response.end(formPage());
    } else if (path.startsWith('/auth/realms/test/') && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      state.submissions.push([...form.keys()]);
      if (options.split && path.endsWith('/login') && form.get('username') === 'fixture-user') {
        response.setHeader('Content-Type', 'text/html');
        response.end(formPage(true)); return;
      }
      if (form.get('password') !== 'fixture-password' || (!options.split && form.get('username') !== 'fixture-user')) {
        response.writeHead(403).end(); return;
      }
      const headers: Record<string, string> = { Location: `/configurator/login${options.result ? '?authResult=fixture-result' : ''}` };
      if (options.result !== 'failed') headers['Set-Cookie'] = 'identity=fixture-session; HttpOnly; Path=/';
      response.writeHead(302, headers).end();
    } else if (path === '/configurator/login') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<div id="result">Loading</div><script>
        const id = new URL(location.href).searchParams.get('authResult');
        if (id) {
          history.replaceState(null, '', '/configurator/login');
          fetch('/identity/v1/auth-results/' + id).then(r => r.json()).then(body => {
            document.getElementById('result').textContent = body.status || body.code;
          });
        }
      </script>`);
    } else if (path === '/identity/v1/auth-results/fixture-result') {
      state.resultReads++;
      // Consume exactly once, as GETDEL does. Delay completion until after the
      // app has removed the URL parameter, exercising the observation race.
      if (state.resultReads > 1) { response.writeHead(404).end('{"code":"AUTH_RESULT_NOT_FOUND"}'); return; }
      setTimeout(() => response.end(JSON.stringify({ status: options.result, code: options.result === 'failed' ? 'SIGN_IN_FAILED' : 'ACTION_COMPLETE' })), 80);
    } else if (request.headers.cookie !== 'identity=fixture-session') response.writeHead(401).end('{"code":"SESSION_REQUIRED"}');
    else if (path === '/identity/v1/session') response.end(JSON.stringify({ authenticated: !options.denySession }));
    else if (path === '/identity/v1/contexts/_select') response.end(JSON.stringify({
      access_token: 'fixture-token', token_type: 'bearer', expires_in: 300, scope: 'read',
      UserRequest: { uuid: 'fixture-uuid', tenantId: 'fixture', type: 'EMPLOYEE' },
    }));
    else response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseURL = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext();
  try {
    if (options.existingSession) await context.addCookies([{ name: 'identity', value: 'fixture-session', url: baseURL, httpOnly: true }]);
    await run(await context.newPage(), baseURL, state);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const signIn = (page: Page, baseURL: string) => hostedSignIn(page, { baseURL, surface: 'configurator', username: 'fixture-user', password: 'fixture-password' });

for (const split of [false, true]) {
  const layout = split ? 'split username then password' : 'combined username and password';
  test(`hosted browser ${layout} establishes the cookie used by context selection`, async () => fixture({ split }, async (page, base, state) => {
    await signIn(page, base);
    const context = await selectContext(page.request, base, 'configurator', 'fixture');
    assert.equal(context.UserRequest.uuid, 'fixture-uuid');
    assert.deepEqual(state.submissions, split ? [['username'], ['password']] : [['username', 'password']]);
    assert(state.paths.includes('/identity/v1/session'));
    assert(!state.paths.includes('/user/oauth/token'));
    assert.equal(state.resultReads, 0);
  }));

  test(`${layout}: fresh fields and password autocomplete are asserted on their actual pages`, async () => fixture({ split }, async (page, base, state) => {
    await page.goto(`${base}/auth/realms/test/login`);
    assert.equal(await page.locator('#username').inputValue(), '');
    await enterHostedUsername(page, 'fixture-user');
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(await page.locator('#password').getAttribute('autocomplete'), 'current-password');
    assert.equal(await page.locator('#tenantCode').count(), 0);
    assert.equal(state.submissions.length, split ? 1 : 0);
  }));

  test(`${layout}: app consumes one-use result after removing the URL parameter`, async () => fixture({ split, result: 'complete' }, async (page, base, state) => {
    await signIn(page, base);
    assert.equal(new URL(page.url()).searchParams.has('authResult'), false);
    assert.equal(await page.locator('#result').textContent(), 'complete');
    assert.equal(state.resultReads, 1);
    assert(state.paths.includes('/identity/v1/session'));
  }));

  test(`${layout}: app-consumed failure rejects even when an older session is valid`, async () => fixture({ split, result: 'failed', existingSession: true }, async (page, base, state) => {
    await assert.rejects(signIn(page, base), /Hosted sign-in was rejected by the BFF/);
    assert.equal(await page.locator('#result').textContent(), 'failed');
    assert.equal(state.resultReads, 1);
    assert.equal((await page.request.get(`${base}/identity/v1/session`)).status(), 200);
  }));
}

test('successful landing without an authenticated session is rejected', async () => fixture({ denySession: true }, async (page, base) => {
  await assert.rejects(signIn(page, base), /did not establish a BFF session/);
}));

// Mirrors employee Login.tsx's canSubmit gate and Privacy.tsx's styled checkbox.
test('employee consent gates Login and hosted helper checks only the required consent', async () => fixture({ consent: true, result: 'complete' }, async (page, base, state) => {
  page.setDefaultTimeout(3_000);
  await page.goto(`${base}/auth/realms/test/login`);
  await page.locator('#username').fill('fixture-user');
  await page.locator('#password').fill('fixture-password');
  assert.equal(await page.locator('#privacy-component-check').isChecked(), false);
  assert.equal(await page.locator('#kc-login').isDisabled(), true);
  assert.equal(state.submissions.length, 0);
  let consentAtSubmission = false;
  let unrelatedAtSubmission = true;
  await page.exposeFunction('observeConsent', (consented: boolean, unrelated: boolean) => {
    consentAtSubmission = consented;
    unrelatedAtSubmission = unrelated;
  });
  await page.addInitScript(() => {
    document.addEventListener('submit', () => {
      void (window as any).observeConsent(
        (document.getElementById('privacy-component-check') as HTMLInputElement).checked,
        (document.getElementById('unrelated-checkbox') as HTMLInputElement).checked,
      );
    });
  });
  await signIn(page, base);
  assert.equal(consentAtSubmission, true);
  assert.equal(unrelatedAtSubmission, false);
  assert.equal(state.resultReads, 1);
  assert.equal((await selectContext(page.request, base, 'employee', 'fixture')).UserRequest.uuid, 'fixture-uuid');
}));
