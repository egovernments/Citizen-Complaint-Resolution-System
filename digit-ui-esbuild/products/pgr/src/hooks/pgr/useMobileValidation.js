import {
  DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
  DEFAULT_MOBILE_ERROR_MESSAGE,
  DEFAULT_MOBILE_MAX_LENGTH,
  DEFAULT_MOBILE_MIN_LENGTH,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";

/**
 * Custom hook that returns the mobile-number validation config for the
 * current tenant.
 *
 * Priority (per @vinothrallapalli-eGov review on PR #689):
 *   1. MDMS — `common-masters.UserValidation` master, entry where
 *      `fieldType === "mobile"` (and `isActive !== false`). This is the
 *      single source of truth used across egov-user, egov-hrms, the
 *      configurator, and digit-ui.
 *   2. Global configs — `window.globalConfigs.getConfig("CORE_MOBILE_CONFIGS")`.
 *      Acts as the build-time fallback for tenants that haven't seeded
 *      a UserValidation row yet AND for synchronous read sites that
 *      can't wait for the MDMS round-trip (e.g. declarative form
 *      configs that import this module eagerly).
 *   3. Library defaults — `@egovernments/digit-ui-libraries` constants
 *      module. The last-line fallback if neither MDMS nor globalConfigs
 *      surfaces a rule.
 *
 * The hook also writes the resolved rules to `window.__DIGIT_USER_VALIDATION.mobile`
 * so synchronous consumers (form-config getters that can't be hooks)
 * can read the same MDMS-sourced value the React tree just resolved.
 *
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - Reserved for future per-field-name
 *   selection. Today's UserValidation master has one row per
 *   `fieldType`; this param is kept on the hook signature so callers
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
                name: "UserValidation",
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

  /** ---------- Priority 1: MDMS common-masters.UserValidation ---------- */
  // The master is an array of `{ fieldType, isActive, attributes, rules }`
  // rows. Pick the active mobile-typed row; if multiple rows ever exist
  // we take the first active one (legacy seed used a single row, future
  // tenants may add a `default: true` marker — both shapes covered).
  const userValidationList = data?.["common-masters"]?.UserValidation || [];
  const mdmsConfig = userValidationList.find(
    (entry) =>
      entry?.fieldType === "mobile" &&
      entry?.isActive !== false,
  );

  /** ---------- Priority 2: Global Config ---------- */
  const globalConfig = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};

  /** ---------- Priority 3: Library defaults ---------- */
  const defaultValidation = {
    rules: {
      allowedStartingCharacters: DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
      prefix: DEFAULT_MOBILE_PREFIX,
      pattern: DEFAULT_MOBILE_PATTERN,
      minLength: DEFAULT_MOBILE_MIN_LENGTH,
      maxLength: DEFAULT_MOBILE_MAX_LENGTH,
      errorMessage: DEFAULT_MOBILE_ERROR_MESSAGE,
      isActive: true,
    },
    attributes: {},
  };

  /** ---------- Combined view (MDMS > globalConfigs > defaults) ---------- */
  const validationRules = {
    allowedStartingDigits:
      mdmsConfig?.rules?.allowedStartingCharacters ||
      globalConfig?.mobileNumberAllowedStartingCharacters ||
      defaultValidation.rules.allowedStartingCharacters,

    prefix:
      mdmsConfig?.attributes?.prefix ||
      globalConfig?.mobilePrefix ||
      defaultValidation.rules.prefix,

    pattern:
      mdmsConfig?.rules?.pattern ||
      globalConfig?.mobileNumberPattern ||
      defaultValidation.rules.pattern,

    minLength:
      mdmsConfig?.rules?.minLength ||
      globalConfig?.mobileNumberLength ||
      defaultValidation.rules.minLength,

    maxLength:
      mdmsConfig?.rules?.maxLength ||
      globalConfig?.mobileNumberLength ||
      defaultValidation.rules.maxLength,

    errorMessage:
      mdmsConfig?.rules?.errorMessage ||
      globalConfig?.mobileNumberErrorMessage ||
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
