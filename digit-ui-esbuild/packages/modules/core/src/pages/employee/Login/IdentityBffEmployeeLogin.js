import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader } from "@egovernments/digit-ui-components";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";

import {
  buildIdentityBffAuthorizeUrl,
  establishIdentityBffSession,
  identityBffSurfaceBase,
  restrictIdentityBffDestination,
} from "@egovernments/digit-ui-libraries";

import Header from "../../../components/Header";
import { setEmployeeDetail, V2LoginShell } from "./login";

const cleanAuthResult = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("authResult");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

/**
 * Employee sign-in on canonical tenant routes. The Identity BFF sends the
 * browser to the `digit-ui-employee` Keycloak client, whose theme looks like
 * the legacy DIGIT login, so a signed-out visitor is redirected straight
 * there. This card is only shown for failures, a 403 on the route tenant, or
 * after an unsuccessful round trip (to avoid redirect loops).
 */
const IdentityBffEmployeeLogin = ({ t }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const tenant = window.__digitTenantContext;
  const employeeBase = identityBffSurfaceBase(tenant, "employee");
  const destination = restrictIdentityBffDestination(
    location.state?.from || new URLSearchParams(location.search).get("from"),
    employeeBase,
  );
  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const beginSignIn = () => {
    window.location.assign(
      buildIdentityBffAuthorizeUrl({
        surface: "employee",
        tenant,
        pathname: window.location.pathname,
        destination,
      }),
    );
  };

  const establishTenantSession = async () => {
    setStatus("checking");
    setMessage("");

    const authResultId = new URLSearchParams(window.location.search).get("authResult");
    if (authResultId) cleanAuthResult();
    const result = await establishIdentityBffSession({
      surface: "employee",
      tenant,
      authResultId,
      fetchImpl: window.fetch.bind(window),
    });

    if (result.status === "signed-out" && !result.fromAuthResult && !result.messageKey) {
      beginSignIn();
      return;
    }
    if (result.status !== "authenticated") {
      setStatus(result.status);
      setMessage(result.messageKey ? tr(result.messageKey, result.message) : "");
      return;
    }

    const { user } = result;
    const { info, ...tokens } = user;
    Digit.SessionStorage.set("Employee.tenantId", tenant.tenantId);
    Digit.SessionStorage.set("citizen.userRequestObject", user);
    Digit.UserService.setType("employee");
    Digit.UserService.setUser(user);
    setEmployeeDetail(info, tokens.access_token);
    window.location.replace(`${window.location.origin}${destination}`);
  };

  useEffect(() => {
    establishTenantSession().catch(() => {
      setStatus("error");
      setMessage(tr("CORE_IDENTITY_SIGNIN_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again."));
    });
    // Tenant context is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "checking") return <Loader page={true} variant="PageLoader" />;

  return (
    <V2LoginShell>
      <V2Card
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          borderRadius: "14px",
          border: "none",
          boxShadow: "0 12px 32px rgba(8, 20, 40, 0.18), 0 2px 8px rgba(8, 20, 40, 0.10)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Header />
        </div>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem", color: "var(--color-text-heading, #1D2433)" }}>
            {tr("CORE_COMMON_LOGIN", "Sign in")}
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-secondary, #505A5F)" }}>
            {tenant.name}
          </p>
        </header>
        {message ? (
          <div role="alert" style={{ color: "var(--color-error, #d4351c)", lineHeight: 1.45 }}>
            {message}
          </div>
        ) : null}
        {status === "forbidden" ? (
          <p style={{ margin: 0, color: "var(--color-text-secondary, #505A5F)" }}>
            {tr("CORE_IDENTITY_SIGN_OUT_HINT", "Sign out if you need to use a different account.")}
          </p>
        ) : null}
        <V2Button
          type="button"
          width="full"
          onClick={
            status === "forbidden"
              ? Digit.UserService.logout
              : status === "error"
                ? establishTenantSession
                : beginSignIn
          }
        >
          {status === "forbidden"
            ? tr("CORE_IDENTITY_SIGN_OUT", "Sign out")
            : status === "error"
              ? tr("CORE_IDENTITY_TRY_AGAIN", "Try again")
              : tr("CORE_IDENTITY_SIGN_IN", "Sign in →")}
        </V2Button>
      </V2Card>
    </V2LoginShell>
  );
};

export default IdentityBffEmployeeLogin;
