'use strict';

// Adds DIGIT's SMS providers to the STOCK Novu worker image, no fork and no rebuild.
//
// Loaded before the worker starts, with
//   NODE_OPTIONS=--require /opt/digit-novu-providers/register.js
// and this directory mounted read-only at /opt/digit-novu-providers (compose volume,
// helm ConfigMap). It wraps SmsFactory.prototype.getHandler: an integration whose
// providerId is one of ours gets our handler, everything else goes to Novu's own
// lookup unchanged. Novu's API needs nothing: it accepts any providerId string, and
// these providers use credential keys it already stores (user, password, from,
// baseUrl).
//
// Failure is loud by design. If a module does not resolve, or the worker is not the
// Novu version these internals were verified against, the worker refuses to boot
// with a [digit-novu-providers] error instead of starting without our providers,
// where every send through them would fail inside Novu while novu-bridge records
// SENT.

const SUPPORTED_WORKER_VERSIONS = ['2.3.0'];
const TAG = '[digit-novu-providers]';

function loadHandlers() {
  return [require('./smscountry').SmsCountryHandler, require('./jasmin').JasminHandler, require('./ozeki').OzekiHandler];
}

function register() {
  const novu = require('./novu');

  const version = novu.workerVersion();
  if (!SUPPORTED_WORKER_VERSIONS.includes(version) && process.env.DIGIT_NOVU_PROVIDERS_ALLOW_UNTESTED !== 'true') {
    throw new Error(
      `${TAG} Novu worker ${version} is not a verified version (${SUPPORTED_WORKER_VERSIONS.join(', ')}). ` +
        'These providers patch Novu internals: re-run their tests against the new image, add the version to ' +
        'SUPPORTED_WORKER_VERSIONS in register.js, or set DIGIT_NOVU_PROVIDERS_ALLOW_UNTESTED=true.'
    );
  }

  const { SmsFactory } = novu;
  if (typeof SmsFactory?.prototype?.getHandler !== 'function') {
    throw new Error(`${TAG} SmsFactory.prototype.getHandler not found in this Novu worker`);
  }
  if (SmsFactory.prototype.getHandler.digitProviders) {
    return SmsFactory.prototype.getHandler.digitProviders;
  }

  const handlers = new Map(loadHandlers().map((Handler) => [new Handler().providerId, Handler]));
  const novuGetHandler = SmsFactory.prototype.getHandler;

  function getHandler(integration) {
    const Handler = handlers.get(integration?.providerId);
    if (!Handler) {
      return novuGetHandler.call(this, integration);
    }
    // A fresh handler per call: Novu's factory reuses one instance and rebuilds its
    // provider on every lookup, which lets concurrent sends swap credentials.
    const handler = new Handler();
    if (!handler.canHandle(integration.providerId, integration.channel)) {
      return null;
    }
    handler.buildProvider(integration.credentials || {});
    return handler;
  }
  getHandler.digitProviders = [...handlers.keys()];
  SmsFactory.prototype.getHandler = getHandler;

  return getHandler.digitProviders;
}

// NODE_OPTIONS reaches every node process in the container, including the image's
// dotenv helper that runs before the worker. Patch only the worker itself.
const isWorkerMain = /[\\/]apps[\\/]worker[\\/]dist[\\/]main\.js$/.test(process.argv[1] || '');
if (isWorkerMain || process.env.DIGIT_NOVU_PROVIDERS_FORCE === 'true') {
  const ids = register();
  console.log(`${TAG} SMS providers registered in the Novu worker: ${ids.join(', ')}`);
}

module.exports = { register, SUPPORTED_WORKER_VERSIONS };
