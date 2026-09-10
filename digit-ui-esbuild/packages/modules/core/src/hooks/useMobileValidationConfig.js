import { DEFAULT_MOBILE_PATTERN, DEFAULT_MOBILE_PREFIX } from "@egovernments/digit-ui-libraries";

// Mobile-number validation config for the login-side screens, resolved with the
// same priority the citizen login uses (Login/index.js): MDMS
// common-masters.MobileNumberValidation → globalConfigs.CORE_MOBILE_CONFIGS →
// library defaults. Shared so the employee forgot-password / change-password
// pages send the SAME countryCode the citizen flow does instead of hardcoding
// one — the OTP gateway needs a routable prefix, and the deployment decides it.
//
// The MDMS hook is always called with the same v1 signature so the hook order
// never changes between renders (see useCustomMDMS notes).
export const useMobileValidationConfig = () => {
  const stateId = window?.globalConfigs?.getConfig?.("STATE_LEVEL_TENANT_ID");
  const { data: mdms } = Digit.Hooks.useCustomMDMS(
    stateId,
    "common-masters",
    [{ name: "MobileNumberValidation" }],
    {
      select: (data) => {
        const list = data?.["common-masters"]?.MobileNumberValidation || [];
        const record =
          list.find((x) => x.default === true && x.isActive !== false) ||
          list.find((x) => x.isActive !== false) ||
          null;
        return record ? { countryCode: record.countryCode, pattern: record.mobileNumberRegex } : null;
      },
      staleTime: 300000,
      enabled: !!stateId,
    }
  );
  const globalCfg = window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS");
  return {
    countryCode: mdms?.countryCode || globalCfg?.countryCode || DEFAULT_MOBILE_PREFIX,
    pattern: mdms?.pattern || globalCfg?.mobileNumberRegex || DEFAULT_MOBILE_PATTERN,
  };
};

export default useMobileValidationConfig;
