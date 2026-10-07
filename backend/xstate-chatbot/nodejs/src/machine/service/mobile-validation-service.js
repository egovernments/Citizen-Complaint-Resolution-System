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
 * The primary rule matches novu-bridge's MdmsServiceClient: the first active row whose
 * `default` is true wins. A state can carry more rows (ke: +254 and +91); inbound also
 * accepts those as `alternates`, so a +91 citizen is not turned away.
 *
 * Outbound does not depend on the alternates. PGR builds the notification number from the
 * citizen's own egov-user `countryCode` (ComplaintDomainEventService.buildFullMobile,
 * NotificationService.buildMobileWithCountryCode), and novu-bridge sends a `+`-prefixed
 * number unchanged. novu-bridge's default row is only a fallback for a citizen record with
 * no `countryCode`. Either way outbound is only as right as that stored `countryCode`.
 */
const SCHEMA_CODE = "common-masters.MobileNumberValidation";

class MobileValidationService {
  constructor() {
    // tenantId -> { value: {countryCode, mobileNumberRegex}, expiresAt }
    this.cache = new Map();
    // mobileNumberRegex source -> compiled RegExp
    this.regexCache = new Map();
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
      timeout: config.timeouts.request,
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

    const toConfig = (row) => ({
      countryCode: String(row.data.countryCode).trim(),
      mobileNumberRegex: row.data.mobileNumberRegex || config.mobileValidation.defaultRegex,
    });
    // A state can carry more than one active row: ke serves ke.bomet (+254) and ke.india
    // (+91) from one root. The chosen row stays authoritative for bare national numbers;
    // see resolveNational for when the others are tried.
    const alternates = active
      .filter((r) => r !== chosen && r.data.countryCode)
      .map(toConfig);

    return { ...toConfig(chosen), alternates };
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

  /**
   * Compile the tenant rule, falling back rather than throwing on a malformed regex.
   * Compiled once per pattern: this runs for every candidate form of every row, several
   * times per message.
   */
  nationalRegex(mobileConfig) {
    const pattern = mobileConfig.mobileNumberRegex;
    let compiled = this.regexCache.get(pattern);
    if (compiled) return compiled;
    try {
      compiled = new RegExp(pattern);
    } catch (error) {
      console.error(`Invalid mobileNumberRegex '${pattern}': ${error.message}`);
      compiled = new RegExp(config.mobileValidation.defaultRegex);
    }
    this.regexCache.set(pattern, compiled);
    return compiled;
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
    const resolved = this.resolveNational(raw, mobileConfig);
    return resolved ? resolved.national : null;
  }

  /**
   * toNational plus the rule that matched. Anything that rebuilds an international number
   * must use `rule`, not the primary config: a +91 citizen reconciled through ke's +91
   * alternate would otherwise get +254 put back on.
   */
  resolveNational(raw, mobileConfig) {
    if (!mobileConfig) return null;
    const digits = this.digitsOnly(raw);
    if (!digits) return null;
    const rules = [mobileConfig, ...(mobileConfig.alternates || [])];

    // 1. Only for a number written in international form (`+…`, e.g. Twilio's From): a
    //    rule whose country code actually prefixes it, and which accepts what is left once
    //    it is removed. This runs before any regex-only match, because a permissive
    //    primary such as ^[0-9]{9,12}$ also accepts the as-sent 916307817430 and would
    //    otherwise hide the +91 row. A bare number carries no country code, so it skips
    //    this step: 7912345678 must not be read as +7 912345678.
    if (this.isInternationalForm(raw)) {
      for (const rule of rules) {
        const cc = this.countryDigits(rule);
        if (!cc || !digits.startsWith(cc) || digits.length <= cc.length) continue;
        const national = this.nationalFor(digits, rule);
        if (national && national !== digits) return { national, rule };
      }
    }

    // 2. Each rule in turn, primary first, exactly as a single rule is applied.
    for (const rule of rules) {
      const national = this.nationalFor(digits, rule);
      if (national) return { national, rule };
    }
    return null;
  }

  /** `+254…`, `whatsapp:+254…`: the sender wrote the country code. */
  isInternationalForm(raw) {
    return /^\s*(whatsapp:)?\s*\+/i.test(String(raw == null ? "" : raw));
  }

  /** toNational against a single rule. */
  nationalFor(raw, mobileConfig) {
    const cc = this.countryDigits(mobileConfig);
    // `00` is the international dialling prefix most of the world uses in place of `+`.
    // Only stripped when this rule's own code follows, so a trunk-0 number is untouched.
    let digits = this.digitsOnly(raw);
    if (cc && digits.startsWith('00' + cc)) digits = digits.slice(2);
    if (!digits) return null;

    const withoutCc =
      cc && digits.startsWith(cc) && digits.length > cc.length ? digits.slice(cc.length) : null;

    // Order matters, and both orderings have bitten this function:
    //
    //  * country-code-stripped FIRST, because a tenant rule can also match the
    //    dial-code-prefixed form. With +258 / ^[0-9]{9,12}$, '258841234567' satisfies the
    //    rule as-sent, so trying the as-sent form first returned the INTERNATIONAL number
    //    as the national one -- diverging from the 9-digit record novu-bridge uses for the
    //    same citizen, so inbound and outbound disagreed about who the user is.
    //
    //  * as-sent SECOND, so a genuine national number is never rewritten. With +1 /
    //    ^[0-9]{10}$, '1234567890' must stay itself; stripping the leading '1' leaves 9
    //    digits, which fails the rule, so this falls through to the as-sent form correctly.
    //
    // Nothing is fabricated among these: every candidate is a form the sender could have
    // actually transmitted.
    const candidates = [];
    if (withoutCc) {
      candidates.push(withoutCc);
      if (withoutCc.startsWith('0')) candidates.push(withoutCc.replace(/^0+/, ''));
    }
    candidates.push(digits);
    if (digits.startsWith('0')) candidates.push(digits.replace(/^0+/, ''));

    for (const candidate of candidates) {
      if (this.isNational(candidate, mobileConfig)) return candidate;
    }

    // LAST RESORT, and only after every real form has failed: a tenant whose rule REQUIRES
    // the domestic trunk 0 (e.g. ^0[17][0-9]{8}$) can never match a country-code-prefixed
    // number without it. Synthesising the 0 here is safe precisely because we would
    // otherwise return null -- it cannot shadow a real interpretation, which is what went
    // wrong when this candidate sat ahead of the as-sent form.
    if (withoutCc && !withoutCc.startsWith('0') && this.isNational('0' + withoutCc, mobileConfig)) {
      return '0' + withoutCc;
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

  /**
   * Best-effort E.164 digits for ADDRESSING a reply, without inventing a country code.
   *
   * `toInternational` prepends the tenant's code unconditionally, which is right for a
   * number already reconciled to national form and wrong for anything else. Feeding it an
   * unreconciled number produced addresses that cannot exist:
   *
   *   +447700900123 under the ke rule -> national=null -> To=+254447700900123  (Twilio 21211)
   *   +254712345678 under a trunk-0-required rule -> To=+254254712345678
   *
   * Twilio always delivers E.164 in `From`, so when a number cannot be reconciled to the
   * tenant rule the digits already ARE international and are returned untouched. The
   * citizen gets a reply at the number they actually messaged from, and a mismatched or
   * overly narrow MDMS rule degrades to "answer anyway" rather than "answer nobody".
   */
  toAddressableDigits(raw, mobileConfig) {
    const digits = this.digitsOnly(raw);
    if (!digits) return null;
    // `raw`, not `digits`: whether it was written with `+` matters to resolveNational.
    const resolved = this.resolveNational(raw, mobileConfig);
    if (resolved) return this.toInternational(resolved.national, resolved.rule);
    return digits;
  }

  /** Convenience: resolve the tenant rule and normalise in one call. */
  async normalise(raw, tenantId, user) {
    const mobileConfig = await this.getConfig(tenantId, user);
    const resolved = this.resolveNational(raw, mobileConfig);
    const national = resolved ? resolved.national : null;
    return {
      config: mobileConfig,
      national: national,
      international: resolved
        ? this.toInternational(national, resolved.rule)
        : null,
      e164: resolved ? this.toE164(national, resolved.rule) : null,
    };
  }
}

module.exports = new MobileValidationService();
