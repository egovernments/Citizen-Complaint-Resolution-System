/**
 * The route tenant's mobile-number rule for the citizen sign-in cards.
 */
export const useMobileValidationConfig = () => {
  // Read from common-masters.MobileNumberValidation — the single source
  // of truth for mobile validation across all frontends and backends.
  // Priority: globalConfigs.CORE_MOBILE_CONFIGS → MDMS → constants fallback.
  // On canonical tenant routes the validation rules belong to the route
  // tenant (falling back to its root tenant), not the deployment-wide
  // STATE_LEVEL_TENANT_ID.
  const routeTenant = window.__digitTenantContext;
  const stateId = routeTenant?.tenantId || window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const rootTenantId =
    routeTenant?.rootTenantId && routeTenant.rootTenantId !== stateId ? routeTenant.rootTenantId : null;
  const selectMobileValidation = (data) => {
    const list = data?.["common-masters"]?.MobileNumberValidation || [];
    const record =
      list.find((x) => x.default === true && x.isActive !== false) ||
      list.find((x) => x.isActive !== false) ||
      null;
    if (!record) return null;
    const gc = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS");
    return {
      prefix: record.countryCode,
      pattern: record.mobileNumberRegex,
      errorMessage: gc?.mobileNumberErrorMessage || "CORE_COMMON_MOBILE_ERROR",
    };
  };
  const { data: routeValidationConfig } = Digit.Hooks.useCustomMDMS(
    stateId,
    "common-masters",
    [{ name: "MobileNumberValidation" }],
    { select: selectMobileValidation, staleTime: 300000, enabled: !!stateId }
  );
  const { data: rootValidationConfig } = Digit.Hooks.useCustomMDMS(
    rootTenantId,
    "common-masters",
    [{ name: "MobileNumberValidation" }],
    { select: selectMobileValidation, staleTime: 300000, enabled: !!rootTenantId }
  );
  const mdmsValidationConfig = routeValidationConfig || rootValidationConfig;

  // Priority: MDMS common-masters.MobileNumberValidation → globalConfigs.CORE_MOBILE_CONFIGS → constants fallback.
  const globalCfg = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS");
  const validationConfig = {
    countryCode: mdmsValidationConfig?.prefix || globalCfg?.countryCode,
    prefix: mdmsValidationConfig?.prefix || globalCfg?.countryCode,
    pattern: mdmsValidationConfig?.pattern || globalCfg?.mobileNumberRegex,
    errorMessage: mdmsValidationConfig?.errorMessage,
  };

  return validationConfig;
};
