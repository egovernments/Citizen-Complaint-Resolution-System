const crypto = require('crypto');
const config = require('../env-variables');

/**
 * Twilio inbound webhook authentication.
 *
 * The webhook has to be publicly reachable for Twilio to call it, and it carries no DIGIT
 * auth token. Without this check anyone who learns the URL can post as any phone number and
 * file complaints in a citizen's name — the previous `isValid()` only checked that the body
 * *looked* like a Twilio payload, which an attacker trivially satisfies.
 *
 * Twilio's scheme (https://www.twilio.com/docs/usage/security#validating-requests):
 *   1. Start with the full URL Twilio requested, including any query string.
 *   2. For form-encoded POSTs, sort the POST params by key and append `key + value` for each.
 *   3. HMAC-SHA1 that string with the account auth token, base64-encode it.
 *   4. Compare against the `X-Twilio-Signature` header.
 */

/**
 * Rebuild the URL Twilio signed.
 *
 * Prefer an explicitly configured public base URL. Behind Kong/nginx the request's own Host
 * and proto headers are attacker-controllable, and signature validation that trusts them can
 * be steered to a URL the attacker can also sign against. `TWILIO_WEBHOOK_BASE_URL` pins it.
 */
function buildUrl(req) {
  const configured = config.twilio.webhookBaseUrl;
  if (configured) {
    return configured.replace(/\/+$/, '') + req.originalUrl;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.originalUrl}`;
}

function expectedSignature(authToken, url, params) {
  let payload = url;
  if (params && typeof params === 'object') {
    for (const key of Object.keys(params).sort()) {
      const value = params[key];
      payload += key + (value === undefined || value === null ? '' : value);
    }
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(payload, 'utf-8')).digest('base64');
}

function safeEquals(a, b) {
  const bufA = Buffer.from(String(a), 'utf-8');
  const bufB = Buffer.from(String(b), 'utf-8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @returns {{valid: boolean, reason: string}} `reason` is for logs only — never echo it to
 *          the caller, since it tells a prober exactly which half of the check failed.
 */
function validateRequest(req) {
  if (!config.twilio.validateSignature) {
    return { valid: true, reason: 'validation disabled' };
  }

  const authToken = config.twilio.authToken;
  if (!authToken) {
    // Fail closed. An empty token would otherwise make every signature "verifiable"
    // against HMAC('') and turn the check into decoration.
    return { valid: false, reason: 'TWILIO_AUTH_TOKEN is not set' };
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) return { valid: false, reason: 'missing X-Twilio-Signature header' };

  const url = buildUrl(req);
  // Twilio signs the POST body for form-encoded requests, and the bare URL for JSON ones.
  const isForm = /application\/x-www-form-urlencoded/i.test(req.headers['content-type'] || '');
  const params = isForm ? req.body : undefined;

  if (safeEquals(signature, expectedSignature(authToken, url, params))) {
    return { valid: true, reason: 'ok' };
  }
  return { valid: false, reason: `signature mismatch for url=${url}` };
}

module.exports = { validateRequest, expectedSignature, buildUrl };
