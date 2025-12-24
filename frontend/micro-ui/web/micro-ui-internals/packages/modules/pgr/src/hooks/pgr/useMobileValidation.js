/**
 * Custom hook to fetch mobile number validation configuration from MDMS
 * Priority:
 * 1. Global configs (window.globalConfigs?.getConfig("CORE_MOBILE_CONFIGS"))
 * 2. MDMS configs (UserValidation - fieldType: mobile)
 * 3. Default fallback validation
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - The validation name (default: "defaultMobileValidation")
 * @returns {object} - Returns validation rules and loading state
 */
const useMobileValidation = (tenantId, validationName = "defaultMobileValidation") => {
  // Fetch mobile validation config from MDMS
  const stateId = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const moduleName = Digit?.Utils?.getConfigModuleName?.() || "commonUiConfig";
  const { isLoading, data: mdmsConfig, error } = Digit.Hooks.useCustomMDMS(
    stateId,
    moduleName,
    [{ name: "UserValidation" }],
    {
      select: (data) => {
        const validationData = data?.[moduleName]?.UserValidation?.find((x) => x.fieldType === "mobile");
        const rules = validationData?.rules;
        const attributes = validationData?.attributes;
        return {
          prefix: attributes?.prefix || "+91",
          pattern: rules?.pattern || "^[6-9][0-9]{9}$",
          maxLength: rules?.maxLength || 10,
          minLength: rules?.minLength || 10,
          errorMessage: rules?.errorMessage || "ES_SEARCH_APPLICATION_MOBILE_INVALID",
          allowedStartingDigits: rules?.allowedStartingDigits,
          isActive: validationData?.isActive
        };
      },
      staleTime: 300000,
      enabled: !!stateId,
    }
  );

  /** ---------- Priority 1: Global Config ---------- */
  const globalConfig = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS") || {};

  // Default fallback validation
  const defaultValidation = {
    allowedStartingDigits: ["6", "7", "8", "9"],
    isActive: true,
  };

  /** ---------- Combine configs with priority ---------- */
  const validationRules = {
    allowedStartingDigits:
      globalConfig?.mobileNumberAllowedStartingDigits || mdmsConfig?.allowedStartingDigits || defaultValidation?.allowedStartingDigits,

    prefix: globalConfig?.mobilePrefix || mdmsConfig?.prefix,

    pattern: globalConfig?.mobileNumberPattern || mdmsConfig?.pattern,

    minLength: globalConfig?.mobileNumberLength || mdmsConfig?.minLength,

    maxLength: globalConfig?.mobileNumberLength || mdmsConfig?.maxLength,

    errorMessage: globalConfig?.mobileNumberErrorMessage || mdmsConfig?.errorMessage,

    isActive:
      mdmsConfig?.isActive !== undefined
        ? mdmsConfig.isActive
        : defaultValidation.isActive !== undefined
          ? defaultValidation.isActive
          : true,
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
