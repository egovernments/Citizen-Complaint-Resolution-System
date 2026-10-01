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
//
// Which process registers. NODE_OPTIONS reaches every node process in the container,
// including the image's dotenv helper (dist/dotenvcreate.mjs) that runs before the
// worker, so the process is chosen by decide():
//
//   - the worker entrypoint (apps/worker/dist/main.js), or DIGIT_NOVU_PROVIDERS_FORCE=true:
//     register or crash;
//   - DIGIT_NOVU_PROVIDERS=required (set by the compose file and the helm chart): every
//     process but the dotenv helper registers or crashes, so a wrapper, pm2 or a moved
//     entrypoint cannot start the worker without our providers;
//   - otherwise the process is skipped, with a stderr warning unless it is the dotenv
//     helper, naming the process and the variable that makes registration mandatory.

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

const WORKER_MAIN = /[\\/]apps[\\/]worker[\\/]dist[\\/]main\.js$/;
const DOTENV_HELPER = /[\\/]dotenvcreate\.m?js$/;

/**
 * What this process does with the preload: 'register' (or crash trying), 'skip' quietly
 * (the image's dotenv helper), or 'warn' (skip, saying so on stderr).
 */
function decide(argv1 = process.argv[1] || '', env = process.env) {
  if (WORKER_MAIN.test(argv1) || env.DIGIT_NOVU_PROVIDERS_FORCE === 'true') {
    return 'register';
  }
  if (DOTENV_HELPER.test(argv1)) {
    return 'skip';
  }
  if (String(env.DIGIT_NOVU_PROVIDERS || '').trim().toLowerCase() === 'required') {
    return 'register';
  }
  return 'warn';
}

function run(argv1 = process.argv[1] || '', env = process.env, log = console) {
  const decision = decide(argv1, env);
  if (decision === 'register') {
    const ids = register();
    log.log(`${TAG} SMS providers registered in the Novu worker: ${ids.join(', ')}`);
  } else if (decision === 'warn') {
    log.error(
      `${TAG} WARNING: NOT registering SMSCountry/Jasmin/Ozeki in this process (${argv1 || 'no script'}): only ` +
        'apps/worker/dist/main.js registers by default. If this is the Novu worker, every send through those ' +
        'providers will fail inside Novu while novu-bridge records SENT. Set DIGIT_NOVU_PROVIDERS=required on ' +
        'the worker to make registration mandatory.'
    );
  }
  return decision;
}

run();

module.exports = { register, decide, run, SUPPORTED_WORKER_VERSIONS };
