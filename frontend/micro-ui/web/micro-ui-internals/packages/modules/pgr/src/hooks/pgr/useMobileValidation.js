/**
 * Custom hook that returns mobile-number validation config for the current tenant.
 *
 * Resolution order (highest → lowest priority):
 *   1. MDMS — `common-masters.MobileNumberValidation` (countryCode + mobileNumberRegex)
 *   2. globalConfigs — CORE_MOBILE_CONFIGS.countryCode + mobileNumberRegex
 *   3. Library constants — DEFAULT_MOBILE_PATTERN / DEFAULT_MOBILE_PREFIX
 *
 * `mobileNumberRegex` is the single source of truth. All derived values
 * (allowedStartingCharacters, minLength, maxLength, errorMessage) are computed
 * from the resolved regex — there is no separate config field for each.
 *
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - Reserved for future per-field selection
 * @returns {object} validationRules, allValidationConfigs, isLoading, error, helpers
 */

// ── inline regex utilities (no import available in this bundle) ───────────────

function _splitAlternation(s) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[") { const e = s.indexOf("]", i + 1); if (e !== -1) i = e; }
    else if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "|" && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

function _computeFragmentLengths(s) {
  let min = 0, max = 0, i = 0;
  while (i < s.length) {
    let atomEnd = i;
    let baseMin = 1, baseMax = 1;
    if (s[i] === "[") {
      const end = s.indexOf("]", i + 1);
      atomEnd = end === -1 ? i + 1 : end + 1;
    } else if (s[i] === "\\") {
      atomEnd = i + 2;
    } else if (s[i] === "(") {
      let depth = 1; atomEnd = i + 1;
      while (atomEnd < s.length && depth > 0) {
        if (s[atomEnd] === "(") depth++;
        else if (s[atomEnd] === ")") depth--;
        atomEnd++;
      }
      let inner = s.slice(i + 1, atomEnd - 1);
      if (/^\?[=!]/.test(inner) || /^\?<[=!]/.test(inner)) {
        baseMin = 0; baseMax = 0;
      } else {
        if (inner.startsWith("?:")) inner = inner.slice(2);
        else if (inner.startsWith("?")) inner = inner.slice(1);
        const alts = _splitAlternation(inner);
        if (alts.length > 1) {
          const lens = alts.map(_computeFragmentLengths);
          baseMin = Math.min(...lens.map(l => l.min));
          const maxes = lens.map(l => l.max);
          baseMax = maxes.includes(-1) ? Infinity : Math.max(...maxes);
        } else {
          const g = _computeFragmentLengths(inner);
          baseMin = g.min; baseMax = g.max === -1 ? Infinity : g.max;
        }
      }
    } else {
      atomEnd = i + 1;
    }
    let repMin = 1, repMax = 1, qi = atomEnd;
    if (qi < s.length) {
      if (s[qi] === "?") { repMin = 0; repMax = 1; qi++; }
      else if (s[qi] === "*") { repMin = 0; repMax = Infinity; qi++; }
      else if (s[qi] === "+") { repMin = 1; repMax = Infinity; qi++; }
      else if (s[qi] === "{") {
        const end = s.indexOf("}", qi);
        if (end !== -1) {
          const parts = s.slice(qi + 1, end).split(",");
          repMin = parseInt(parts[0], 10) || 0;
          repMax = parts.length > 1 ? (parts[1].trim() ? parseInt(parts[1], 10) : Infinity) : repMin;
          qi = end + 1;
        }
      }
    }
    min += baseMin * repMin;
    max += (baseMax === Infinity || repMax === Infinity) ? Infinity : baseMax * repMax;
    i = qi;
  }
  return { min, max: isFinite(max) ? max : -1 };
}

function _computeMobileLengths(pattern) {
  if (!pattern) return { min: 0, max: -1 };
  const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
  return _computeFragmentLengths(s);
}

function _extractAllowedStartingDigits(pattern) {
  if (!pattern) return null;
  const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
  let i = 0;
  while (i < s.length) {
    let content = null, atomEnd;
    if (s[i] === "[") {
      const end = s.indexOf("]", i + 1);
      if (end === -1) break;
      content = s.slice(i + 1, end);
      atomEnd = end + 1;
    } else if (s[i] === "\\") {
      atomEnd = i + 2;
    } else {
      content = s[i]; atomEnd = i + 1;
    }
    if (atomEnd < s.length && s[atomEnd] === "?") { i = atomEnd + 1; continue; }
    if (!content) { i = atomEnd; continue; }
    const digits = [];
    let ci = 0;
    while (ci < content.length) {
      if (ci + 2 < content.length && content[ci + 1] === "-") {
        const from = content.charCodeAt(ci), to = content.charCodeAt(ci + 2);
        for (let code = from; code <= to; code++) digits.push(String.fromCharCode(code));
        ci += 3;
      } else {
        digits.push(content[ci]); ci++;
      }
    }
    const onlyDigits = digits.every((d) => /^[0-9]$/.test(d));
    return onlyDigits && digits.length > 0 ? digits : null;
  }
  return null;
}

// Keys: ERR_INVALID_MOBILE_NUMBER, MOBILE_VALIDATION_DIGITS, MOBILE_VALIDATION_AT_LEAST,
//       MOBILE_VALIDATION_STARTING_WITH, MOBILE_VALIDATION_OR
function _buildMobileErrorMessage(pattern, t) {
  const tr = typeof t === "function" ? t : (key, fallback) => fallback;
  const base = tr("ERR_INVALID_MOBILE_NUMBER", "Please enter a valid mobile number");
  if (!pattern) return base;
  const { min, max } = _computeMobileLengths(pattern);
  const startDigits = _extractAllowedStartingDigits(pattern);
  const digits  = tr("MOBILE_VALIDATION_DIGITS",    "digits");
  const atLeast = tr("MOBILE_VALIDATION_AT_LEAST",  "at least");
  const lenPart = min === max ? `${min} ${digits}` : max === -1 ? `${atLeast} ${min} ${digits}` : `${min}-${max} ${digits}`;
  let startPart = "";
  if (startDigits && startDigits.length > 0) {
    const u  = [...new Set(startDigits)];
    const sw = tr("MOBILE_VALIDATION_STARTING_WITH", "starting with");
    const or = tr("MOBILE_VALIDATION_OR",            "or");
    startPart = u.length === 1
      ? `, ${sw} ${u[0]}`
      : u.length === 2
        ? `, ${sw} ${u[0]} ${or} ${u[1]}`
        : `, ${sw} ${u.slice(0, -1).join(", ")}, ${or} ${u[u.length - 1]}`;
  }
  return `${base} (${lenPart}${startPart})`;
}

// ── defaults ──────────────────────────────────────────────────────────────────
const _DEFAULT_PATTERN = "^[6-9][0-9]{9}$";
const _DEFAULT_PREFIX  = "+91";

// ── hook ─────────────────────────────────────────────────────────────────────

const useMobileValidation = (tenantId, validationName = "defaultMobileValidation") => {
  const stateId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const moduleName = Digit.Utils.getMultiRootTenant()
    ? "common-masters"
    : Digit?.Utils?.getConfigModuleName?.();

  const { isLoading, data: mdmsData, error } = Digit.Hooks.useCustomMDMS(
    stateId,
    moduleName,
    [{ name: "MobileNumberValidation" }],
    {
      select: (data) => {
        const all = data?.[moduleName]?.MobileNumberValidation || [];
        const active = all.filter((r) => r.isActive !== false);
        const defaultRec = active.find((r) => r.default === true) || active[0] || null;
        return {
          defaultConfig: defaultRec,
          allConfigs: active,
        };
      },
      staleTime: 300000,
      enabled: !!stateId,
    }
  );

  const gc = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};

  // mobileNumberRegex is the single source of truth for all derived values.
  const resolvedPattern =
    mdmsData?.defaultConfig?.mobileNumberRegex ||
    gc?.mobileNumberRegex ||
    gc?.mobileNumberPattern ||
    _DEFAULT_PATTERN;

  const resolvedPrefix =
    mdmsData?.defaultConfig?.countryCode ||
    gc?.countryCode ||
    _DEFAULT_PREFIX;

  const { min: resolvedMin, max: resolvedMax } = _computeMobileLengths(resolvedPattern);

  const validationRules = {
    allowedStartingCharacters: _extractAllowedStartingDigits(resolvedPattern),

    countryCode: resolvedPrefix,
    prefix: resolvedPrefix,

    mobileNumberRegex: resolvedPattern,
    pattern: resolvedPattern,

    minLength: resolvedMin,
    maxLength: resolvedMax > 0 ? resolvedMax : 15,

    errorMessage: _buildMobileErrorMessage(resolvedPattern),

    isActive: mdmsData?.defaultConfig?.isActive !== undefined ? mdmsData.defaultConfig.isActive : true,
  };

  // All active configs for country-selector dropdowns
  const allValidationConfigs = (mdmsData?.allConfigs || []).map((r) => {
    const pat = r.mobileNumberRegex || _DEFAULT_PATTERN;
    const { min, max } = _computeMobileLengths(pat);
    return {
      isDefault: r.default === true,
      countryCode: r.countryCode || _DEFAULT_PREFIX,
      prefix: r.countryCode || _DEFAULT_PREFIX,
      mobileNumberRegex: pat,
      pattern: pat,
      allowedStartingCharacters: _extractAllowedStartingDigits(pat),
      minLength: min,
      maxLength: max > 0 ? max : 15,
      isActive: r.isActive !== false,
    };
  });

  const getConfigByPrefix = (prefix) =>
    allValidationConfigs.find((c) => c.countryCode === prefix) || validationRules;

  const getMinMaxValues = (config) => {
    const rules = config || validationRules;
    const { allowedStartingCharacters, minLength } = rules;
    if (!allowedStartingCharacters || allowedStartingCharacters.length === 0) {
      return { min: 0, max: 9999999999 };
    }
    const minDigit = Math.min(...allowedStartingCharacters.map(Number));
    const maxDigit = Math.max(...allowedStartingCharacters.map(Number));
    return {
      min: minDigit * Math.pow(10, minLength - 1),
      max: (maxDigit + 1) * Math.pow(10, minLength - 1) - 1,
    };
  };

  return {
    validationRules,
    allValidationConfigs,
    getConfigByPrefix,
    isLoading,
    error,
    getMinMaxValues,
  };
};

export default useMobileValidation;
