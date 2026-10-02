const config = require('./env-variables');

/**
 * Deployment-configuration validation, surfaced where an operator will actually see it.
 *
 * The chatbot degrades silently in a way that looks healthy: a container with no Twilio
 * sender starts cleanly, passes /health, validates the inbound signature, runs the dialog
 * and FILES the complaint -- then drops every outbound reply, because senderAddress()
 * throws inside sendMessageToUser's per-message try/catch, which logs and continues.
 * Everything is green from the operator's side; nothing arrives on the citizen's side.
 *
 * So the same checks run twice: once at boot (loud log) and once per /health probe (503),
 * which is what Gatus and the container healthcheck watch.
 */
function problems() {
  const found = [];

  if (config.whatsAppProvider === 'Twilio') {
    if (!config.twilio.whatsappNumber) {
      found.push(
        'TWILIO_WHATSAPP_NUMBER is not set: inbound messages would be accepted and ' +
        'complaints filed, but every reply would be dropped. Set twilio_whatsapp_from.'
      );
    }
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      found.push(
        'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not both set: replies cannot be sent, ' +
        'and signature validation fails closed so no inbound message is accepted either.'
      );
    } else if (!config.twilio.validateSignature) {
      // Not fatal, but it must not pass unnoticed on a reachable deployment.
      found.push(
        'TWILIO_VALIDATE_SIGNATURE is false: the public webhook is forgeable by anyone who ' +
        'learns the URL. Intended for local console testing only.'
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

/** Log once at boot. Does not exit: a bad config should be diagnosable, not a crash loop. */
function logAtStartup() {
  const found = problems();
  if (!found.length) {
    console.log('Configuration check: OK');
    return found;
  }
  console.error('Configuration check FAILED -- the service is running but not fully functional:');
  for (const p of found) console.error('  * ' + p);
  return found;
}

module.exports = { problems, logAtStartup };
