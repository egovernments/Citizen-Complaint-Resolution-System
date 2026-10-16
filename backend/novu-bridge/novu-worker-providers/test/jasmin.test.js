'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JasminSmsProvider, toUcs2Hex } = require('../jasmin');
const { stubHttp } = require('./stub-http');

const config = {
  baseUrl: 'http://jasmin.example.org:1401/send',
  username: 'test-user',
  password: 'test-password',
  from: 'NOVU',
};
const ok = { status: 200, data: 'Success "1"' };

async function formFor(providerConfig, message, bridgeData) {
  const provider = new JasminSmsProvider(providerConfig);
  const calls = stubHttp(provider, ok);
  await provider.sendMessage(message, bridgeData);
  return calls[0].body;
}

test('sends an SMS message successfully', async () => {
  const provider = new JasminSmsProvider(config);
  const calls = stubHttp(provider, { status: 200, data: 'Success "3a7b1c9e-1"' });

  const result = await provider.sendMessage({ to: '+251911000001', content: 'Hello from Jasmin!' });

  assert.equal(result.id, '3a7b1c9e-1');
  const [{ url, body: form, config: request }] = calls;
  assert.equal(url, 'http://jasmin.example.org:1401/send');
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(request.responseType, 'text');
  assert.equal(form.get('username'), 'test-user');
  assert.equal(form.get('password'), 'test-password');
  assert.equal(form.get('to'), '+251911000001');
  assert.equal(form.get('from'), 'NOVU');
  assert.equal(form.get('content'), 'Hello from Jasmin!');
});

// Jasmin's own field spec marks `dlr` mandatory and allows only yes|no.
test('always sends the mandatory dlr flag, defaulting to no', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'hi' });
  assert.equal(form.get('dlr'), 'no');
  assert.equal(form.has('dlr-url'), false);
});

test('requests a delivery receipt when dlr is enabled with a URL', async () => {
  const form = await formFor({ ...config, dlr: 'yes', dlrUrl: 'https://example.org/dlr' }, { to: '+251911000001', content: 'hi' });
  assert.equal(form.get('dlr'), 'yes');
  assert.equal(form.get('dlr-url'), 'https://example.org/dlr');
  assert.equal(form.get('dlr-level'), '3');
});

test('does not request a receipt when dlr is enabled without a URL', async () => {
  const form = await formFor({ ...config, dlr: 'yes' }, { to: '+251911000001', content: 'hi' });
  assert.equal(form.get('dlr'), 'no');
});

const fromHex = (hex) => Buffer.from(hex, 'hex').swap16().toString('utf16le');

test('defaults coding to 0 and allows UCS-2 for non-Latin alphabets', async () => {
  assert.equal((await formFor(config, { to: '+251911000001', content: 'hi' })).get('coding'), '0');
  assert.equal((await formFor({ ...config, coding: '8' }, { to: '+251911000001', content: 'ሰላም' })).get('coding'), '8');
});

// The worker's handler builds the provider from integration credentials, which carry
// no coding field, so the per-message choice below is what production actually gets.
// Review (1): Jasmin forwards `content` untouched for coding 8, so UTF-8 there would
// reach the handset garbled; the text has to travel as UTF-16BE `hex-content`.
test('picks UCS-2 by itself when the text leaves GSM 03.38, and sends it as UTF-16BE hex-content', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'ቅሬታዎ ተመዝግቧል' });
  assert.equal(form.get('coding'), '8');
  assert.equal(form.has('content'), false, 'content and hex-content together are a 400 in Jasmin');
  // ቅ U+1245, ሬ U+122C ... big-endian, two bytes each.
  assert.match(form.get('hex-content'), /^1245122c/);
  assert.equal(form.get('hex-content').length, 'ቅሬታዎ ተመዝግቧል'.length * 4);
  assert.equal(fromHex(form.get('hex-content')), 'ቅሬታዎ ተመዝግቧል');
});

test('encodes UCS-2 big-endian, with surrogate pairs beyond the BMP', () => {
  assert.equal(toUcs2Hex('ሰላም'), '1230120b121d');
  assert.equal(toUcs2Hex('A€'), '004120ac');
  assert.equal(toUcs2Hex('😀'), 'd83dde00');
});

test('an explicitly configured coding 8 hex-encodes Latin text too; coding 0 keeps plain content', async () => {
  const ucs2 = await formFor({ ...config, coding: '8' }, { to: '+251911000001', content: 'hi' });
  assert.equal(ucs2.get('hex-content'), '00680069');
  assert.equal(ucs2.has('content'), false);
  const gsm = await formFor(config, { to: '+251911000001', content: 'Fee: €5' });
  assert.equal(gsm.get('content'), 'Fee: €5');
  assert.equal(gsm.has('hex-content'), false);
});

test('a passthrough coding or content is encoded after the merge', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'hi' }, { _passthrough: { body: { coding: '8' } } });
  assert.equal(form.get('hex-content'), '00680069');
  assert.equal(form.has('content'), false);
});

test('keeps GSM coding for Latin text that uses the GSM extension table', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'Fee: €5 [ref #12] {ok} ~ Ñandu' });
  assert.equal(form.get('coding'), '0');
});

test('lets an explicitly configured coding win over detection', async () => {
  const form = await formFor({ ...config, coding: '0' }, { to: '+251911000001', content: 'ሰላም' });
  assert.equal(form.get('coding'), '0');
});

test('surfaces the gateway error message', async () => {
  const provider = new JasminSmsProvider(config);
  stubHttp(provider, { status: 403, data: 'Error "Authentication failure"' });
  await assert.rejects(provider.sendMessage({ to: '+251911000001', content: 'hi' }), /Jasmin request failed: Authentication failure/);
});

// Review (8): the error is stored in Novu's execution details and shown in its activity feed.
test('masks the credentials in gateway text before it reaches the error', async () => {
  const provider = new JasminSmsProvider(config);
  stubHttp(provider, { status: 403, data: 'Error "Authentication failure for username:test-user password:test-password"' });
  const error = await provider.sendMessage({ to: '+251911000001', content: 'hi' }).catch((e) => e);
  assert.match(error.message, /^Jasmin request failed: Authentication failure/);
  assert.doesNotMatch(error.message, /test-user|test-password/);

  stubHttp(provider, { status: 500, data: `<html>${'x'.repeat(190)}?username=test-user&password=test-password</html>` });
  const page = await provider.sendMessage({ to: '+251911000001', content: 'hi' }).catch((e) => e);
  assert.doesNotMatch(page.message, /test-pass|test-user/, 'masked before shortening, so no half value survives');
});

test('fails on an unrecognised response body', async () => {
  const provider = new JasminSmsProvider(config);
  stubHttp(provider, { status: 200, data: '' });
  await assert.rejects(provider.sendMessage({ to: '+251911000001', content: 'hi' }), /empty response/);
});

test('merges _passthrough body fields into the form', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'hi' }, { _passthrough: { body: { priority: '2' } } });
  assert.equal(form.get('priority'), '2');
});
