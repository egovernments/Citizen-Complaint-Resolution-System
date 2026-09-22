// Logging helpers for citizen data.
//
// Inbound webhooks carry a mobile number, the complaint text, GPS coordinates and
// media urls; the mobile number is also a persistent identifier for a person who
// filed a grievance, often about their own government. Container logs are read by
// more people than the database is, and are shipped off-box, so neither belongs
// there in full.

/** 84****981 — enough to correlate two lines, not enough to identify or dial. */
function maskMobile(mobileNumber) {
  const digits = String(mobileNumber ?? '').replace(/\D/g, '');
  if (!digits) return '<none>';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}

/**
 * A request url with its query values replaced by `<redacted>`.
 *
 * ValueFirst and Kaleyra can present the webhook secret as `?webhookSecret=`,
 * so logging a raw url writes a live bearer credential to the container log —
 * on accepted requests as well as rejected ones. Keys are kept: which
 * parameters arrived is useful, what they held is not.
 */
function redactUrl(url) {
  const raw = String(url ?? '');
  const [path, query] = raw.split('?');
  if (!query) return path;
  const keys = new URLSearchParams(query);
  const redacted = [...keys.keys()].map((key) => `${key}=<redacted>`).join('&');
  return redacted ? `${path}?${redacted}` : path;
}


/**
 * What a webhook contained, without what it said: field NAMES only, plus the
 * counts and types needed to debug a malformed payload.
 */
function summarizeInbound(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const fields = Object.keys(payload).sort();
  const numMedia = Number(payload.NumMedia ?? 0) || 0;
  return JSON.stringify({
    fields,
    from: maskMobile(payload.From || payload.from || payload.mobile_number),
    numMedia,
    mediaType: numMedia > 0 ? String(payload.MediaContentType0 ?? '') : undefined,
    hasBody: Boolean(payload.Body ?? payload.text),
    hasLocation: Boolean(payload.Latitude && payload.Longitude),
    button: Boolean(payload.ButtonPayload || payload.ListId),
  });
}

module.exports = { maskMobile, summarizeInbound, redactUrl };
