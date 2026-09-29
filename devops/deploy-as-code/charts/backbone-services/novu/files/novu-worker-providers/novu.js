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

module.exports = {
  NOVU_ROOT,
  workerVersion,
  axios: fromProviders('axios'),
  BaseProvider: fromProviders('./dist/cjs/base.provider').BaseProvider,
  CasingEnum: fromProviders('./dist/cjs/base.provider').CasingEnum,
  ChannelTypeEnum: fromProviders('@novu/stateless').ChannelTypeEnum,
  BaseSmsHandler: fromGeneric('./build/main/factories/sms/handlers/base.handler').BaseSmsHandler,
  SmsFactory: fromGeneric('./build/main/factories/sms/sms.factory').SmsFactory,
};
