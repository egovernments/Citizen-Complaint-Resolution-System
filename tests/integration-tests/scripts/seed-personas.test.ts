/**
 * seed-personas.ts's actor handling against a Keycloak admin API double: a
 * login with no password credential (a magic-link founder) gets one one-off
 * password; a login that has one is never reset.
 *
 * Run: npm run test:catalog-unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ensureActorPassword } from './seed-personas';

async function keycloak(credentials: Array<{ type: string }>, run: (calls: string[]) => Promise<void>): Promise<void> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url?.startsWith('/admin/realms/digit/users?')) res.end(JSON.stringify([{ id: 'u1', email: 'founder@example.test' }]));
    else if (req.method === 'GET' && req.url === '/admin/realms/digit/users/u1/credentials') res.end(JSON.stringify(credentials));
    else if (req.method === 'PUT' && req.url === '/admin/realms/digit/users/u1/reset-password') res.writeHead(204).end();
    else res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const saved = { url: process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL, token: process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN };
  process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL = `http://127.0.0.1:${address.port}`;
  process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN = 'test-admin-token';
  try {
    await run(calls);
  } finally {
    for (const [name, value] of [['IDENTITY_TEST_KEYCLOAK_ADMIN_URL', saved.url], ['IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN', saved.token]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('an actor with no password credential (magic-link founder) gets one one-off password', async () => keycloak([{ type: 'otp' }], async (calls) => {
  const password = await ensureActorPassword('founder@example.test');
  assert.match(password, /^It-[A-Za-z0-9_-]{16}-9a$/);
  assert.deepEqual(calls.filter((c) => c.includes('reset-password')), ['PUT /admin/realms/digit/users/u1/reset-password']);
}));

test('an actor that already has a password is never reset', async () => keycloak([{ type: 'password' }], async (calls) => {
  await assert.rejects(ensureActorPassword('founder@example.test'), /already has a password: set SEED_ACTOR_PASSWORD/);
  assert.equal(calls.some((c) => c.includes('reset-password')), false);
}));
