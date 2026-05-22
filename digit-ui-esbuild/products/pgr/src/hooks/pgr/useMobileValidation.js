import {
  DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
  DEFAULT_MOBILE_ERROR_MESSAGE,
  DEFAULT_MOBILE_MAX_LENGTH,
  DEFAULT_MOBILE_MIN_LENGTH,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";

/**
 * Custom hook to fetch mobile number validation configuration from MDMS
 * Priority:
 * 1. Global configs (window.globalConfigs?.getConfig("CORE_MOBILE_CONFIGS"))
 * 2. MDMS configs (ValidationConfigs.mobileNumberValidation)
 * 3. Default fallback validation (see packages/libraries/src/constants/mobileValidation.js)
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - The validation name (default: "defaultMobileValidation")
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
        "moduleDetails": [
          {
            "moduleName": "ValidationConfigs",
            "masterDetails": [
              {
                "name": "mobileNumberValidation"
              }
            ]
          }
        ]
      },
    },
    config: {
      enabled: !!tenantId,
      select: (data) => {
        return data.MdmsRes;
      },
    },
  };
  // Fetch project staff details using custom API hook
  const { isLoading, data, error } = Digit.Hooks.useCustomAPIHook(reqCriteria);

  /** ---------- Priority 1: Global Config ---------- */
  const globalConfig = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};


  // Extract validation rules
  const mdmsConfig = data?.ValidationConfigs?.mobileNumberValidation?.find(
    (config) => config.validationName === validationName
  );

  // Default fallback validation if MDMS fails. Values come from a single
  // constants module so they can be overridden centrally.
  const defaultValidation = {
    validationName: "defaultMobileValidation",
    rules: {
      allowedStartingDigits: DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS,
      prefix: DEFAULT_MOBILE_PREFIX,
      pattern: DEFAULT_MOBILE_PATTERN,
      minLength: DEFAULT_MOBILE_MIN_LENGTH,
      maxLength: DEFAULT_MOBILE_MAX_LENGTH,
      errorMessage: DEFAULT_MOBILE_ERROR_MESSAGE,
      isActive: true,
    },
  };

  /** ---------- Combine configs with priority ---------- */
  const validationRules = {
    allowedStartingDigits:
      globalConfig?.mobileNumberAllowedStartingDigits || mdmsConfig?.rules?.allowedStartingDigits || defaultValidation?.rules?.allowedStartingDigits,

    prefix:
      globalConfig?.mobilePrefix ||
      mdmsConfig?.rules?.prefix ||
      defaultValidation?.rules?.prefix,

    pattern:
      globalConfig?.mobileNumberPattern ||
      mdmsConfig?.rules?.pattern ||
      defaultValidation?.rules?.pattern,

    minLength:
      globalConfig?.mobileNumberLength ||
      mdmsConfig?.rules?.minLength ||
      defaultValidation?.rules?.minLength,

    maxLength:
      globalConfig?.mobileNumberLength ||
      mdmsConfig?.rules?.maxLength ||
      defaultValidation?.rules?.maxLength,

    errorMessage:
      globalConfig?.mobileNumberErrorMessage || mdmsConfig?.rules?.errorMessage || defaultValidation?.rules?.errorMessage,

    isActive: (mdmsConfig && mdmsConfig.rules && mdmsConfig.rules.isActive !== undefined)
      ? mdmsConfig.rules.isActive
      : (defaultValidation && defaultValidation.rules && defaultValidation.rules.isActive !== undefined)
        ? defaultValidation.rules.isActive
        : true

  };


  // Helper function to get min/max values for number validation
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
