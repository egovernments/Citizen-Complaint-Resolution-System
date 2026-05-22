/* eslint-disable react/prop-types */
// Employee login — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the FormComposerV2-driven login form.
// Same data flow and side-effects:
//   - `Digit.UserService.authenticate(...)` for password mode,
//   - `useCustomAPIMutationHook` POSTing to /user-otp/v1/_send for the
//     OTP-based mode (route still `/employee/user/login` then forwarded
//     to `/employee/user/login/otp`),
//   - `setEmployeeDetail` localStorage stamping,
//   - the `from=` query-string redirect for deep-linked entry,
//   - the role-based redirects to NURT_DASHBOARD / dss/landing.
//
// The chrome itself moves to a calm centred v2 card with theme-aware
// inputs / select / yellow primary CTA + secondary "Forgot password"
// link. The carousel-flanked layout is preserved when the configured
// MDMS bannerImages are present; otherwise the card sits on the plain
// Background like the legacy fallback.

import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useHistory } from "react-router-dom";
import { Loader, Toast } from "@egovernments/digit-ui-components";
import {
  Button as V2Button,
  Card as V2Card,
  Field as V2Field,
  Input as V2Input,
  Select as V2Select,
} from "@egovernments/digit-ui-components-v2";
import { Eye, EyeOff } from "lucide-react";

import Background from "../../../components/Background";
import Header from "../../../components/Header";
import Carousel from "./Carousel/Carousel";
import ImageComponent from "../../../components/ImageComponent";

const setEmployeeDetail = (userObject, token) => {
  if (Digit.Utils.getMultiRootTenant() && process.env.NODE_ENV !== "development") return;
  let locale = JSON.parse(sessionStorage.getItem("Digit.locale"))?.value || Digit.Utils.getDefaultLanguage();
  localStorage.setItem("Employee.tenant-id", userObject?.tenantId);
  localStorage.setItem("tenant-id", userObject?.tenantId);
  localStorage.setItem("citizen.userRequestObject", JSON.stringify(userObject));
  localStorage.setItem("locale", locale);
  localStorage.setItem("Employee.locale", locale);
  localStorage.setItem("token", token);
  localStorage.setItem("Employee.token", token);
  localStorage.setItem("user-info", JSON.stringify(userObject));
  localStorage.setItem("Employee.user-info", JSON.stringify(userObject));
};

export function V2LoginShell({ children, withCarousel, bannerImages }) {
  if (withCarousel) {
    return (
      <div
        className="v2-scope"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.05fr) minmax(360px, 480px)",
          minHeight: "100vh",
          backgroundColor: "var(--color-page-bg, #f5f5f5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            color: "#ffffff",
            padding: "32px",
            overflow: "hidden",
          }}
        >
          <Carousel bannerImages={bannerImages} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <Background>
      <div
        className="v2-scope"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
        }}
      >
        {children}
      </div>
    </Background>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid }) {
  const [show, setShow] = useState(false);
  return (
    <div
      className={"v2-password-input-wrap" + (invalid ? " is-invalid" : "")}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        borderRadius: "0.375rem",
        border: invalid
          ? "1px solid var(--color-error, #d4351c)"
          : "1px solid var(--color-border, #d6d5d4)",
        background: "var(--v2-surface-color, var(--color-surface, #ffffff))",
        overflow: "hidden",
        transition: "border-color 0.15s ease-out",
      }}
    >
      <input
        id={id}
        className="v2-login-password-input"
        type={show ? "text" : "password"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete || "current-password"}
        style={{
          flex: 1,
          minWidth: 0,
          height: "44px",
          padding: "0 12px",
          border: 0,
          outline: "none",
          background: "transparent",
          fontSize: "1rem",
          color: "var(--color-text-primary, #0B0C0C)",
        }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="v2-password-toggle"
        style={{
          height: "44px",
          width: "44px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          color: "var(--color-text-secondary, #6B7280)",
          padding: 0,
        }}
      >
        {show ? <EyeOff style={{ height: "1rem", width: "1rem" }} /> : <Eye style={{ height: "1rem", width: "1rem" }} />}
      </button>
    </div>
  );
}

const Login = ({ config: propsConfig, t, isDisabled, loginOTPBased }) => {
  const { data: cities, isLoading } = Digit.Hooks.useTenants();
  const { data: storeData, isLoading: isStoreLoading } = Digit.Hooks.useStore.getInitData();
  const [user, setUser] = useState(null);
  const [showToast, setShowToast] = useState(null);
  const [disable, setDisable] = useState(false);
  const DynamicLoginComponent = Digit.ComponentRegistryService?.getComponent("DynamicLoginComponent");

  const history = useHistory();
  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  // City dropdown — derived from the live MDMS tenant list filtered by
  // `LOGIN_TENANT_ALLOWLIST` if the deployment configures one (matches
  // legacy `select:` literal in config.js).
  const cityField = useMemo(() => propsConfig?.inputs?.find((f) => f?.key === "city"), [propsConfig]);
  const cityOptions = useMemo(() => {
    const all = Array.isArray(cities) ? cities : [];
    const allow = window?.globalConfigs?.getConfig?.("LOGIN_TENANT_ALLOWLIST");
    const filtered = Array.isArray(allow) && allow.length > 0
      ? all.filter((tnt) => allow.includes(tnt.code))
      : all;
    return filtered.map((tnt) => ({
      value: tnt.code,
      label: tr(`TENANT_TENANTS_${Digit?.Utils?.locale?.getTransformedLocale?.(tnt.code) ?? tnt.code}`, tnt.name || tnt.code),
    }));
  }, [cities]);

  const defaultTenant = Digit.ULBService.getStateId();
  const defaultCityCode = useMemo(() => {
    if (!cityField) return undefined;
    if (cityOptions.length === 1) return cityOptions[0].value;
    return cityField?.populators?.defaultValue?.code;
  }, [cityField, cityOptions]);

  const [form, setForm] = useState({
    username: "",
    password: "",
    email: "",
    city: defaultCityCode,
    check: false,
  });
  useEffect(() => {
    if (defaultCityCode && form.city !== defaultCityCode) {
      setForm((prev) => ({ ...prev, city: defaultCityCode }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCityCode]);

  const set = (k) => (v) => setForm((prev) => ({ ...prev, [k]: v }));

  // Redirect after login
  useEffect(() => {
    if (!user) return;
    Digit.SessionStorage.set("citizen.userRequestObject", user);
    const filteredRoles = user?.info?.roles?.filter(
      (role) => role.tenantId === Digit.SessionStorage.get("Employee.tenantId")
    );
    if (user?.info?.roles?.length > 0) user.info.roles = filteredRoles;
    Digit.UserService.setUser(user);
    setEmployeeDetail(user?.info, user?.access_token);
    let redirectPath = `/${window?.contextPath}/employee`;
    if (window?.location?.href?.includes("from=")) {
      redirectPath =
        decodeURIComponent(window?.location?.href?.split("from=")?.[1]) ||
        `/${window?.contextPath}/employee`;
    }
    if (
      user?.info?.roles?.length > 0 &&
      user.info.roles.every((e) => e.code === "NATADMIN")
    ) {
      redirectPath = `/${window?.contextPath}/employee/dss/landing/NURT_DASHBOARD`;
    }
    if (
      user?.info?.roles?.length > 0 &&
      user.info.roles.every((e) => e.code === "STADMIN")
    ) {
      redirectPath = `/${window?.contextPath}/employee/dss/landing/home`;
    }
    history.replace(redirectPath);
  }, [user]);

  // Password-based login
  const onLoginPassword = async (e) => {
    e?.preventDefault?.();
    setDisable(true);
    const data = {
      username: form.username?.trim(),
      password: form.password?.trim(),
      tenantId: form.city || defaultTenant,
      userType: "EMPLOYEE",
    };
    try {
      const { UserRequest: info, ...tokens } = await Digit.UserService.authenticate(data);
      Digit.SessionStorage.set("Employee.tenantId", info?.tenantId);
      setUser({ info, ...tokens });
    } catch (err) {
      setShowToast(
        err?.response?.data?.error_description ||
          (err?.message === "ES_ERROR_USER_NOT_PERMITTED" && t("ES_ERROR_USER_NOT_PERMITTED")) ||
          t("INVALID_LOGIN_CREDENTIALS")
      );
      setTimeout(() => setShowToast(null), 5000);
    }
    setDisable(false);
  };

  // OTP-based login send-otp flow
  const reqCreate = {
    url: `/user-otp/v1/_send`,
    params: { tenantId: Digit?.ULBService?.getStateId() },
    body: {},
    config: { enable: false },
  };
  const mutation = Digit.Hooks.useCustomAPIMutationHook(reqCreate);

  const onLoginOtp = async (e) => {
    e?.preventDefault?.();
    setDisable(true);
    const inputEmail = form.email;
    await mutation.mutate(
      {
        body: {
          otp: {
            userName: inputEmail,
            type: "login",
            tenantId: Digit?.ULBService?.getStateId(),
            userType: "EMPLOYEE",
          },
        },
        config: { enable: true },
      },
      {
        onError: (error) => {
          setShowToast(
            error?.response?.data?.Errors?.[0]?.code
              ? `SANDBOX_RESEND_OTP${error.response.data.Errors[0].code}`
              : `SANDBOX_RESEND_OTP_ERROR`
          );
          setTimeout(() => setShowToast(null), 5000);
          setDisable(false);
        },
        onSuccess: () => {
          setDisable(false);
          history.push(`/${window?.contextPath}/employee/user/login/otp`, {
            state: { email: inputEmail, tenant: Digit?.ULBService?.getStateId() },
          });
        },
      }
    );
  };

  const onForgotPassword = () => history.push(`/${window?.contextPath}/employee/user/forgot-password`);

  if (isLoading || isStoreLoading) {
    return <Loader page={true} variant="PageLoader" />;
  }

  // Validation gate for the submit CTA.
  const canSubmit = (() => {
    if (loginOTPBased) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email || "");
      return emailOk && form.check && !disable && !isDisabled;
    }
    const fields = [form.username, form.password].every((v) => (v || "").trim().length > 0);
    const cityOk = cityField ? !!form.city : true;
    return fields && cityOk && form.check && !disable && !isDisabled;
  })();

  const headerKey = propsConfig?.texts?.header || "CORE_COMMON_LOGIN";
  const submitKey = propsConfig?.texts?.submitButtonLabel || "CORE_COMMON_LOGIN";

  return (
    <V2LoginShell withCarousel={!!propsConfig?.bannerImages} bannerImages={propsConfig?.bannerImages}>
      <V2Card
        style={{
          width: "100%",
          maxWidth: "680px",
          padding: "32px 32px 32px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        {/* Top logos — same Header the legacy login.js renders inline,
            so the tenant + DIGIT secondary wordmark show above the form
            exactly like v1. */}
        <div className="v2-employee-login-top-logos" style={{ display: "flex", justifyContent: "center" }}>
          {storeData?.stateInfo?.code ? <Header /> : <Header showTenant={false} />}
        </div>
        <header>
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
            {tr(headerKey, "Login")}
          </h1>
        </header>

        <form
          onSubmit={loginOTPBased ? onLoginOtp : onLoginPassword}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          {loginOTPBased ? (
            <V2Field label={tr("CORE_SIGNUP_EMAILID", "Email")} required htmlFor="emp-email">
              <V2Input
                id="emp-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
              />
            </V2Field>
          ) : (
            <>
              <V2Field label={tr("CORE_LOGIN_USERNAME", "Username")} required htmlFor="emp-username">
                <V2Input
                  id="emp-username"
                  type="text"
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => set("username")(e.target.value)}
                />
              </V2Field>
              <V2Field label={tr("CORE_LOGIN_PASSWORD", "Password")} required htmlFor="emp-password">
                <PasswordInput
                  id="emp-password"
                  value={form.password}
                  onChange={set("password")}
                  autoComplete="current-password"
                />
              </V2Field>
              {cityField ? (
                <V2Field
                  label={tr(cityField.label || "CORE_COMMON_CITY", "City")}
                  required={!!cityField.isMandatory}
                  htmlFor="emp-city"
                >
                  <V2Select
                    id="emp-city"
                    value={form.city}
                    onValueChange={set("city")}
                    options={cityOptions}
                    placeholder={tr("CORE_COMMON_SELECT_CITY", "Select city")}
                  />
                </V2Field>
              ) : null}
            </>
          )}

          {/* Legacy PrivacyComponent — keeps the v1 affordance: a
              checkbox PLUS an inline "Privacy Policy" link that opens
              the full MDMS-driven policy modal (PopUp). It manages its
              own checked state and reports it back to us via
              `onSelect("check", checked)`. */}
          {(() => {
            const Privacy = Digit.ComponentRegistryService?.getComponent("PrivacyComponent");
            if (!Privacy) return null;
            return (
              <Privacy
                onSelect={(_key, checked) => set("check")(checked)}
                props={{ module: loginOTPBased ? "Sandbox" : "HCM" }}
              />
            );
          })()}

          <V2Button type="submit" disabled={!canSubmit} loading={disable} width="full">
            {tr(submitKey, loginOTPBased ? "Continue" : "Login")}
          </V2Button>

          {!loginOTPBased ? (
            <button
              type="button"
              onClick={onForgotPassword}
              className="v2-forgot-pw"
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color:
                  "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                fontWeight: 600,
                fontSize: "0.8125rem",
                alignSelf: "center",
              }}
            >
              {tr(
                propsConfig?.texts?.secondaryButtonLabel || "CORE_COMMON_FORGOT_PASSWORD",
                "Forgot password?"
              )}
            </button>
          ) : null}
        </form>

        {DynamicLoginComponent ? <DynamicLoginComponent /> : null}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: "8px",
            borderTop: "1px solid var(--color-border, #e5e7eb)",
            marginTop: "4px",
          }}
        >
          <ImageComponent
            alt="Powered by DIGIT"
            // Use the colour variant (DIGIT_FOOTER) — DIGIT_FOOTER_BW is
            // a white wordmark tuned for the dark navy of the legacy
            // login banner; on the white v2 card it becomes invisible.
            src={
              window?.globalConfigs?.getConfig?.("DIGIT_FOOTER") ||
              window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")
            }
            style={{ cursor: "pointer", height: "1em", maxHeight: "16px", width: "auto", opacity: 0.85 }}
            onClick={() => {
              window
                .open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank")
                ?.focus();
            }}
          />
        </div>
      </V2Card>
      {showToast ? (
        <Toast type="error" label={t(showToast)} onClose={() => setShowToast(null)} />
      ) : null}
    </V2LoginShell>
  );
};

Login.propTypes = {
  loginParams: PropTypes.any,
};

Login.defaultProps = {
  loginParams: null,
};

export default Login;
