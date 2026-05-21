/* eslint-disable react/prop-types */
// Citizen "Provide your mobile number" — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the legacy InputCard / FieldV1 markup.
// Same parent contract: `onSelect({ mobileNumber })` continues the
// login flow (sendOtp + history.push to /otp). The MDMS-driven
// `validationConfig` (Kenyan pattern + prefix on naipepea) is read
// exactly the same way.
//
// What changes is just the chrome — a centered v2 Card with a brand
// title, prefix-aware mobile input, contextual help text, and a yellow
// primary CTA (Continue). Email login is intentionally not exposed
// here — Naipepea's flow is mobile-OTP only (CCRS#495).

import React, { useMemo, useState } from "react";
import {
  DEFAULT_MOBILE_MAX_LENGTH,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";
import {
  Button as V2Button,
  Card as V2Card,
  Field as V2Field,
} from "@egovernments/digit-ui-components-v2";
import { Phone } from "lucide-react";

const SelectMobileNumber = ({
  t,
  onSelect,
  mobileNumber,
  onMobileChange,
  config,
  canSubmit,
  validationConfig,
  showRegisterLink,
}) => {
  const [error, setError] = useState("");

  const rawPattern = validationConfig?.pattern || DEFAULT_MOBILE_PATTERN;
  const mobileNumberPattern = useMemo(() => new RegExp(rawPattern), [rawPattern]);
  const maxLength = validationConfig?.maxLength || DEFAULT_MOBILE_MAX_LENGTH;
  const prefix = validationConfig?.prefix || DEFAULT_MOBILE_PREFIX;
  const mobileErrorKey = validationConfig?.errorMessage || "ERR_INVALID_MOBILE_NUMBER";

  const isMobileValid = useMemo(
    () => mobileNumberPattern.test(mobileNumber || ""),
    [mobileNumber, mobileNumberPattern]
  );

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!isMobileValid) {
      setError(t(mobileErrorKey));
      return;
    }
    onSelect({ mobileNumber });
  };

  const handleChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, maxLength);
    setError("");
    onMobileChange({ target: { value } });
    if (value && !mobileNumberPattern.test(value)) setError(t(mobileErrorKey));
  };

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  const headerText = config?.texts?.header
    ? tr(config.texts.header, "Sign in")
    : "Sign in";
  const cardText = config?.texts?.cardText
    ? tr(config.texts.cardText, "We'll send you a one-time password to verify your number.")
    : null;

  return (
    <V2LoginShell>
      <V2Card
        style={{
          width: "100%",
          maxWidth: "440px",
          padding: "32px 28px 28px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              color:
                "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              lineHeight: 1.2,
            }}
          >
            {headerText}
          </h1>
          {cardText ? (
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                color: "var(--color-text-secondary, #6B7280)",
                lineHeight: 1.5,
              }}
            >
              {cardText}
            </p>
          ) : null}
        </header>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <V2Field
            label={tr("CORE_COMMON_MOBILE_NUMBER", "Mobile number")}
            required
            htmlFor="login-mobile"
            error={error || undefined}
            hint={
              !error
                ? tr("CS_MOBILE_NUMBER_HELP", `Enter your ${maxLength}-digit mobile number`)
                : undefined
            }
          >
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                width: "100%",
                borderRadius: "0.375rem",
                border: error
                  ? "1px solid var(--color-error, #d4351c)"
                  : "1px solid var(--color-border, #d6d5d4)",
                background:
                  "var(--v2-surface-color, var(--color-surface, #ffffff))",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "0 12px",
                  borderRight: "1px solid var(--color-border, #d6d5d4)",
                  // Light-yellow theme tint instead of neutral grey — same
                  // `--color-primary-selected-bg` token sidebar rows /
                  // dropdown options use, so the prefix visually links
                  // back to the rest of the modernized chrome.
                  backgroundColor:
                    "var(--color-primary-selected-bg, #FFF4D7)",
                  color:
                    "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <Phone style={{ height: "0.95rem", width: "0.95rem" }} aria-hidden />
                {prefix}
              </span>
              <input
                id="login-mobile"
                className="v2-login-phone-input"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
                value={mobileNumber || ""}
                onChange={handleChange}
                maxLength={maxLength}
                aria-invalid={!!error}
                style={{
                  flex: 1,
                  border: 0,
                  outline: "none",
                  padding: "0 12px",
                  fontSize: "1rem",
                  background: "transparent",
                  color: "var(--color-text-primary, #0B0C0C)",
                  minWidth: 0,
                  height: "44px",
                }}
              />
            </div>
          </V2Field>

          <V2Button
            type="submit"
            disabled={!isMobileValid || !canSubmit}
            width="full"
          >
            {tr(config?.texts?.nextText || "CS_COMMONS_NEXT", "Continue")}
          </V2Button>
        </form>

      </V2Card>
    </V2LoginShell>
  );
};

/**
 * Centered full-viewport shell. Used by SelectMobileNumber, SelectOtp,
 * and SelectName so every step shares the same visual container —
 * subtle page bg, brand-tinted card, one-column rhythm.
 */
export function V2LoginShell({ children }) {
  return (
    <div
      className="v2-scope"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight:
          "calc(100vh - var(--v2-topbar-height, 82px) - var(--v2-page-footer-height, 38px))",
        padding: "1.5rem",
        backgroundColor: "transparent",
      }}
    >
      {children}
    </div>
  );
}

export default SelectMobileNumber;
