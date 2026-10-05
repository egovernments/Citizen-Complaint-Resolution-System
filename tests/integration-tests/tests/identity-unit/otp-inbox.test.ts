import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOtpInbox } from '../fixtures/otp-inbox';

async function withInbox(run: (base: string, advance: () => void) => Promise<void>) {
  let clock = 1000;
  const server = createOtpInbox(() => clock);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, () => { clock += 60_000; }); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const payload = { phone: '+254712345678', code: '654321', purpose: 'signin', tenantId: 'testtenant', locale: 'en_IN', expiresIn: 30 };
const send = (base: string) => fetch(`${base}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const read = (base: string, extra = '') => fetch(`${base}/codes?phone=%2B254712345678&challengeId=challenge&since=1000&tenantId=testtenant${extra}`);

test('receiver accepts the exact sender contract without challengeId', async () => withInbox(async base => {
  assert.equal((await send(base)).status, 204);
  const response = await read(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { code: '654321', receivedAt: 1000, expiresAt: 31_000 });
}));

test('stale, wrong-tenant, expired and reassigned challenge reads fail closed', async () => withInbox(async (base, advance) => {
  await send(base);
  const prefix = `${base}/codes?phone=%2B254712345678&challengeId=challenge`;
  assert.equal((await fetch(`${prefix}&since=1001&tenantId=testtenant`)).status, 404);
  assert.equal((await fetch(`${prefix}&since=1000&tenantId=other`)).status, 404);
  assert.equal((await read(base)).status, 200);
  assert.equal((await fetch(`${base}/codes?phone=%2B254712345678&challengeId=other&since=1000&tenantId=testtenant`)).status, 404);
  advance();
  assert.equal((await read(base)).status, 404);
}));

test('missing receipt or correlation window never returns a code', async () => withInbox(async base => {
  assert.equal((await read(base)).status, 404);
  await send(base);
  assert.equal((await fetch(`${base}/codes?phone=%2B254712345678&challengeId=challenge`)).status, 400);
}));
