'use strict';

// Novu's own modules, resolved from inside the stock worker image. The worker is
// not bundled: @novu/* resolve through symlinks to plain files under the image's
// app root, so requiring them by real path yields the SAME module instances the
// worker uses. That is what lets register.js patch the SMS factory in place.
//
// Paths and class names are those of ghcr.io/novuhq/novu/worker:2.3.0. register.js
// refuses to run on any other worker version, so a Novu bump fails loudly here
// instead of silently skipping our providers.

const path = require('node:path');
const { createRequire } = require('node:module');

const NOVU_ROOT = process.env.DIGIT_NOVU_ROOT || '/usr/src/app';

const fromProviders = createRequire(path.join(NOVU_ROOT, 'packages/providers/package.json'));
const fromGeneric = createRequire(path.join(NOVU_ROOT, 'libs/application-generic/package.json'));

function workerVersion() {
  return require(path.join(NOVU_ROOT, 'apps/worker/package.json')).version;
}

// Shared by the providers below, kept here so the mounted file set stays fixed.
//
// A provider's error message is stored in Novu's execution details and shown in its
// activity feed, so gateway text that goes into one is redacted first (by the parsers,
// and again for every error at register.js's boundary): gateways echo
// the request back (SMSCountry's ASP.NET error page carries the posted form, User and
// passwd included). Each credential value is masked as sent and as a page may echo
// it (URL-, form- and HTML-encoded, and the Basic-auth token of user:password), and
// any `password=...`-style pair is masked whatever its value. Redaction runs on the
// whole text BEFORE it is shortened, so a value cut in half is never half shown.

const MASK = '***';
const SECRET_KEYS = 'user|username|passwd|password|pwd|pass|apikey|api_key|api-key|key|token|secret';
const SECRET_PAIR = new RegExp(`((?:^|[?&\\s;,"'])(?:${SECRET_KEYS})=)[^&\\s"'<>]*`, 'gi');
const SECRET_JSON = new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*")[^"]*`, 'gi');

function encodings(value) {
  const html = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    value,
    encodeURIComponent(value),
    new URLSearchParams({ v: value }).toString().slice(2),
    html,
    html.replace(/'/g, '&#39;'),
    html.replace(/'/g, '&#x27;'),
  ];
}

function redact(text, secrets = []) {
  let out = String(text ?? '');
  const values = secrets.filter((s) => typeof s === 'string' && s.length > 0);
  const [user, password] = secrets;
  if (typeof user === 'string' && typeof password === 'string' && password.length > 0) {
    values.push(Buffer.from(`${user}:${password}`).toString('base64'));
  }
  // Longest first, so a value that contains another is masked whole.
  const forms = [...new Set(values.flatMap(encodings))].sort((a, b) => b.length - a.length);
  for (const form of forms) {
    out = out.split(form).join(MASK);
  }
  return out.replace(SECRET_PAIR, `$1${MASK}`).replace(SECRET_JSON, `$1${MASK}`);
}

function abbreviate(value, max = 200) {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Gateway text as it may appear in an error: credentials masked, then at most `max` characters. */
function redactedSnippet(text, secrets, max = 200) {
  return abbreviate(redact(text, secrets), max);
}

module.exports = {
  NOVU_ROOT,
  workerVersion,
  redact,
  redactedSnippet,
  axios: fromProviders('axios'),
  BaseProvider: fromProviders('./dist/cjs/base.provider').BaseProvider,
  CasingEnum: fromProviders('./dist/cjs/base.provider').CasingEnum,
  ChannelTypeEnum: fromProviders('@novu/stateless').ChannelTypeEnum,
  BaseSmsHandler: fromGeneric('./build/main/factories/sms/handlers/base.handler').BaseSmsHandler,
  SmsFactory: fromGeneric('./build/main/factories/sms/sms.factory').SmsFactory,
};
