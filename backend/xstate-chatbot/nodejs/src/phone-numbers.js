const config = require('./env-variables');

// One pair of conversions for every channel adapter.
//
// Both directions are idempotent: a number that already carries the prefix is not
// double-prefixed, and one that does not is not truncated. That second guarantee
// needs a length test, not just a prefix test — under COUNTRY_CODE=91 the
// national number 9123456789 starts with its own country code, and stripping on
// the prefix alone turned it into 23456789 and lost it from the whitelist. Same
// rule as user-service.js sanitizeMobileNumber: strip only a number whose length
// says the prefix is really there.

/** Digits only, with the configured country code removed if present. */
function toNationalNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const countryCode = String(config.countryCode ?? '').replace(/\D/g, '');
  const carriesPrefix =
    countryCode &&
    digits.length === countryCode.length + config.mobileNumberLength &&
    digits.startsWith(countryCode);
  return carriesPrefix ? digits.slice(countryCode.length) : digits;
}


/** Digits only, with exactly one country code on the front. No plus. */
function toInternationalNumber(value) {
  const countryCode = String(config.countryCode ?? '').replace(/\D/g, '');
  const national = toNationalNumber(value);

  if (!national || national === countryCode) return '';
  return `${countryCode}${national}`;
}

module.exports = { toNationalNumber, toInternationalNumber };
