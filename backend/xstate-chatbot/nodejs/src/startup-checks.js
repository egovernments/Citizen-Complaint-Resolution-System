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
    if (config.twilio.verifyWebhookSignature) {
      need(config.twilio.webhookBaseUrl, 'TWILIO_WEBHOOK_BASE_URL');
    }
  }

  // These two verify a shared secret instead of a signature; without it they
  // reject every webhook, which is a silent outage rather than a loud one.
  if (['ValueFirst', 'Kaleyra'].includes(config.whatsAppProvider) && config.webhook.verify) {
    need(config.webhook.sharedSecret, 'WEBHOOK_SHARED_SECRET');
  }

  return missing;
}

// Settings that leave the service running but degraded. Ported from upstream's
// config-check.js, which logged them; they are advisory, so they warn rather
// than block — unlike missingConfig(), which is about what cannot work at all.
function warnings() {
  const found = [];

  if (config.whatsAppProvider === 'Twilio') {
    if (!String(config.twilio.whatsappNumber ?? '').trim()) {
      found.push(
        'TWILIO_WHATSAPP_NUMBER is not set: inbound messages would be accepted and ' +
        'complaints filed, but every reply would be dropped.'
      );
    }
    if (!config.twilio.verifyWebhookSignature) {
      found.push(
        'TWILIO_VERIFY_WEBHOOK_SIGNATURE is false: the public webhook is forgeable by ' +
        'anyone who learns the URL. Intended for local console testing only.'
      );
    }
  }

  if (config.repoProvider === 'InMemory') {
    found.push(
      'REPO_PROVIDER is InMemory: conversations are lost on restart and break with more ' +
      'than one replica. Set it to Postgres for any real deployment.'
    );
  }

  return found;
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
  if (!missing.length) return;

  console.error(
    `Refusing to start: ${missing.length} required setting(s) are unset for ` +
    `WHATSAPP_PROVIDER=${config.whatsAppProvider} — ${missing.join(', ')}`
  );
  process.exit(1);
}

module.exports = { assertRequiredConfigOrExit, missingConfig, warnAtStartup, warnings };
