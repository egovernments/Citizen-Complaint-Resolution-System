const crypto = require("crypto");
const config = require("../env-variables");

/**
 * Header only. The query form used to be accepted too, for providers that can
 * only be given a URL — but a query secret is copied verbatim into every proxy
 * and ingress access log upstream of this service, which its own log redaction
 * cannot reach. A replayable bearer credential sitting in nginx and Kong logs
 * outweighed the convenience, so a provider that cannot send a header now needs
 * its own verifyRequest rather than a weaker shared path.
 */
function presentedSecret(req) {
  return req.get?.("X-Webhook-Secret") || "";
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
