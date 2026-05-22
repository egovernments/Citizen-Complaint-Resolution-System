/* eslint-disable react/prop-types */
// Citizen "Enter the OTP" — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for FormStep + OTPInput. Same parent
// contract: `onOtpChange(otp)` / `onSelect()` / `onResend()`. The 6-box
// OTP input is rendered inline with auto-advance + paste support so it
// feels modern but doesn't depend on the legacy <OTPInput> component.

import React, { Fragment, useEffect, useRef, useState } from "react";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";
import useInterval from "../../../hooks/useInterval";
import { V2LoginShell } from "./SelectMobileNumber";

const OTP_LENGTH = 6;

function OtpBoxes({ value = "", onChange, hasError }) {
  const inputs = useRef([]);
  const chars = (value || "").split("").concat(new Array(OTP_LENGTH).fill("")).slice(0, OTP_LENGTH);

  const handleInput = (i, e) => {
    const v = e.target.value.replace(/\D/g, "").slice(-1);
    const next = chars.slice();
    next[i] = v;
    const joined = next.join("").slice(0, OTP_LENGTH);
    onChange(joined);
    if (v && i < OTP_LENGTH - 1) inputs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !chars[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      inputs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < OTP_LENGTH - 1) {
      inputs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const txt = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!txt) return;
    e.preventDefault();
    onChange(txt);
    const lastIdx = Math.min(txt.length, OTP_LENGTH) - 1;
    inputs.current[lastIdx]?.focus();
  };

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label="One-time password"
      onPaste={handlePaste}
      style={{
        display: "grid",
        // Equal-width boxes that fit the available container width.
        // 6 columns of 1fr each + 8px gap means: each box = (W - 40)/6
        // where W is the form column width. On a 343px content area
        // (375px viewport, 32px card padding) each box is ~50px tall
        // and ~50px wide; on wider cards they grow gracefully without
        // overflowing. Replaces the legacy fixed `width: 44px` which
        // overflowed by ~27px on a 375px phone.
        gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
        gap: "8px",
        width: "100%",
      }}
    >
      {Array.from({ length: OTP_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          className="v2-otp-box"
          type="tel"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={chars[i]}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-invalid={hasError || undefined}
          style={{
            width: "100%",
            minWidth: 0,
            height: "52px",
            padding: 0,
            textAlign: "center",
            fontSize: "1.25rem",
            fontWeight: 600,
            border: hasError
              ? "1.5px solid var(--color-error, #d4351c)"
              : "1px solid var(--color-border, #d6d5d4)",
            borderRadius: "0.375rem",
            outline: "none",
            color: "var(--color-text-primary, #0B0C0C)",
            backgroundColor:
              "var(--v2-surface-color, var(--color-surface, #ffffff))",
            transition: "border-color 0.15s ease-out, box-shadow 0.15s ease-out",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor =
              "var(--color-primary-1, var(--color-primary-main, #c84c0e))";
            e.currentTarget.style.boxShadow =
              "0 0 0 3px var(--color-primary-selected-bg, #FFF4D7)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = hasError
              ? "var(--color-error, #d4351c)"
              : "var(--color-border, #d6d5d4)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      ))}
    </div>
  );
}

const SelectOtp = ({
  config,
  otp,
  onOtpChange,
  onResend,
  onSelect,
  t,
  error,
  userType = "citizen",
  canSubmit,
}) => {
  const [timeLeft, setTimeLeft] = useState(30);

  useInterval(
    () => {
      setTimeLeft(timeLeft - 1);
    },
    timeLeft > 0 ? 1000 : null
  );

  const handleResendOtp = () => {
    onResend();
    setTimeLeft(30);
  };

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  // Employee branch keeps the legacy contract — embedded inside an
  // existing form. Render the OTP boxes inline with no shell.
  if (userType === "employee") {
    return (
      <Fragment>
        <OtpBoxes value={otp} onChange={onOtpChange} hasError={!error} />
        {timeLeft > 0 ? (
          <p style={{ marginTop: "12px", fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)" }}>
            {`${t("CS_RESEND_ANOTHER_OTP")} ${timeLeft} ${t("CS_RESEND_SECONDS")}`}
          </p>
        ) : (
          <p
            onClick={handleResendOtp}
            style={{
              cursor: "pointer",
              marginTop: "12px",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            }}
          >
            {t("CS_RESEND_OTP")}
          </p>
        )}
        {!error ? (
          <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--color-error, #d4351c)" }}>
            {t("CS_INVALID_OTP")}
          </p>
        ) : null}
      </Fragment>
    );
  }

  const headerText = config?.texts?.header
    ? tr(config.texts.header, "Verify your number")
    : "Verify your number";
  const cardText = config?.texts?.cardText
    ? tr(config.texts.cardText, "Enter the 6-digit code we just sent.")
    : null;

  const isReady = otp?.length === OTP_LENGTH && canSubmit;

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
          onSubmit={(e) => {
            e.preventDefault();
            if (isReady) onSelect();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <OtpBoxes value={otp} onChange={onOtpChange} hasError={!error} />
          {!error ? (
            <p
              role="alert"
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-error, #d4351c)",
              }}
            >
              {tr("CS_INVALID_OTP", "The OTP you entered is invalid.")}
            </p>
          ) : null}
          <V2Button type="submit" disabled={!isReady} width="full">
            {tr(config?.texts?.nextText || "CS_COMMONS_NEXT", "Continue")}
          </V2Button>
        </form>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary, #6B7280)",
          }}
        >
          {timeLeft > 0 ? (
            <span>
              {tr("CS_RESEND_ANOTHER_OTP", "Resend OTP in")} {timeLeft}
              {t("CS_RESEND_SECONDS") === "CS_RESEND_SECONDS" ? "s" : ` ${t("CS_RESEND_SECONDS")}`}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResendOtp}
              className="v2-resend-otp"
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color:
                  "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
            >
              {tr("CS_RESEND_OTP", "Resend OTP")}
            </button>
          )}
        </div>
      </V2Card>
    </V2LoginShell>
  );
};

export default SelectOtp;
