const crypto = require("crypto");
const config = require("../env-variables");

/**
 * Request authenticity for providers with no signing scheme of their own.
 *
 * ValueFirst and Kaleyra sign nothing, so the only thing available is a secret
 * the operator configures on both sides. Weaker than Twilio's HMAC — it is a
 * bearer value, replayable, and only as good as the TLS around it — but it is
 * the difference between "anyone who finds the URL can file complaints as any
 * citizen" and "you need the secret".
 */
function presentedSecret(req) {
  return req.get?.("X-Webhook-Secret") || req.query?.webhookSecret || "";
}

/** Constant-time compare — a length-safe wrapper around timingSafeEqual. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf-8");
  const right = Buffer.from(String(b || ""), "utf-8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Shared by every adapter that has nothing better. Fails CLOSED when the secret
 * is unset, matching twilio.js: an unconfigured deployment is exactly the state
 * an attacker benefits from, so it must be loud rather than permissive.
 */
function verifySharedSecret(req, providerName) {
  if (!config.webhook.verify) {
    console.warn(`${providerName} - webhook verification is DISABLED (VERIFY_WEBHOOK_SIGNATURE=false)`);
    return true;
  }
  if (!config.webhook.sharedSecret) {
    console.error(`${providerName} - cannot verify webhook: WEBHOOK_SHARED_SECRET is unset`);
    return false;
  }
  return safeEqual(presentedSecret(req), config.webhook.sharedSecret);
}

module.exports = { verifySharedSecret, safeEqual };
