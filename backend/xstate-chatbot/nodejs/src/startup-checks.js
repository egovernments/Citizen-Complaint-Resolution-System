const config = require('./env-variables');

// Credentials default to empty strings, so a misconfigured deployment starts
// happily and fails on the first citizen instead — a 403 on inbound, or an
// outbound send the provider rejects. Checked here so it fails at boot, loudly,
// while nobody is mid-complaint.
function missingConfig() {
  const missing = [];
  const need = (value, name) => { if (!String(value ?? '').trim()) missing.push(name); };

  need(config.serviceAccount.username, 'USER_SERVICE_ACCOUNT_USERNAME');
  need(config.serviceAccount.password, 'USER_SERVICE_ACCOUNT_PASSWORD');

  // The console provider is local development and talks to nobody.
  if (config.whatsAppProvider === 'Twilio') {
    need(config.twilio.accountSid, 'TWILIO_ACCOUNT_SID');
    need(config.twilio.authToken, 'TWILIO_AUTH_TOKEN');
    // senderAddress() throws without it, so every outbound reply fails while
    // the service still accepts complaints it can never answer.
    need(config.twilio.whatsappNumber, 'TWILIO_WHATSAPP_NUMBER');
    if (config.twilio.verifyWebhookSignature) {
      need(config.twilio.webhookBaseUrl, 'TWILIO_WEBHOOK_BASE_URL');
    }
  }

  // These two verify a shared secret instead of a signature; without it they
  // reject every webhook, which is a silent outage rather than a loud one.
  if (config.whatsAppProvider === 'Kaleyra') {
    need(config.kaleyra.sid, 'KALEYRA_SID');
    need(config.kaleyra.apikey, 'KALEYRA_API_KEY');
  }

  // These default to the literal 'demo' — present, so a blank check passes,
  // and every send fails against the real endpoint.
  if (config.whatsAppProvider === 'ValueFirst') {
    const vf = config.valueFirstWhatsAppProvider || {};
    if (!vf.valueFirstUsername || vf.valueFirstUsername === 'demo') missing.push('VALUEFIRST_USERNAME');
    if (!vf.valueFirstPassword || vf.valueFirstPassword === 'demo') missing.push('VALUEFIRST_PASSWORD');
  }

  // reminders-service builds extraInfo.whatsAppBusinessNumber from this; unset,
  // the sweep sends with an empty sender and fails where no citizen can see it.
  if (['ValueFirst', 'Kaleyra'].includes(config.whatsAppProvider)) {
    need(config.whatsAppBusinessNumber, 'WHATSAPP_BUSINESS_NUMBER');
  }

  if (['ValueFirst', 'Kaleyra'].includes(config.whatsAppProvider) && config.webhook.verify) {
    need(config.webhook.sharedSecret, 'WEBHOOK_SHARED_SECRET');
  }

  // Numbers follow the tenant's MDMS MobileNumberValidation row, falling back to these
  // whenever MDMS has no row or is unreachable, and the fallback is cached for the TTL.
  // They default to India's, so one MDMS blip on a +258 deployment would drop every
  // inbound message until the cache expired. MOBILE_NUMBER_LENGTH fills the digit
  // count in the invalid-number reply.
  if (config.whatsAppProvider !== 'Console') {
    if (!config.mobileValidation?.defaultCountryCodeSet) missing.push('DEFAULT_COUNTRY_CODE');
    if (!config.mobileValidation?.defaultRegexSet) missing.push('DEFAULT_MOBILE_REGEX');
    if (!config.mobileNumberLengthSet) missing.push('MOBILE_NUMBER_LENGTH');
  }

  return missing;
}

// Settings that leave the service running but degraded. Ported from upstream's
// config-check.js, which logged them; they are advisory, so they warn rather
// than block — unlike missingConfig(), which is about what cannot work at all.
function warnings() {
  const found = [];

  if (config.whatsAppProvider === 'Twilio') {
    if (!config.twilio.verifyWebhookSignature) {
      found.push(
        'TWILIO_VERIFY_WEBHOOK_SIGNATURE is false: the public webhook is forgeable by ' +
        'anyone who learns the URL. Intended for local console testing only.'
      );
    }
  }

  if (config.repoProvider === 'InMemory') {
    found.push(
      'REPO_PROVIDER is InMemory: conversations are lost on restart. Set it to Postgres ' +
      'for any real deployment — that fixes restarts, not concurrency; see ' +
      'postgres-repo.updateState before running more than one replica.'
    );
  }

  return found;
}

function invalidConfig() {
  const bad = [];
  const { request, mediaProcessing, dispatchSettle } = config.timeouts || {};
  if (!dispatchSettle || !request || !mediaProcessing) {
    bad.push('REQUEST_TIMEOUT_MS, MEDIA_PROCESSING_TIMEOUT_MS and DISPATCH_SETTLE_TIMEOUT_MS must all be set');
    return bad;
  }

  if (dispatchSettle <= request) {
    bad.push(`DISPATCH_SETTLE_TIMEOUT_MS (${dispatchSettle}) must exceed REQUEST_TIMEOUT_MS (${request})`);
  }
  if (dispatchSettle <= mediaProcessing) {
    bad.push(`DISPATCH_SETTLE_TIMEOUT_MS (${dispatchSettle}) must exceed MEDIA_PROCESSING_TIMEOUT_MS (${mediaProcessing})`);
  }
  return bad;
}


function warnAtStartup() {
  const found = warnings();
  if (!found.length) {
    console.log('Configuration check: OK');
    return found;
  }
  console.warn('Configuration check: the service will run, but not fully:');
  for (const w of found) console.warn('  * ' + w);
  return found;
}

function assertRequiredConfigOrExit() {
  const missing = missingConfig();
  const invalid = invalidConfig();
  if (!missing.length && !invalid.length) return;

  if (missing.length) {
    console.error(
      `Refusing to start: ${missing.length} required setting(s) are unset for ` +
      `WHATSAPP_PROVIDER=${config.whatsAppProvider} — ${missing.join(', ')}`
    );
  }

  for (const problem of invalid) console.error(`Refusing to start: ${problem}`);

  process.exit(1);
}

module.exports = { assertRequiredConfigOrExit, missingConfig, warnAtStartup, warnings, invalidConfig };
