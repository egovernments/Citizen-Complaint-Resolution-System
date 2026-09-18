const config = require('./env-variables');

// One pair of conversions for every channel adapter.
//
// The adapters each did this by hand, and Kaleyra and ValueFirst still hardcoded
// India's prefix: they removed two digits from an inbound number and prepended
// "91" to an outbound one. On a +258 deployment that left the country code on the
// citizen's number (so it never matched ALLOWED_MOBILE_NUMBERS) and addressed
// replies to a number that does not exist.
//
// Both directions are idempotent: a number that already carries the prefix is not
// double-prefixed, and one that does not is not truncated.

/** Digits only, with the configured country code removed if present. */
function toNationalNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const countryCode = String(config.countryCode ?? '').replace(/\D/g, '');
  return countryCode && digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits;
}

/** Digits only, with exactly one country code on the front. No plus. */
function toInternationalNumber(value) {
  const national = toNationalNumber(value);
  if (!national) return '';   // a bare country code is not a number worth dialling
  const countryCode = String(config.countryCode ?? '').replace(/\D/g, '');
  return `${countryCode}${national}`;
}

module.exports = { toNationalNumber, toInternationalNumber };
