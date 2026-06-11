/**
 * Tenant-aware test mobile numbers — shared by the smoke (Jest) and
 * e2e (Playwright) suites.
 *
 * egov-user enforces the tenant's UserValidation mobile rule even on
 * _createnovalidate, so a hardcoded Indian-shaped number fails on any
 * tenant with different core_mobile_configs (e.g. ethiopia rejects
 * everything but ^[17][0-9]{8}$ with INVALID_MOBILE_FORMAT).
 *
 * Rule resolution order:
 *   1. CITIZEN_MOBILE_LENGTH / CITIZEN_MOBILE_PREFIX env vars
 *   2. e2e runs: derived from the target deployment's globalConfigs.js
 *      (coreMobileConfigs) by the Playwright global setup, which
 *      exports them as the same env vars
 *   3. India/pg defaults (10 digits starting with 9) — matches the
 *      smoke suite's hardcoded pg tenant.
 *
 * Read lazily so values set by the global setup at runtime are seen.
 */
export function mobileRules(): { length: number; prefix: string } {
  return {
    length: Number(process.env.CITIZEN_MOBILE_LENGTH || 10),
    prefix: process.env.CITIZEN_MOBILE_PREFIX || '9',
  };
}

/**
 * Unique per run (millisecond clock). `offset` distinguishes numbers
 * minted in the same millisecond (e.g. a citizen and an employee).
 */
export function uniqueMobile(offset = 0): string {
  const { length, prefix } = mobileRules();
  return prefix + (Date.now() + offset).toString().slice(-(length - prefix.length));
}

/** Deterministic across runs; `seed` is zero-padded (or truncated) into the suffix. */
export function fixedMobile(seed: number): string {
  const { length, prefix } = mobileRules();
  const bodyLen = length - prefix.length;
  return prefix + String(seed).slice(-bodyLen).padStart(bodyLen, '0');
}
