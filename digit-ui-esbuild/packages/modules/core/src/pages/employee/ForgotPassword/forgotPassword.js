// V2-modernized Forgot Password page (employee).
//
// Replaces the FormComposerV2 + Background scaffolding with the same
// V2LoginShell the login page uses — carousel-on-left when bannerImages
// are configured, single centered card otherwise. Form chrome is raw
// v2 (Card / Field / Input / Select / Button) so it picks up the
// unified input rule + brand CTA without going through the legacy
// vendor wrappers.
//
// Submit logic is unchanged: hits `Digit.UserService.sendOtp` with
// `type: "passwordreset"` and pushes to /change-password on success;
// inline error stays on the form when the username/city combo doesn't
// resolve to a real account.

import { Loader, Toast } from "@egovernments/digit-ui-components";
import {
  Button as V2Button,
  Card as V2Card,
  Field as V2Field,
  Input as V2Input,
  Select as V2Select,
} from "@egovernments/digit-ui-components-v2";
import PropTypes from "prop-types";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation } from "react-router-dom";
import ImageComponent from "../../../components/ImageComponent";
import { useLoginConfig } from "../../../hooks/useLoginConfig";
import { V2LoginShell } from "../Login/login";

const ForgotPassword = ({ config: propsConfig, t, stateCode }) => {
  const { t: trans } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const { data: cities, isLoading } = Digit.Hooks.useTenants();
  const { data: mdmsData } = useLoginConfig(stateCode);

  const [user, setUser] = useState(null);
  const [username, setUsername] = useState("");
  const [city, setCity] = useState(null);
  const [showToast, setShowToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (mdmsData?.config) {
    const bannerImages = mdmsData?.config[0]?.bannerImages;
    propsConfig.bannerImages = bannerImages;
  }

  const tr = (key, fallback) => {
    const v = trans(key);
    return v === key ? fallback : v;
  };

  useEffect(() => {
    if (!user) {
      Digit.UserService.setType("employee");
      return;
    }
    Digit.UserService.setUser(user);
    const redirectPath = location.state?.from || `/${window?.contextPath}/employee`;
    history.replace(redirectPath);
    // setUser is preserved from the legacy effect for parity with the
    // OTP flow even though this page doesn't currently set it.
  }, [user]);

  const closeToast = () => setShowToast(null);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (!username?.trim()) {
      setShowToast(tr("ERR_HRMS_INVALID_USERNAME", "Please enter your username."));
      setTimeout(closeToast, 5000);
      return;
    }
    if (!city) {
      setShowToast(tr("ERR_HRMS_INVALID_CITY", "Please select a city."));
      setTimeout(closeToast, 5000);
      return;
    }
    setSubmitting(true);
    const requestData = {
      otp: {
        userName: username.trim(),
        userType: (Digit.UserService.getType() || "employee").toUpperCase(),
        type: "passwordreset",
        tenantId: city.code,
      },
    };
    try {
      await Digit.UserService.sendOtp(requestData, city.code);
      history.push(
        `/${window?.contextPath}/employee/user/change-password?USERNAME=${encodeURIComponent(
          username.trim()
        )}&tenantId=${encodeURIComponent(city.code)}`
      );
    } catch (err) {
      setSubmitting(false);
      setShowToast(
        err?.response?.data?.error?.fields?.[0]?.message ||
          tr("CORE_FORGOT_PASSWORD_FAILED", "Couldn't reach that account.")
      );
      setTimeout(closeToast, 5000);
    }
  };

  const navigateToLogin = () => {
    history.replace(`/${window?.contextPath}/employee/login`);
  };

  if (isLoading) {
    return <Loader page={true} variant="PageLoader" />;
  }

  const cityOptions = (cities || []).map((c) => ({
    value: c.code,
    label: c.i18nKey ? trans(c.i18nKey) : c.code,
  }));

  return (
    <V2LoginShell
      withCarousel={!!propsConfig?.bannerImages}
      bannerImages={propsConfig?.bannerImages}
    >
      <V2Card
        className="p-6"
        style={{ width: "100%", maxWidth: "440px" }}
      >
        <div style={{ marginBottom: "1.25rem" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            }}
          >
            {tr(propsConfig?.texts?.header, "Forgot password?")}
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--color-text-secondary, #6B7280)",
            }}
          >
            {tr(
              propsConfig?.texts?.description,
              "Enter your username and city. We'll send a one-time code to reset your password."
            )}
          </p>
        </div>

        <form onSubmit={onSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <V2Field
              label={tr("USERNAME", "Username")}
              required
              htmlFor="forgot-username"
            >
              <V2Input
                id="forgot-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={tr(
                  "CORE_FORGOT_USERNAME_PLACEHOLDER",
                  "Your work username"
                )}
                autoComplete="username"
              />
            </V2Field>

            <V2Field
              label={tr("CORE_COMMON_CITY", "City")}
              required
              htmlFor="forgot-city"
            >
              <V2Select
                id="forgot-city"
                value={city?.code}
                onValueChange={(code) => {
                  const picked = (cities || []).find((c) => c.code === code);
                  if (picked) setCity(picked);
                }}
                options={cityOptions}
                placeholder={tr("CORE_COMMON_SELECT_CITY", "Select a city")}
              />
            </V2Field>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              <V2Button type="submit" width="full" loading={submitting} disabled={submitting}>
                {tr(propsConfig?.texts?.submitButtonLabel, "Continue")}
              </V2Button>
              <V2Button
                type="button"
                variant="ghost"
                width="full"
                onClick={navigateToLogin}
              >
                {tr("CORE_COMMON_BACK_TO_LOGIN", "Back to login")}
              </V2Button>
            </div>
          </div>
        </form>
      </V2Card>

      <div
        className="EmployeeLoginFooter v2-scope"
        style={{
          position: "absolute",
          bottom: 16,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <ImageComponent
          alt="Powered by DIGIT"
          src={window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")}
          style={{ cursor: "pointer", pointerEvents: "auto" }}
          onClick={() => {
            window
              .open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank")
              .focus();
          }}
        />
      </div>

      {showToast ? (
        <Toast type="error" label={showToast} onClose={closeToast} />
      ) : null}
    </V2LoginShell>
  );
};

ForgotPassword.propTypes = {
  loginParams: PropTypes.any,
};

ForgotPassword.defaultProps = {
  loginParams: null,
};

export default ForgotPassword;
