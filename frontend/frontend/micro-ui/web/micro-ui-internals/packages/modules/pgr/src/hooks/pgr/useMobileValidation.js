/**
 * Custom hook to fetch mobile number validation configuration from MDMS
 * Priority:
 * 1. Global configs (window.globalConfigs?.getConfig("CORE_MOBILE_CONFIGS"))
 * 2. MDMS configs (UserValidation - fieldType: mobile as default)
 * 3. Default fallback validation
 *
 * Returns all available country validation configs for dropdown support,
 * plus the currently selected/default validation rules.
 *
 * @param {string} tenantId - The tenant ID
 * @param {string} validationName - The validation name (default: "defaultMobileValidation")
 * @returns {object} - Returns validation rules, all configs, loading state, and helpers
 */
const useMobileValidation = (tenantId, validationName = "defaultMobileValidation") => {
  // Fetch mobile validation config from MDMS
  const stateId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const moduleName = Digit.Utils.getMultiRootTenant() ? "common-masters" : Digit?.Utils?.getConfigModuleName?.();
  const { isLoading, data: mdmsData, error } = Digit.Hooks.useCustomMDMS(
    stateId,
    moduleName,
    [{ name: "UserValidation" }],
    {
      select: (data) => {
        const allValidations = data?.[moduleName]?.UserValidation || [];
        const mobileValidations = allValidations.filter(item => item.fieldType === "mobile");

        // Build config for each entry
        const allConfigs = mobileValidations.map((item) => ({
          fieldType: item.fieldType,
          isDefault: item.default === true,
          prefix: item.attributes?.prefix || "+91",
          pattern: item.rules?.pattern || "^[6-9][0-9]{9}$",
          maxLength: item.rules?.maxLength || 10,
          minLength: item.rules?.minLength || 10,
          errorMessage: item.rules?.errorMessage || "ES_SEARCH_APPLICATION_MOBILE_INVALID",
          allowedStartingCharacters: item.rules?.allowedStartingCharacters,
          isActive: item.isActive !== false,
        }));

        // Default config is the one flagged as default
        const defaultConfig = allConfigs.find((c) => c.isDefault) || allConfigs[0] || {
          prefix: "+91",
          pattern: "^[6-9][0-9]{9}$",
          maxLength: 10,
          minLength: 10,
          errorMessage: "ES_SEARCH_APPLICATION_MOBILE_INVALID",
          allowedStartingCharacters: ["6", "7", "8", "9"],
        };

        return {
          defaultConfig,
          allConfigs,
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
    allowedStartingCharacters: ["6", "7", "8", "9"],
    isActive: true,
  };

  const mdmsDefault = mdmsData?.defaultConfig || {};

  /** ---------- Combine configs with priority ---------- */
  const validationRules = {
    allowedStartingCharacters:
      globalConfig?.mobileNumberAllowedStartingCharacters || mdmsDefault?.allowedStartingCharacters || defaultValidation?.allowedStartingCharacters,

    prefix: globalConfig?.mobilePrefix || mdmsDefault?.prefix,

    pattern: globalConfig?.mobileNumberPattern || mdmsDefault?.pattern,

    minLength: globalConfig?.mobileNumberLength || mdmsDefault?.minLength,

    maxLength: globalConfig?.mobileNumberLength || mdmsDefault?.maxLength,

    errorMessage: globalConfig?.mobileNumberErrorMessage || mdmsDefault?.errorMessage,

    isActive:
      mdmsDefault?.isActive !== undefined
        ? mdmsDefault.isActive
        : defaultValidation.isActive !== undefined
          ? defaultValidation.isActive
          : true,
  };

  // All available country configs for dropdown
  const allValidationConfigs = mdmsData?.allConfigs || [];

  // Helper to get config by prefix value (e.g., "+91", "+251")
  const getConfigByPrefix = (prefix) => {
    return allValidationConfigs.find((c) => c.prefix === prefix) || validationRules;
  };

  // Helper function to get min/max values for number validation
  const getMinMaxValues = (config) => {
    const rules = config || validationRules;
    const { allowedStartingCharacters, minLength } = rules;
    if (!allowedStartingCharacters || allowedStartingCharacters.length === 0) {
      return { min: 0, max: 9999999999 };
    }

    const minDigit = Math.min(...allowedStartingCharacters.map(Number));
    const maxDigit = Math.max(...allowedStartingCharacters.map(Number));

    const min = minDigit * Math.pow(10, minLength - 1);
    const max = (maxDigit + 1) * Math.pow(10, minLength - 1) - 1;

    return { min, max };
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
