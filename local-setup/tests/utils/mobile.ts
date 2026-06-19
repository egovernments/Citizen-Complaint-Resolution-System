/**
 * Tenant-aware test mobile numbers — shared by the smoke (Jest) and
 * e2e (Playwright) suites.
 *
 * egov-user enforces the tenant's MDMS rule (common-masters.UserValidation,
 * Redis-cached as `validationRules`) even on _createnovalidate, so a
 * hardcoded Indian-shaped number fails on any tenant with a different
 * rule (e.g. ethiopia rejects everything but ^[17][0-9]{8}$ with
 * INVALID_MOBILE_FORMAT).
 *
 * Rule resolution order (mirrors who actually enforces what):
 *   1. CITIZEN_MOBILE_LENGTH / CITIZEN_MOBILE_PREFIX / CITIZEN_MOBILE_PATTERN
 *      env vars — explicit operator override.
 *   2. e2e runs: the Playwright global setup queries MDMS
 *      common-masters.UserValidation — the runtime source of truth the
 *      server validates against — and exports these env vars. The
 *      deployment's globalConfigs.js (a compile-time render of
 *      core_mobile_configs) is only a fallback when MDMS has no rule.
 *   3. India/pg defaults (10 digits starting with 9) — matches the
 *      smoke suite's hardcoded pg tenant, which ships no UserValidation.
 *
 * Read lazily so values set by the global setup at runtime are seen.
 *
 * When CITIZEN_MOBILE_PATTERN is known, every generated number is
 * self-checked against it and generation fails fast with an actionable
 * message — length+prefix is a lossy projection of the rule (it cannot
 * express optional prefixes like ^0?[17]… or constrained middle digits),
 * and a wrong number would otherwise surface as a confusing
 * INVALID_MOBILE_FORMAT deep inside a spec.
 */
export function mobileRules(): { length: number; prefix: string; pattern: string | null } {
  return {
    length: Number(process.env.CITIZEN_MOBILE_LENGTH || 10),
    prefix: process.env.CITIZEN_MOBILE_PREFIX || '9',
    pattern: process.env.CITIZEN_MOBILE_PATTERN || null,
  };
}

function assertMatchesTenantRule(mobile: string): string {
  const { pattern } = mobileRules();
  if (pattern && !new RegExp(pattern).test(mobile)) {
    throw new Error(
      `[mobile] generated "${mobile}" violates the tenant mobile rule ${pattern} ` +
        `(MDMS common-masters.UserValidation). CITIZEN_MOBILE_LENGTH/CITIZEN_MOBILE_PREFIX ` +
        `are a lossy projection of that rule — set them explicitly to values the pattern accepts.`,
    );
  }
  return mobile;
}

/**
 * Unique per run (millisecond clock). `offset` distinguishes numbers
 * minted in the same millisecond (e.g. a citizen and an employee).
 */
export function uniqueMobile(offset = 0): string {
  const { length, prefix } = mobileRules();
  return assertMatchesTenantRule(
    prefix + (Date.now() + offset).toString().slice(-(length - prefix.length)),
  );
}

/** Deterministic across runs; `seed` is zero-padded (or truncated) into the suffix. */
export function fixedMobile(seed: number): string {
  const { length, prefix } = mobileRules();
  const bodyLen = length - prefix.length;
  return assertMatchesTenantRule(prefix + String(seed).slice(-bodyLen).padStart(bodyLen, '0'));
}
