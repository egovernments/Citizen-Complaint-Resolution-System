const config = require('./env-variables');
const mobileValidation = require('./machine/service/mobile-validation-service');

// The tenant's MDMS MobileNumberValidation row is the single source of truth,
// shared with Twilio and user-service. COUNTRY_CODE is no longer read here.

/** National form under the tenant rule; plain digits when the rule cannot reconcile it. */
async function toNationalNumber(value) {
  const mobileConfig = await mobileValidation.getConfig(config.rootTenantId);
  return mobileValidation.toNational(value, mobileConfig) || mobileValidation.digitsOnly(value);
}

/** Digits with exactly one country code on the front. No plus. */
async function toInternationalNumber(value) {
  const mobileConfig = await mobileValidation.getConfig(config.rootTenantId);
  return mobileValidation.toAddressableDigits(value, mobileConfig) || '';
}

module.exports = { toNationalNumber, toInternationalNumber };