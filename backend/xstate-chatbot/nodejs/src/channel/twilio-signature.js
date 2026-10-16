const crypto = require("crypto");

/**
 * Twilio request-authenticity check (X-Twilio-Signature).
 *
 * Twilio signs `url + <sorted POST params concatenated as key+value>` with the
 * account auth token (HMAC-SHA1, base64). The url MUST be byte-identical to the
 * one configured in the Twilio console — that is why it comes from config and
 * not from req.host: behind a proxy or tunnel the inbound host is not the host
 * Twilio hashed.
 *
 * Implemented against node's crypto rather than pulling in the twilio SDK: the
 * rest of this provider already talks to Twilio over node-fetch, and the scheme
 * is a dozen lines.
 *
 * Only the form-encoded webhook shape is supported, which is what Twilio sends
 * for WhatsApp inbound. A JSON body would need the bodySHA256 variant.
 */
function expectedSignature(authToken, url, params) {
  const data = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/** Constant-time compare — a length-safe wrapper around timingSafeEqual. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf-8");
  const right = Buffer.from(String(b || ""), "utf-8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isValidTwilioSignature({ authToken, url, params, signature }) {
  if (!authToken || !url || !signature) return false;
  return safeEqual(signature, expectedSignature(authToken, url, params));
}

module.exports = { isValidTwilioSignature, expectedSignature };
