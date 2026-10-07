import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as playwrightRequest } from '@playwright/test';
import { authorizeUrl, citizenSignIn, configuredOtp, identityJson, selectContext } from '../utils/identity-bff';

// This server is a contract double, NOT Keycloak/egov/OTP gate evidence.
const tenant = { tenantId: 'testtenant', urlSlug: 'test-workspace' };
const token = {
  access_token: 'test-opaque-token', token_type: 'bearer', expires_in: 3600, scope: 'read',
  UserRequest: { uuid: 'test-uuid', tenantId: tenant.tenantId, type: 'CITIZEN' }, tenant,
};
async function fixture(run: (ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>, base: string, calls: Array<{ path: string; body: any; cookie?: string }>) => Promise<void>, options: { failure?: string; context?: unknown; cooldown?: boolean; tenant?: typeof tenant } = {}) {
  const routeTenant = options.tenant ?? tenant;
  const calls: Array<{ path: string; body: any; cookie?: string }> = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url!;
    calls.push({ path, body, cookie: req.headers.cookie });
    res.setHeader('Content-Type', 'application/json');
    if (path === options.failure) { res.writeHead(503).end(JSON.stringify({ code: 'IDENTITY_UNAVAILABLE', error: 'secret-must-not-leak' })); return; }
    if (path.startsWith('/identity/v1/tenant-contexts/')) res.end(JSON.stringify({ tenant: routeTenant }));
    else if (path.endsWith('/otp/_send')) {
      if (options.cooldown && calls.filter(call => call.path.endsWith('/otp/_send')).length === 1) {
        res.writeHead(429, { 'Retry-After': '0' }).end(JSON.stringify({ code: 'OTP_RESEND_TOO_SOON' }));
      } else res.writeHead(202).end(JSON.stringify({ challengeId: 'test-challenge-id' }));
    }
    else if (path.endsWith('/otp/_verify')) {
      res.setHeader('Set-Cookie', 'identity_citizen=test-session; HttpOnly; Path=/');
      res.end(JSON.stringify({ authenticated: true, tenant: routeTenant }));
    } else if (path.endsWith('/_select')) {
      if (body.surface === 'citizen' && req.headers.cookie !== 'identity_citizen=test-session') { res.writeHead(401).end('{}'); return; }
      res.end(JSON.stringify(options.context ?? token));
    } else res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert(addr && typeof addr !== 'string');
  const request = await playwrightRequest.newContext();
  process.env.IDENTITY_TEST_TENANT_SLUG = routeTenant.urlSlug;
  try { await run(request, `http://127.0.0.1:${addr.port}`, calls); }
  finally { await request.dispose(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test('OTP challenge verification carries the HttpOnly cookie to citizen _select', async () => {
  await fixture(async (request, base, calls) => {
    const result = await citizenSignIn(request, base, '712345678', async challenge => {
      assert(Number.isFinite(challenge.requestedAt));
      assert.deepEqual({ ...challenge, requestedAt: 0 }, { requestedAt: 0, challengeId: 'test-challenge-id', mobileNumber: '712345678', tenantId: tenant.tenantId });
      return '654321';
    });
    assert.equal(result.UserRequest.uuid, 'test-uuid');
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[1].body, { tenantSlug: tenant.urlSlug, mobileNumber: '712345678', purpose: 'signin', locale: 'en_IN' });
    assert.deepEqual(calls[2].body, { tenantSlug: tenant.urlSlug, challengeId: 'test-challenge-id', code: '654321', purpose: 'signin' });
    assert.deepEqual(calls[3].body, { surface: 'citizen' });
    assert.equal(calls[3].cookie, 'identity_citizen=test-session');
    assert(calls.every(call => call.path.startsWith('/identity/v1/')));
  });
});

for (const stage of ['_send', '_verify']) {
  test(`OTP ${stage} failure stops without native registration/password fallback`, async () => {
    await fixture(async (request, base, calls) => {
      await assert.rejects(citizenSignIn(request, base, '712345678', async () => '654321'), /^Error: Identity request failed: HTTP 503 \(IDENTITY_UNAVAILABLE\)$/);
      assert.equal(calls.length, stage === '_send' ? 2 : 3);
      assert(calls.every(call => !call.path.endsWith('/_select')));
    }, { failure: `/identity/v1/citizen/otp/${stage}` });
  });
}

for (const [name, context] of [
  ['wrong tenant', { ...token, UserRequest: { ...token.UserRequest, tenantId: 'other' } }],
  ['wrong persona', { ...token, UserRequest: { ...token.UserRequest, type: 'EMPLOYEE' } }],
  ['refresh token', { ...token, refresh_token: 'test-refresh' }],
  ['expired token', { ...token, expires_in: 0 }],
] as const) {
  test(`rejects ${name} in a successful _select response`, async () => {
    await fixture(async (request, base) => {
      await assert.rejects(citizenSignIn(request, base, '712345678', async () => '654321'), /invalid or wrong-tenant/);
    }, { context });
  });
}

test('city-level citizen accepts the root-tenant token and the city route tenant', async () => {
  const city = { tenantId: 'ke.bomet', urlSlug: 'bomet' };
  const rootToken = { ...token, UserRequest: { ...token.UserRequest, tenantId: 'ke' }, tenant: city };
  await fixture(async (request, base) => {
    const result = await citizenSignIn(request, base, '712345678', async () => '654321');
    assert.equal(result.UserRequest.tenantId, 'ke');
    assert.equal(result.tenant?.tenantId, 'ke.bomet');
  }, { tenant: city, context: rootToken });
  for (const context of [
    { ...rootToken, UserRequest: { ...rootToken.UserRequest, tenantId: 'ke.bomet' } },
    { ...rootToken, tenant: { ...city, tenantId: 'ke.other' } },
  ]) {
    await fixture(async (request, base) => {
      await assert.rejects(citizenSignIn(request, base, '712345678', async () => '654321'), /invalid or wrong-tenant/);
    }, { tenant: city, context });
  }
});

test('employee context selection sends surface and exact tenant without deriving a parent', async () => {
  await fixture(async (request, base, calls) => {
    await selectContext(request, base, 'employee', tenant.tenantId);
    assert.deepEqual(calls[0], { path: '/identity/v1/contexts/_select', body: { surface: 'employee', tenantId: tenant.tenantId }, cookie: undefined });
  }, { context: { ...token, UserRequest: { ...token.UserRequest, type: 'EMPLOYEE' } } });
});

test('fixed-code fixtures require explicit configuration', async () => {
  const previous = process.env.IDENTITY_TEST_OTP_CODE;
  delete process.env.IDENTITY_TEST_OTP_CODE;
  try { await assert.rejects(configuredOtp({ challengeId: 'id', mobileNumber: 'phone', tenantId: 'tenant', requestedAt: 0 }), /Set IDENTITY_TEST_OTP_CODE/); }
  finally { if (previous !== undefined) process.env.IDENTITY_TEST_OTP_CODE = previous; }
});

test('authorize is tenant bound for employee and citizen, tenantless for configurator', () => {
  process.env.IDENTITY_TEST_TENANT_SLUG = tenant.urlSlug;
  for (const surface of ['employee', 'citizen', 'configurator'] as const) {
    const url = new URL(authorizeUrl('http://localhost', surface));
    assert.equal(url.pathname, '/identity/v1/authorize');
    assert.equal(url.searchParams.get('surface'), surface);
    assert.equal(url.searchParams.get('tenantSlug'), surface === 'configurator' ? null : tenant.urlSlug);
    assert.equal(url.searchParams.get('intent'), 'signin');
    assert(url.searchParams.get('returnTo')?.startsWith(surface === 'configurator' ? '/configurator/' : `/${tenant.urlSlug}/digit-ui/${surface}/`));
  }
});

test('failure reporting never echoes a response body', async () => {
  await assert.rejects(identityJson({ status: () => 500, json: async () => ({ code: 'bad secret code', error: 'secret' }) }), /^Error: Identity request failed: HTTP 500 \(UNEXPECTED_RESPONSE\)$/);
});

test('shared citizen fixture respects one BFF resend cooldown without a native fallback', async () => {
  await fixture(async (request, base, calls) => {
    const result = await citizenSignIn(request, base, '712345678', async () => '654321');
    assert.equal(result.UserRequest.uuid, 'test-uuid');
    assert.equal(calls.filter(call => call.path.endsWith('/otp/_send')).length, 2);
    assert(calls.every(call => call.path.startsWith('/identity/v1/')));
  }, { cooldown: true });
});
