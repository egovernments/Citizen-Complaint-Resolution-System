const config = require("../../env-variables");
const fetch = require("node-fetch");

/**
 * Tenant-aware mobile number handling.
 *
 * `common-masters.MobileNumberValidation` is the platform's single source of truth for
 * "what is a valid mobile number for this tenant, and what country code does it carry".
 * egov-user, egov-hrms, digit-ui and novu-bridge all read it. The chatbot used to hardcode
 * India in four places (`+91` prepended on send, a leading `91` stripped on receive, and a
 * sanitiser that accepted only 10 digits or 12 starting `91`), which made every non-Indian
 * tenant unusable — a Kenyan `+254712345678` failed sanitisation outright.
 *
 * Row shape (MDMS v2 `mdms[].data`), matching the seeded masters:
 *   { "countryCode": "+254", "mobileNumberRegex": "^0?[17][0-9]{8}$", "default": true }
 *
 * Resolution mirrors novu-bridge's MdmsServiceClient so inbound and outbound agree on the
 * same number for the same citizen: the first active row whose `default` is true wins.
 */
const SCHEMA_CODE = "common-masters.MobileNumberValidation";

class MobileValidationService {
  constructor() {
    // tenantId -> { value: {countryCode, mobileNumberRegex}, expiresAt }
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  /** Config used when MDMS has no row, or is unreachable. Keeps the bot answering. */
  fallbackConfig() {
    return {
      countryCode: config.mobileValidation.defaultCountryCode,
      mobileNumberRegex: config.mobileValidation.defaultRegex,
      fallback: true,
    };
  }

  /** `pg.citya` -> `pg`. MDMS has no parent rollup, so walk the hierarchy here. */
  stateRoot(tenantId) {
    return String(tenantId || "").split(".")[0];
  }

  async getConfig(tenantId, user) {
    const key = tenantId || config.rootTenantId;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    // MobileNumberValidation is seeded at the STATE tenant, and MdmsCriteria.tenantId is an
    // exact match with no parent rollup. City-level callers (fetchLocalities and both deep-link
    // builders pass context.slots.pgr.city, e.g. `pg.citya`) would therefore always miss and
    // silently land on the India fallback, reinstating the hardcoding this service removes.
    // Try the exact tenant, then its state root, and only then fall back.
    const lookups = [key];
    const root = this.stateRoot(key);
    if (root && root !== key) lookups.push(root);

    let value = null;
    for (const lookup of lookups) {
      try {
        value = await this.fetchFromMdms(lookup, user);
      } catch (error) {
        // A tenant with no row is normal on a fresh install, and MDMS being briefly
        // unreachable must not take the chatbot down — fall back and retry after the TTL.
        console.error(
          `MobileNumberValidation lookup failed for ${lookup}: ${error.message}`,
        );
        value = null;
      }
      if (value) break;
    }
    if (!value) value = this.fallbackConfig();

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + config.mobileValidation.cacheTtlMs,
    });
    return value;
  }

  async fetchFromMdms(tenantId, user) {
    const url =
      config.egovServices.egovServicesHost +
      config.egovServices.mdmsV2SearchPath;
    const body = {
      RequestInfo: {
        apiId: "Rainmaker",
        authToken: user ? user.authToken : undefined,
        msgId: Date.now() + "|en_IN",
        plainAccessRequest: {},
      },
      MdmsCriteria: { tenantId: tenantId, schemaCode: SCHEMA_CODE },
    };

    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error(`MDMS returned ${response.status}`);

    const data = await response.json();
    const rows = data.mdms || [];
    // `isActive !== false` rather than `=== true`: mdms-v2 omits the flag on some rows.
    const active = rows.filter((r) => r && r.isActive !== false && r.data);
    const chosen = active.find((r) => r.data.default === true) || active[0];
    if (!chosen || !chosen.data.countryCode) return null;

    return {
      countryCode: String(chosen.data.countryCode).trim(),
      mobileNumberRegex:
        chosen.data.mobileNumberRegex || config.mobileValidation.defaultRegex,
    };
  }

  /** Digits only — drops `whatsapp:`, `+`, spaces, dashes and brackets. */
  digitsOnly(value) {
    if (value === undefined || value === null) return "";
    return String(value).replace(/\D/g, "");
  }

  /** `+254` -> `254`. */
  countryDigits(mobileConfig) {
    return this.digitsOnly(mobileConfig.countryCode);
  }

  /** Compile the tenant rule, falling back rather than throwing on a malformed regex. */
  nationalRegex(mobileConfig) {
    try {
      return new RegExp(mobileConfig.mobileNumberRegex);
    } catch (error) {
      console.error(
        `Invalid mobileNumberRegex '${mobileConfig.mobileNumberRegex}': ${error.message}`,
      );
      return new RegExp(config.mobileValidation.defaultRegex);
    }
  }

  /** Does this candidate satisfy the tenant's national-number rule? */
  isNational(candidate, mobileConfig) {
    return !!candidate && this.nationalRegex(mobileConfig).test(candidate);
  }

  /**
   * Reduce any inbound form to the tenant's *national* number.
   *
   * Accepts `whatsapp:+254712345678`, `+254712345678`, `254712345678`, `0712345678`
   * and `712345678`, and returns the form the tenant's regex accepts. Returns null
   * when the number cannot be reconciled with the tenant rule, so callers can reject
   * rather than silently file a complaint against a mangled number.
   */
  toNational(raw, mobileConfig) {
    const digits = this.digitsOnly(raw);
    if (!digits) return null;

    const cc = this.countryDigits(mobileConfig);

    // The number AS SENT is tried first, so an already-national number is never rewritten
    // into a different one. Stripping the country code first was wrong: for a rule like
    // `^[0-9]{10}$` with cc `+1`, '1234567890' had its leading '1' eaten and a fabricated
    // '0' prepended, yielding '0234567890' -- a DIFFERENT subscriber, which then flowed into
    // loginUser/createUser. Only country-code-stripped forms that actually occur are
    // considered; nothing is fabricated.
    const candidates = [digits];
    if (digits.startsWith("0")) candidates.push(digits.replace(/^0+/, ""));
    if (cc && digits.startsWith(cc) && digits.length > cc.length) {
      const withoutCc = digits.slice(cc.length);
      candidates.push(withoutCc);
      // Some senders keep the domestic trunk 0 after the country code (+254 0712...).
      if (withoutCc.startsWith("0"))
        candidates.push(withoutCc.replace(/^0+/, ""));
    }

    for (const candidate of candidates) {
      if (this.isNational(candidate, mobileConfig)) return candidate;
    }
    return null;
  }

  /**
   * National number -> E.164 without the `+` (e.g. `254712345678`).
   *
   * The trunk prefix 0 is dropped: it is a domestic-dialling artefact and Twilio rejects
   * `+2540712345678`. PGR and novu-bridge both store the country-code-prefixed form.
   */
  toInternational(national, mobileConfig) {
    if (!national) return null;
    const cc = this.countryDigits(mobileConfig);
    const digits = this.digitsOnly(national);
    if (!cc) return digits;

    // A bare `startsWith(cc)` test is NOT enough to conclude "already international": an
    // Indian mobile like 9123456789 legitimately starts with '91', and treating it as
    // prefixed dropped the country code entirely, producing To=whatsapp:+9123456789 --
    // Twilio 21211 and no reply, for roughly every 91-prefixed subscriber. Only treat it as
    // already-international when removing the code leaves a VALID national number.
    if (digits.startsWith(cc) && digits.length > cc.length) {
      const remainder = digits.slice(cc.length);
      if (
        this.isNational(remainder, mobileConfig) ||
        this.isNational(remainder.replace(/^0+/, ""), mobileConfig)
      ) {
        return digits;
      }
    }
    // The trunk 0 is a domestic-dialling artefact; Twilio rejects +2540712345678.
    return cc + digits.replace(/^0+/, "");
  }

  /** E.164 with the leading `+`, which is what Twilio's `To`/`From` fields need. */
  toE164(national, mobileConfig) {
    const international = this.toInternational(national, mobileConfig);
    return international ? "+" + international : null;
  }

  /** Convenience: resolve the tenant rule and normalise in one call. */
  async normalise(raw, tenantId, user) {
    const mobileConfig = await this.getConfig(tenantId, user);
    const national = this.toNational(raw, mobileConfig);
    return {
      config: mobileConfig,
      national: national,
      international: national
        ? this.toInternational(national, mobileConfig)
        : null,
      e164: national ? this.toE164(national, mobileConfig) : null,
    };
  }
}

module.exports = new MobileValidationService();
