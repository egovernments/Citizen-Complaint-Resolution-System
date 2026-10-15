/**
 * The country code shown in front of a phone number (ours #1929).
 *
 * The phone atoms printed a fixed "+91", so a Kenyan tenant (254) showed its staff numbers as Indian ones on the
 * citizen's complaint timeline. The code now comes from the tenant, in the order the mobile inputs already use:
 *   1. MDMS common-masters.MobileNumberValidation, as resolved by useMobileValidation (window.__DIGIT_USER_VALIDATION)
 *   2. globalConfigs CORE_MOBILE_CONFIGS.countryCode (set per deployment)
 *   3. "+91", the stock default (libraries constants/mobileValidation DEFAULT_MOBILE_PREFIX)
 * A copy of this file lives in packages/react-components/src/atoms/mobilePrefix.js (the two packages share no code).
 */
export const mobilePrefix = () => {
  const w = typeof window !== "undefined" ? window : {};
  const code = w?.__DIGIT_USER_VALIDATION?.mobile?.countryCode || w?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS")?.countryCode;
  if (!code) return "+91";
  const s = String(code).trim();
  return s.startsWith("+") ? s : `+${s}`;
};

/** The number as dialled and shown: prefix + national number (one trunk "0" dropped); a number already in +form as is. */
export const phoneParts = (mobile) => {
  const raw = String(mobile ?? "").trim();
  if (!raw) return { prefix: "", number: "", dial: "" };
  if (raw.startsWith("+")) return { prefix: "", number: raw, dial: raw.replace(/[^\d+]/g, "") };
  const prefix = mobilePrefix();
  const number = raw.replace(/^0(?=\d)/, "");
  return { prefix, number, dial: `${prefix}${number.replace(/\D/g, "")}` };
};
