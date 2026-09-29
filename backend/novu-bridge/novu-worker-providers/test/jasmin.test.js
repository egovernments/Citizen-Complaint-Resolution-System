'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JasminSmsProvider } = require('../jasmin');
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

test('defaults coding to 0 and allows UCS-2 for non-Latin alphabets', async () => {
  assert.equal((await formFor(config, { to: '+251911000001', content: 'hi' })).get('coding'), '0');
  assert.equal((await formFor({ ...config, coding: '8' }, { to: '+251911000001', content: 'ሰላም' })).get('coding'), '8');
});

// The worker's handler builds the provider from integration credentials, which carry
// no coding field, so the per-message choice below is what production actually gets.
test('picks UCS-2 by itself when the text leaves GSM 03.38', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'ቅሬታዎ ተመዝግቧል' });
  assert.equal(form.get('coding'), '8');
  assert.equal(form.get('content'), 'ቅሬታዎ ተመዝግቧል');
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

test('fails on an unrecognised response body', async () => {
  const provider = new JasminSmsProvider(config);
  stubHttp(provider, { status: 200, data: '' });
  await assert.rejects(provider.sendMessage({ to: '+251911000001', content: 'hi' }), /empty response/);
});

test('merges _passthrough body fields into the form', async () => {
  const form = await formFor(config, { to: '+251911000001', content: 'hi' }, { _passthrough: { body: { priority: '2' } } });
  assert.equal(form.get('priority'), '2');
});
