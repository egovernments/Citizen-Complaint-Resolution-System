'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const novu = require('../novu');
const { register } = require('../register');

// Resolve the factory the way the worker does (its own package entrypoint), so a pass
// proves our patch lands on the module instance the worker actually uses.
const fromWorker = createRequire(path.join(novu.NOVU_ROOT, 'apps/worker/package.json'));
const { SmsFactory } = fromWorker('@novu/application-generic');

const sms = (providerId, credentials = {}) => ({ providerId, channel: 'sms', credentials });

test('refuses to patch an unverified Novu worker version', () => {
  const real = novu.workerVersion;
  novu.workerVersion = () => '9.9.9';
  try {
    assert.throws(() => register(), /Novu worker 9\.9\.9 is not a verified version/);
  } finally {
    novu.workerVersion = real;
  }
});

test('registers our providers on the factory the worker imports', () => {
  assert.deepEqual(register().sort(), ['jasmin', 'ozeki', 'smscountry']);
  const factory = new SmsFactory();
  for (const id of ['smscountry', 'jasmin', 'ozeki']) {
    const handler = factory.getHandler(sms(id, { user: 'u', password: 'p', baseUrl: 'http://gw.example/send' }));
    assert.ok(handler, `${id} resolves`);
    assert.equal(handler.getProvider().id, id);
  }
});

test('leaves Novu providers and unknown ids to Novu', () => {
  register();
  const factory = new SmsFactory();
  assert.equal(factory.getHandler(sms('twilio', { accountSid: 'AC1', token: 't' })).constructor.name, 'TwilioHandler');
  assert.equal(factory.getHandler(sms('generic-sms', { baseUrl: 'http://x', apiKeyRequestHeader: 'k', apiKey: 'v' })).constructor.name, 'GenericSmsHandler');
  assert.equal(factory.getHandler(sms('no-such-provider')), null);
  assert.equal(factory.getHandler({ providerId: 'jasmin', channel: 'chat', credentials: {} }), null);
});

test('is idempotent and builds a fresh handler per lookup', () => {
  register();
  register();
  const factory = new SmsFactory();
  const a = factory.getHandler(sms('jasmin', { user: 'a' }));
  const b = factory.getHandler(sms('jasmin', { user: 'b' }));
  assert.notEqual(a, b);
  assert.equal(a.getProvider().config.username, 'a');
  assert.equal(b.getProvider().config.username, 'b');
});

test('maps integration credentials and sends through the handler like the worker does', async () => {
  register();
  const handler = new SmsFactory().getHandler(
    sms('jasmin', { baseUrl: 'http://jasmin.example.org:1401/send', user: 'u', password: 'p', from: 'DIGIT' })
  );
  const calls = [];
  handler.getProvider().httpClient = {
    post: async (url, body) => {
      calls.push({ url, body });
      return { status: 200, data: 'Success "m-1"' };
    },
  };

  // Novu's worker calls handler.send with the step's bridge data folded in.
  const result = await handler.send({ to: '+251911000001', content: 'ሰላም', bridgeProviderData: { _passthrough: { body: { priority: '1' } } } });

  assert.equal(result.id, 'm-1');
  assert.equal(calls[0].url, 'http://jasmin.example.org:1401/send');
  assert.equal(calls[0].body.get('username'), 'u');
  assert.equal(calls[0].body.get('from'), 'DIGIT');
  assert.equal(calls[0].body.get('coding'), '8');
  assert.equal(calls[0].body.get('priority'), '1');
});
