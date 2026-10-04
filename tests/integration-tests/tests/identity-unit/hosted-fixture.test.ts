import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { hostedSignIn, selectContext } from '../utils/identity-bff';

// A browser-level fixture check only. The hosted page here is a double, not Keycloak.
test('hosted browser form establishes the cookie used by context selection', async () => {
  const paths: string[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    paths.push(path);
    if (path === '/identity/v1/authorize') {
      response.writeHead(302, { Location: '/auth/realms/test/login' }).end();
    } else if (path === '/auth/realms/test/login' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<form method="post"><input id="username" name="username"><input id="password" name="password" type="password"><button id="kc-login" type="submit">Log in</button></form>');
    } else if (path === '/auth/realms/test/login') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      if (form.get('username') !== 'fixture-user' || form.get('password') !== 'fixture-password') {
        response.writeHead(403).end(); return;
      }
      response.writeHead(302, { Location: '/configurator/login', 'Set-Cookie': 'identity=fixture-session; HttpOnly; Path=/' }).end();
    } else if (path === '/configurator/login') response.end('Signed in');
    else if (request.headers.cookie !== 'identity=fixture-session') response.writeHead(401).end('{}');
    else if (path === '/identity/v1/session') response.end(JSON.stringify({ authenticated: true }));
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
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await hostedSignIn(page, { baseURL, surface: 'configurator', username: 'fixture-user', password: 'fixture-password' });
    const context = await selectContext(page.request, baseURL, 'configurator', 'fixture');
    assert.equal(context.UserRequest.uuid, 'fixture-uuid');
    assert(paths.includes('/auth/realms/test/login'));
    assert(paths.includes('/identity/v1/session'));
    assert(!paths.some(path => path === '/user/oauth/token'));
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
