import { useQuery } from "react-query";

/**
 * Custom hook to fetch mobile number validation configuration from MDMS
 * Priority:
 * 1. Global configs (window.globalConfigs?.getConfig("CORE_MOBILE_CONFIGS"))
 * 2. MDMS configs (ValidationConfigs.mobileNumberValidation)
 * 3. Default fallback validation
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - The validation name (default: "defaultMobileValidation")
 * @returns {object} - Returns validation rules and loading state
 */
const useMobileValidation = (tenantId, validationName = "defaultMobileValidation") => {
  const reqCriteria = {
    url: `/egov-mdms-service/v1/_search`,
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

  // Default fallback validation if MDMS fails
  const defaultValidation = {
    validationName: "defaultMobileValidation",
    rules: {
      allowedStartingDigits: ["6", "7", "8", "9"],
      prefix: "+91",
      pattern: "^[6-9][0-9]{9}$",
      minLength: 10,
      maxLength: 10,
      errorMessage: "Please enter a valid 10-digit mobile number starting with 6-9",
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
