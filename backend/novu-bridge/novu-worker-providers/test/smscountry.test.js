'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SmsCountryProvider } = require('../smscountry');
const { stubHttp } = require('./stub-http');

const DEFAULT_URL = 'http://api.smscountry.com/SMSCwebservice_bulk.aspx';
const config = { user: 'test-user', password: 'test-password', from: 'NOVU' };

test('sends an SMS message successfully', async () => {
  const provider = new SmsCountryProvider(config);
  const calls = stubHttp(provider, { data: 'OK:1234567' });

  const result = await provider.sendMessage({ to: '+254700000001', content: 'Hello from SMSCountry!' });

  assert.equal(result.id, '1234567');
  const [{ url, body: form, config: request }] = calls;
  assert.equal(url, DEFAULT_URL);
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(request.responseType, 'text');
  assert.equal(form.get('User'), 'test-user');
  assert.equal(form.get('passwd'), 'test-password');
  assert.equal(form.get('message'), 'Hello from SMSCountry!');
  assert.equal(form.get('sid'), 'NOVU');
  assert.equal(form.get('mtype'), 'N');
  assert.equal(form.get('DR'), 'Y');
});

test('strips the leading + from the recipient', async () => {
  const provider = new SmsCountryProvider(config);
  const calls = stubHttp(provider, { data: 'OK:1' });
  await provider.sendMessage({ to: '+254700000001', content: 'hi' });
  assert.equal(calls[0].body.get('mobilenumber'), '254700000001');
});

test('prefers the sender id from the message over the configured one', async () => {
  const provider = new SmsCountryProvider(config);
  const calls = stubHttp(provider, { data: 'OK:1' });
  await provider.sendMessage({ to: '+254700000001', content: 'hi', from: 'KE-GOV' });
  assert.equal(calls[0].body.get('sid'), 'KE-GOV');
});

test('posts to a configured gateway URL when one is given', async () => {
  const provider = new SmsCountryProvider({ ...config, baseUrl: 'https://gateway.example.org/send' });
  const calls = stubHttp(provider, { data: 'OK:1' });
  await provider.sendMessage({ to: '+254700000001', content: 'hi' });
  assert.equal(calls[0].url, 'https://gateway.example.org/send');
});

test('merges _passthrough body fields into the form', async () => {
  const provider = new SmsCountryProvider(config);
  const calls = stubHttp(provider, { data: 'OK:1' });
  await provider.sendMessage({ to: '+254700000001', content: 'hi' }, { _passthrough: { body: { mtype: 'U' } } });
  assert.equal(calls[0].body.get('mtype'), 'U');
});

// SMSCountry reports errors, including an ASP.NET error page, as HTTP 200.
test('fails when a 200 response does not start with OK:', async () => {
  const provider = new SmsCountryProvider(config);
  stubHttp(provider, { status: 200, data: 'Invalid Username or Password' });
  await assert.rejects(provider.sendMessage({ to: '+254700000001', content: 'hi' }), /SMSCountry request failed: Invalid Username or Password/);
});

test('fails on an empty response body', async () => {
  const provider = new SmsCountryProvider(config);
  stubHttp(provider, { data: '' });
  await assert.rejects(provider.sendMessage({ to: '+254700000001', content: 'hi' }), /empty response/);
});
