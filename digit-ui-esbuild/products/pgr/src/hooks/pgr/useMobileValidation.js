import {
  computeMobileLengths,
  extractAllowedStartingDigits,
  buildMobileErrorMessage,
  DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
  DEFAULT_MOBILE_ERROR_MESSAGE,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";

/**
 * Custom hook that returns the mobile-number validation config for the
 * current tenant.
 *
 * Priority:
 *   1. MDMS — `common-masters.MobileNumberValidation` master (flat schema:
 *      countryCode + mobileNumberRegex, default:true marks the tenant default).
 *      Single source of truth used across egov-user, egov-hrms, the
 *      configurator, and digit-ui.
 *   2. Global configs — `window.globalConfigs.getConfig("CORE_MOBILE_CONFIGS")`.
 *      Build-time fallback for tenants that haven't seeded a
 *      MobileNumberValidation row yet, and for synchronous read sites that
 *      can't wait for the MDMS round-trip.
 *   3. Library defaults — `@egovernments/digit-ui-libraries` constants
 *      module. Last-line fallback if neither MDMS nor globalConfigs surfaces
 *      a rule.
 *
 * The hook also writes the resolved rules to `window.__DIGIT_USER_VALIDATION.mobile`
 * so synchronous consumers (form-config getters that can't be hooks)
 * can read the same MDMS-sourced value the React tree just resolved.
 *
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - Reserved for future per-field-name
 *   selection. This param is kept on the hook signature so callers
 *   that want a non-default mobile rule later don't have to migrate.
 * @returns {object} - Returns validation rules and loading state
 */
const useMobileValidation = (tenantId, validationName = "defaultMobileValidation") => {
  const reqCriteria = {
    url: `/${window?.globalConfigs?.getConfig?.("MDMS_V1_CONTEXT_PATH") || "mdms-v2"}/v1/_search`,
    params: {
      tenantId: tenantId,
    },
    body: {
      MdmsCriteria: {
        tenantId: tenantId,
        moduleDetails: [
          {
            moduleName: "common-masters",
            masterDetails: [
              {
                name: "MobileNumberValidation",
              },
            ],
          },
        ],
      },
    },
    config: {
      enabled: !!tenantId,
      select: (data) => data.MdmsRes,
    },
  };

  const { isLoading, data, error } = Digit.Hooks.useCustomAPIHook(reqCriteria);

  /** ---------- Priority 1: MDMS common-masters.MobileNumberValidation ---------- */
  // Flat schema: { countryCode, mobileNumberRegex, default, isActive }.
  // Pick the record with default:true; fall back to the first active record.
  const mobileNumberValidationList = data?.["common-masters"]?.MobileNumberValidation || [];
  const mdmsConfig = mobileNumberValidationList.find(
    (entry) => entry?.default === true && entry?.isActive !== false,
  ) || mobileNumberValidationList.find((entry) => entry?.isActive !== false);

  /** ---------- Priority 2: Global Config ---------- */
  const globalConfig = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};

  /** ---------- Priority 3: Library defaults ---------- */
  const defaultValidation = {
    rules: {
      allowedStartingCharacters: DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
      prefix: DEFAULT_MOBILE_PREFIX,
      pattern: DEFAULT_MOBILE_PATTERN,
      errorMessage: DEFAULT_MOBILE_ERROR_MESSAGE,
      isActive: true,
    },
  };

  /** ---------- Combined view (MDMS > globalConfigs > defaults) ---------- */
  const resolvedPattern =
    mdmsConfig?.mobileNumberRegex ||
    globalConfig?.mobileNumberPattern ||
    defaultValidation.rules.pattern;

  const { min: resolvedMin, max: resolvedMax } = computeMobileLengths(resolvedPattern);

  const validationRules = {
    allowedStartingDigits:
      extractAllowedStartingDigits(resolvedPattern) ||
      globalConfig?.mobileNumberAllowedStartingCharacters ||
      defaultValidation.rules.allowedStartingCharacters,

    countryCode:
      mdmsConfig?.countryCode ||
      globalConfig?.mobilePrefix ||
      defaultValidation.rules.prefix,
    prefix:
      mdmsConfig?.countryCode ||
      globalConfig?.mobilePrefix ||
      defaultValidation.rules.prefix,

    mobileNumberRegex: resolvedPattern,
    pattern: resolvedPattern,

    minLength: resolvedMin,
    maxLength: resolvedMax > 0 ? resolvedMax : 15,

    errorMessage:
      globalConfig?.mobileNumberErrorMessage ||
      buildMobileErrorMessage(resolvedPattern) ||
      defaultValidation.rules.errorMessage,

    isActive:
      mdmsConfig?.isActive !== undefined
        ? mdmsConfig.isActive
        : defaultValidation.rules.isActive,
  };

  // Mirror the resolved rule on `window` so synchronous, hook-less
  // consumers (e.g. `pgr/src/configs/CreateComplaintConfig.js` getters)
  // pick up the same MDMS-sourced value the React tree just computed.
  // Falls back to globalConfigs naturally for any consumer that runs
  // before the first React render.
  if (typeof window !== "undefined" && !isLoading && mdmsConfig) {
    window.__DIGIT_USER_VALIDATION = window.__DIGIT_USER_VALIDATION || {};
    window.__DIGIT_USER_VALIDATION.mobile = validationRules;
  }

  const getMinMaxValues = () => {
    const { allowedStartingDigits, minLength } = validationRules;
    if (!allowedStartingDigits || allowedStartingDigits.length === 0) {
      return { min: 0, max: 9999999999 };
    }

    const minDigit = Math.min(...allowedStartingDigits.map(Number));
    const maxDigit = Math.max(...allowedStartingDigits.map(Number));

    const min = minDigit * Math.pow(10, minLength - 1);
    const max = (maxDigit + 1) * Math.pow(10, minLength - 1) - 1;

    return { min, max };
  };

  return {
    validationRules,
    isLoading,
    error,
    getMinMaxValues,
  };
};

export default useMobileValidation;
