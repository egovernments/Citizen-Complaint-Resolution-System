import {
  computeMobileLengths,
  extractAllowedStartingDigits,
  buildMobileErrorMessage,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
  // Pick the record that is both default:true and isActive:true. When none
  // matches, mdmsConfig is null and resolution falls through to globalConfig.
  const mobileNumberValidationList = data?.["common-masters"]?.MobileNumberValidation || [];
  const mdmsConfig =
    mobileNumberValidationList.find((entry) => entry?.default === true && entry?.isActive !== false) ||
    mobileNumberValidationList.find((entry) => entry?.isActive !== false) ||
    null;

  /** ---------- Priority 2: Global Config ---------- */
  const globalConfig = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};

  /** ---------- Combined view (MDMS > globalConfigs > library default) ----------
   *
   * `mobileNumberRegex` is the single source of truth. All derived values
   * (allowedStartingDigits, minLength, maxLength, errorMessage) are computed
   * from the resolved regex — never from separate config fields.
   */
  const resolvedPattern =
    mdmsConfig?.mobileNumberRegex ||
    globalConfig?.mobileNumberRegex ||
    globalConfig?.mobileNumberPattern ||
    DEFAULT_MOBILE_PATTERN;

  const { min: resolvedMin, max: resolvedMax } = computeMobileLengths(resolvedPattern);

  const validationRules = {
    allowedStartingDigits: extractAllowedStartingDigits(resolvedPattern),

    countryCode:
      mdmsConfig?.countryCode ||
      globalConfig?.countryCode ||
      DEFAULT_MOBILE_PREFIX,
    prefix:
      mdmsConfig?.countryCode ||
      globalConfig?.countryCode ||
      DEFAULT_MOBILE_PREFIX,

    mobileNumberRegex: resolvedPattern,
    pattern: resolvedPattern,

    minLength: resolvedMin,
    maxLength: resolvedMax > 0 ? resolvedMax : 15,

    // `t` from react-i18next resolves ERR_INVALID_MOBILE_NUMBER / MOBILE_VALIDATION_*
    // against the active locale (module: rainmaker-common) — without it this
    // message is hardcoded English regardless of the selected language.
    errorMessage: buildMobileErrorMessage(resolvedPattern, t),

    isActive: mdmsConfig?.isActive !== undefined ? mdmsConfig.isActive : true,
  };

  // Mirror the resolved rule on `window` so synchronous, hook-less
  // consumers (e.g. `pgr/src/configs/CreateComplaintConfig.js` getters)
  // pick up the same MDMS-sourced value the React tree just computed.
  // Falls back to globalConfigs naturally for any consumer that runs
  // before the first React render.
  if (typeof window !== "undefined" && !isLoading && mdmsConfig) {
    window.__DIGIT_USER_VALIDATION = window.__DIGIT_USER_VALIDATION || {};
    window.__DIGIT_USER_VALIDATION.mobile = validationRules;
    // CCSD-1990/1989: name + email ride the same master (optional fields) and
    // the same canonical channel. Synchronous consumers (config getters) fall
    // back to their built-in patterns when these are absent — an unseeded or
    // partially-seeded master can never break a form.
    if (mdmsConfig.nameRegex) {
      window.__DIGIT_USER_VALIDATION.name = { pattern: mdmsConfig.nameRegex };
    }
    if (mdmsConfig.emailRegex) {
      window.__DIGIT_USER_VALIDATION.email = { pattern: mdmsConfig.emailRegex };
    }
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
