'use strict';

// Review (2026-10-01): whatever a send rejects with reaches Novu's activity feed.
// Novu's sendErrorStatus stores JSON.stringify(error) whenever the error has own keys
// (an AxiosError's toJSON carries config.data and config.headers: the posted form and
// the Basic header), and the PROVIDER_ERROR execution detail stores
// error.response.data. These tests send through Novu's OWN SendMessageSms usecase from
// the stock image, against real sockets, and read back what Novu would persist.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const novu = require('../novu');
const { register } = require('../register');
const { SmsCountryProvider } = require('../smscountry');

const fromWorker = createRequire(path.join(novu.NOVU_ROOT, 'apps/worker/package.json'));
const { SmsFactory } = fromWorker('@novu/application-generic');
const { SendMessageSms } = fromWorker('./dist/app/workflow/usecases/send-message/send-message-sms.usecase');

const USER = 'leak-user-7Q';
const PASSWORD = 'pw&S3cret<9> x';

/** Every form a credential could take on its way into Novu's storage. */
const LEAKS = [
  USER,
  PASSWORD,
  'S3cret',
  encodeURIComponent(PASSWORD),
  new URLSearchParams({ v: PASSWORD }).toString().slice(2),
  Buffer.from(`${USER}:${PASSWORD}`).toString('base64'),
];

function assertNoCredential(text, where) {
  for (const leak of LEAKS) {
    assert.ok(!text.includes(leak), `${where} leaks ${JSON.stringify(leak)}:\n${text.slice(0, 2000)}`);
  }
}

let gateway;
let base;
let refusedUrl;

before(async () => {
  // /echo500: an error page echoing the posted form and the Authorization header, the
  // way SMSCountry's ASP.NET error page echoes User/passwd. /reset: the socket dies.
  gateway = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.url.startsWith('/reset')) {
        req.socket.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body>Server Error. Form: ${body} Authorization: ${req.headers.authorization || ''}</body></html>`);
    });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${gateway.address().port}`;

  // A port nothing listens on: connect ECONNREFUSED.
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  refusedUrl = `http://127.0.0.1:${closed.address().port}/send`;
  await new Promise((resolve) => closed.close(resolve));
});

after(() => gateway.close());

const objectId = (n) => n.toString(16).padStart(24, '0');
const job = {
  _id: objectId(1),
  _environmentId: objectId(2),
  _organizationId: objectId(3),
  subscriberId: 'subscriber-1',
  _subscriberId: objectId(4),
  _notificationId: objectId(5),
  _templateId: objectId(6),
  transactionId: 'tx-1',
  type: 'sms',
};

/** Runs Novu's own SMS send step and returns what it would write to Mongo. */
async function sendThroughNovu(providerId, baseUrl) {
  register();
  const stored = { status: [], details: [] };
  const usecase = Object.create(SendMessageSms.prototype);
  usecase.messageRepository = { updateMessageStatus: async (...args) => stored.status.push(args) };
  usecase.createExecutionDetails = { execute: async (command) => stored.details.push(command) };
  const integration = {
    providerId,
    channel: 'sms',
    credentials: { baseUrl, user: USER, password: PASSWORD, from: 'DIGIT' },
  };
  const command = { job: { ...job, providerId }, environmentId: job._environmentId, step: { stepId: 'sms' }, overrides: {} };

  const result = await usecase.sendMessage('+254700000001', integration, 'hello', { _id: objectId(7) }, command);
  return { result, stored };
}

const CASES = [
  ['connection refused', () => refusedUrl],
  ['socket reset', () => `${base}/reset`],
  ['HTTP 500 echoing the request', () => `${base}/echo500`],
];

for (const providerId of ['smscountry', 'jasmin', 'ozeki']) {
  for (const [name, url] of CASES) {
    test(`${providerId}, ${name}: nothing Novu stores carries a credential`, async () => {
      const { result, stored } = await sendThroughNovu(providerId, url());

      assert.equal(result.status, 'failed');
      assert.equal(stored.status.length, 1, 'sendErrorStatus ran once');
      const [, , status, , errorId, errorText] = stored.status[0];
      assert.equal(status, 'error');
      assert.equal(errorId, 'unexpected_sms_error');
      assert.ok(errorText, 'the activity feed still says why');
      assertNoCredential(String(errorText), 'errorText (activity feed)');

      const providerError = stored.details.find((d) => d.detail === 'Unexpected provider error');
      assert.ok(providerError, `a provider-error execution detail was written: ${stored.details.map((d) => d.detail)}`);
      assertNoCredential(providerError.raw, 'execution detail raw');
    });
  }
}

test('the error handed to Novu is a plain Error: nothing for JSON.stringify to expose', async () => {
  register();
  const handler = new SmsFactory().getHandler({
    providerId: 'ozeki',
    channel: 'sms',
    credentials: { baseUrl: refusedUrl, user: USER, password: PASSWORD },
  });
  const error = await handler.send({ to: '+254700000001', content: 'hi' }).then(
    () => assert.fail('a refused connection must fail the send'),
    (e) => e
  );
  assert.equal(Object.getPrototypeOf(error), Error.prototype);
  assert.deepEqual(Object.keys(error), []);
  assert.equal(JSON.stringify(error), '{}');
  for (const key of ['config', 'request', 'response', 'cause', 'code']) {
    assert.equal(error[key], undefined, `no ${key} on the error`);
  }
  assert.match(error.message, /^ozeki request failed: .*ECONNREFUSED/);
});

test('anything a provider throws, not only axios errors, is redacted at the boundary', async () => {
  register();
  const handler = new SmsFactory().getHandler({
    providerId: 'jasmin',
    channel: 'sms',
    credentials: { baseUrl: 'http://jasmin.example.org/send', user: USER, password: PASSWORD, apiKey: 'k-ZZ91' },
  });
  handler.getProvider().httpClient = {
    post: async () => {
      const bug = new Error(`parser blew up on password=${PASSWORD} for ${USER} key k-ZZ91`);
      bug.config = { data: `username=${USER}&password=${encodeURIComponent(PASSWORD)}` };
      throw bug;
    },
  };
  const error = await handler.send({ to: '+254700000001', content: 'hi' }).catch((e) => e);
  assert.deepEqual(Object.keys(error), []);
  assertNoCredential(error.message, 'message');
  assert.doesNotMatch(error.message, /k-ZZ91/);
  assert.match(error.message, /^parser blew up on password=\*\*\*/);
});

// SMSCountry used to reject a non-2xx before its parser ran, so Novu stored
// e.response.data, the echoed form, verbatim. The parser must see every status.
test('smscountry reads a non-2xx body through its redacting parser', async () => {
  const provider = new SmsCountryProvider({ baseUrl: `${base}/echo500`, user: USER, password: PASSWORD });
  const error = await provider.sendMessage({ to: '+254700000001', content: 'hi' }).catch((e) => e);
  assert.match(error.message, /^SMSCountry request failed: <html><body>Server Error\. Form: User=\*\*\*&passwd=\*\*\*/);
  assert.equal(error.response, undefined);
  assertNoCredential(error.message, 'message');
});
