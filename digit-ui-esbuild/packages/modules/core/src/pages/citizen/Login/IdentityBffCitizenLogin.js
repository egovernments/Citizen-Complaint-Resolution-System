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

import { setCitizenDetail } from "./index";
import { V2LoginShell } from "./SelectMobileNumber";

const cleanAuthResult = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("authResult");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

/**
 * Citizen sign-in on canonical tenant routes. Sign-in happens inside the
 * `digit-ui-citizen` Keycloak client (themed like the legacy citizen login;
 * which methods it offers is open, #2189); this adapter only exchanges the
 * resulting BFF session for a DIGIT CITIZEN token (issued at the route tenant's root) bound to the route
 * tenant. Signed-out visitors are sent straight to Keycloak; the card below
 * only renders for failures.
 */
const IdentityBffCitizenLogin = ({ t }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const tenant = window.__digitTenantContext;
  const citizenBase = identityBffSurfaceBase(tenant, "citizen");
  const destination = restrictIdentityBffDestination(
    location.state?.from || new URLSearchParams(location.search).get("from"),
    citizenBase,
  );
  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const beginSignIn = () => {
    window.location.assign(
      buildIdentityBffAuthorizeUrl({
        surface: "citizen",
        tenant,
        pathname: window.location.pathname,
        destination,
      }),
    );
  };

  const establishCitizenSession = async () => {
    setStatus("checking");
    setMessage("");

    const authResultId = new URLSearchParams(window.location.search).get("authResult");
    if (authResultId) cleanAuthResult();
    const result = await establishIdentityBffSession({
      surface: "citizen",
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

    // `user.info.tenantId` is the root the DIGIT citizen account lives at
    // (as with the legacy OTP login); the stored citizen tenant is the route
    // tenant, so complaints and other business requests stay on this URL's
    // tenant.
    const { user } = result;
    Digit.SessionStorage.set("citizen.userRequestObject", user);
    Digit.UserService.setType("citizen");
    Digit.UserService.setUser(user);
    setCitizenDetail(user.info, user.access_token, tenant.tenantId);
    window.location.replace(`${window.location.origin}${destination}`);
  };

  useEffect(() => {
    establishCitizenSession().catch(() => {
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
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              lineHeight: 1.2,
            }}
          >
            {tr("CORE_COMMON_LOGIN", "Sign in")}
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)" }}>
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
                ? establishCitizenSession
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

export default IdentityBffCitizenLogin;
