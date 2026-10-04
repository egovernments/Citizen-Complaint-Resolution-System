import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";
import {
  buildIdentityBffAuthorizeUrl,
  establishIdentityBffSession,
  identityBffSurfaceBase,
  restrictIdentityBffDestination,
  IdentityAccount,
} from "@egovernments/digit-ui-libraries";

import Header from "./Header";

const cleanAuthResult = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("authResult");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

/**
 * Sign-in on canonical tenant routes (`/{slug}/digit-ui/{surface}/...`),
 * shared by the employee and citizen login pages. On mount it exchanges the
 * Identity BFF session for the surface's DIGIT token bound to the route
 * tenant. A signed-out visitor goes to `onSignedOut` (default: the surface's
 * Keycloak client); a failure, a 403 on the route tenant, or an unsuccessful
 * round trip (no redirect loop) leaves `status` for SignInFailureCard.
 *
 * `onAuthenticated(user, tenant)` stores the session the surface's way;
 * the page then goes to the requested same-tenant destination.
 */
export const useIdentityBffSignIn = ({ surface, t, onAuthenticated, onSignedOut }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState(null);
  const tenant = window.__digitTenantContext;
  const destination = restrictIdentityBffDestination(
    location.state?.from || new URLSearchParams(location.search).get("from"),
    identityBffSurfaceBase(tenant, surface),
  );
  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const unavailable = () => tr("CORE_IDENTITY_SIGNIN_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.");

  const beginSignIn = () => {
    window.location.assign(
      buildIdentityBffAuthorizeUrl({ surface, tenant, pathname: window.location.pathname, destination }),
    );
  };

  const complete = (user) => {
    onAuthenticated(user, tenant);
    window.location.replace(`${window.location.origin}${destination}`);
  };

  const establishSession = async () => {
    setStatus("checking");
    setMessage("");

    const authResultId = new URLSearchParams(window.location.search).get("authResult");
    if (authResultId) cleanAuthResult();
    const result = await establishIdentityBffSession({
      surface,
      tenant,
      authResultId,
      fetchImpl: window.fetch.bind(window),
    });

    if (result.status === "signed-out" && !result.fromAuthResult && !result.messageKey) {
      await (onSignedOut || beginSignIn)();
      return;
    }
    if (result.status !== "authenticated") {
      setInvitation(result.invitation || null);
      setStatus(result.status);
      setMessage(result.messageKey ? tr(result.messageKey, result.message) : "");
      return;
    }
    complete(result.user);
  };

  // A rejected step shows the unavailable message rather than nothing.
  const retry = (step) =>
    Promise.resolve()
      .then(step)
      .catch(() => {
        setStatus("error");
        setMessage(unavailable());
      });

  const acceptInvitation = () => retry(async () => {
    setStatus("checking");
    try {
      await IdentityAccount.acceptIdentityInvitation({ tenant, invitation, fetchImpl: window.fetch.bind(window) });
      await establishSession();
    } catch (error) {
      const failure = IdentityAccount.identityMessage(error.code);
      setStatus("error");
      setMessage(tr(failure.messageKey, failure.message));
    }
  });

  useEffect(() => {
    retry(establishSession);
    // Tenant context is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { tenant, status, setStatus, message, setMessage, tr, unavailable, beginSignIn, establishSession, complete, retry, invitation, acceptInvitation };
};

/** The card shown when sign-in stops: retry, sign in again, or sign out. */
export const SignInFailureCard = ({ signIn, Shell, onSignIn }) => {
  const { tenant, status, message, tr, beginSignIn, establishSession, retry, invitation, acceptInvitation } = signIn;
  return (
    <Shell>
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
        {status === "pending-invitation" && invitation && (
          <V2Button type="button" width="full" onClick={acceptInvitation}>
            {tr("CORE_IDENTITY_ACCEPT_INVITATION", "Accept invitation")}
          </V2Button>
        )}
        <V2Button
          type="button"
          width="full"
          onClick={
            status === "forbidden" || status === "pending-invitation"
              ? () => retry(() => Digit.UserService.logout())
              : status === "error"
                ? () => retry(establishSession)
                : () => retry(onSignIn || beginSignIn)
          }
        >
          {status === "forbidden" || status === "pending-invitation"
            ? tr("CORE_IDENTITY_SIGN_OUT", "Sign out")
            : status === "error"
              ? tr("CORE_IDENTITY_TRY_AGAIN", "Try again")
              : tr("CORE_IDENTITY_SIGN_IN", "Sign in →")}
        </V2Button>
      </V2Card>
    </Shell>
  );
};
