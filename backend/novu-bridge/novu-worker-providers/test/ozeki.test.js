'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OzekiSmsProvider } = require('../ozeki');
const { stubHttp } = require('./stub-http');

const config = {
  baseUrl: 'http://ozeki.example.org:9509/api?action=sendmsg',
  username: 'http-user',
  password: 'http-pass',
};

const ok = (messageId = 'novu-msg-1') => ({
  status: 200,
  data: {
    response_code: 'SUCCESS',
    response_msg: 'Messages queued for delivery.',
    data: { total_count: 1, success_count: 1, failed_count: 0, messages: [{ message_id: messageId, status: 'SUCCESS' }] },
  },
});

const send = (provider) => provider.sendMessage({ id: 'x', to: '+254700000001', content: 'hi' });

test('sends an SMS message successfully', async () => {
  const provider = new OzekiSmsProvider(config);
  const calls = stubHttp(provider, ok('gw-42'));

  const result = await provider.sendMessage({ id: 'novu-msg-1', to: '+254700000001', content: 'Hello from Ozeki!' });

  assert.equal(result.id, 'gw-42');
  const [{ url, body, config: request }] = calls;
  assert.equal(url, 'http://ozeki.example.org:9509/api?action=sendmsg');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(body.messages[0].message_id, 'novu-msg-1');
  assert.equal(body.messages[0].to_address, '+254700000001');
  assert.equal(body.messages[0].text, 'Hello from Ozeki!');
});

test('sends Basic auth built from the username and password', async () => {
  const provider = new OzekiSmsProvider(config);
  const calls = stubHttp(provider, ok());
  await send(provider);
  assert.equal(calls[0].config.headers.Authorization, `Basic ${Buffer.from('http-user:http-pass').toString('base64')}`);
});

test('includes a per-message sender when one is configured', async () => {
  const provider = new OzekiSmsProvider({ ...config, from: 'KE-GOV' });
  const calls = stubHttp(provider, ok());
  await send(provider);
  assert.equal(calls[0].body.messages[0].from_address, 'KE-GOV');
});

test('omits the sender field entirely when none is set', async () => {
  const provider = new OzekiSmsProvider(config);
  const calls = stubHttp(provider, ok());
  await send(provider);
  assert.equal('from_address' in calls[0].body.messages[0], false);
});

// Ozeki reports rejections as HTTP 200 with an error envelope.
test('fails when response_code is not SUCCESS despite a 200', async () => {
  const provider = new OzekiSmsProvider(config);
  stubHttp(provider, { status: 200, data: { response_code: 'ERROR', response_msg: 'Invalid user or password' } });
  await assert.rejects(send(provider), /Ozeki request failed \(ERROR\): Invalid user or password/);
});

test('fails when the envelope carries no message result', async () => {
  const provider = new OzekiSmsProvider(config);
  stubHttp(provider, { status: 200, data: { response_code: 'SUCCESS', response_msg: 'Authentication failed', data: {} } });
  await assert.rejects(send(provider), /Ozeki returned no message result: Authentication failed/);
});

test('fails when the gateway reports a failed count', async () => {
  const provider = new OzekiSmsProvider(config);
  stubHttp(provider, {
    status: 200,
    data: { response_code: 'SUCCESS', response_msg: 'No route', data: { total_count: 1, success_count: 0, failed_count: 1, messages: [] } },
  });
  await assert.rejects(send(provider), /Ozeki rejected 1 of 1 messages: No route/);
});

test('fails when the per-message status is not SUCCESS', async () => {
  const provider = new OzekiSmsProvider(config);
  stubHttp(provider, {
    status: 200,
    data: {
      response_code: 'SUCCESS',
      response_msg: 'Partially queued',
      data: { total_count: 1, success_count: 1, failed_count: 0, messages: [{ message_id: 'x', status: 'INVALID_RECIPIENT' }] },
    },
  });
  await assert.rejects(send(provider), /Ozeki rejected the message \(INVALID_RECIPIENT\)/);
});

// Review (8): response_msg is gateway text, and the error lands in Novu's activity feed.
test('masks the credentials in the gateway reason', async () => {
  const provider = new OzekiSmsProvider(config);
  const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  stubHttp(provider, {
    status: 200,
    data: { response_code: 'ERROR', response_msg: `Invalid login ${config.username}/${config.password} (Basic ${token})` },
  });
  const error = await send(provider).catch((e) => e);
  assert.match(error.message, /^Ozeki request failed \(ERROR\): Invalid login \*\*\*\/\*\*\* \(Basic \*\*\*\)$/);
});
