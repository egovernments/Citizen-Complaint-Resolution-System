import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";
import {
  buildIdentityBffAuthorizeUrl,
  clearIdentityBffSignOutIncomplete,
  establishIdentityBffSession,
  identityBffSignOutIncomplete,
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
  const tenant = window.__digitTenantContext || null;
  // A tenantless /digit-ui/... login page (legacy ingress, preserved vhost,
  // the Kong /digit-ui route) has no route tenant to sign in to. Say so
  // instead of starting a sign-in that has no tenant to bind.
  const hasTenant = Boolean(tenant?.appBasePath);
  const [status, setStatus] = useState(hasTenant ? "checking" : "no-tenant");
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState(null);
  const destination = hasTenant
    ? restrictIdentityBffDestination(
        location.state?.from || new URLSearchParams(location.search).get("from"),
        identityBffSurfaceBase(tenant, surface),
      )
    : null;
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

  // An explicit sign-in: the user chose to continue despite the warning. Go
  // through Keycloak (prompt=login) instead of reusing a cookie the failed
  // sign-out may have left behind.
  const signInAfterIncompleteSignOut = (start) => {
    clearIdentityBffSignOutIncomplete();
    return retry(start || beginSignIn);
  };

  useEffect(() => {
    // A tenantless page keeps its choose-organisation card, whatever the flag says.
    if (!hasTenant) return;
    // The last sign-out in this tab could not end the BFF session, so its
    // cookie may still be live: do not silently sign that user back in.
    if (identityBffSignOutIncomplete()) {
      setStatus("signout-incomplete");
      setMessage(tr("CORE_IDENTITY_SIGNOUT_INCOMPLETE", "Sign-out may not have finished, so this browser can still be signed in. Try signing out again, or sign in to continue."));
      return;
    }
    retry(establishSession);
    // Tenant context is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { tenant, status, setStatus, message, setMessage, tr, unavailable, beginSignIn, establishSession, complete, retry, invitation, acceptInvitation, signInAfterIncompleteSignOut };
};

/** The card shown when sign-in stops: retry, sign in again, or sign out. */
export const SignInFailureCard = ({ signIn, Shell, onSignIn }) => {
  const { tenant, status, message, tr, beginSignIn, establishSession, retry, invitation, acceptInvitation, signInAfterIncompleteSignOut } = signIn;
  if (status === "no-tenant") return <ChooseOrganisationCard tr={tr} Shell={Shell} />;
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
            {tenant?.name}
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
        {status === "signout-incomplete" && (
          <V2Button type="button" width="full" variant="secondary" onClick={() => signInAfterIncompleteSignOut(onSignIn)}>
            {tr("CORE_IDENTITY_SIGN_IN", "Sign in →")}
          </V2Button>
        )}
        <V2Button
          type="button"
          width="full"
          onClick={
            status === "forbidden" || status === "pending-invitation" || status === "signout-incomplete"
              ? () => retry(() => Digit.UserService.logout())
              : status === "error"
                ? () => retry(establishSession)
                : () => retry(onSignIn || beginSignIn)
          }
        >
          {status === "signout-incomplete"
            ? tr("CORE_IDENTITY_SIGN_OUT_AGAIN", "Try signing out again")
            : status === "forbidden" || status === "pending-invitation"
            ? tr("CORE_IDENTITY_SIGN_OUT", "Sign out")
            : status === "error"
              ? tr("CORE_IDENTITY_TRY_AGAIN", "Try again")
              : tr("CORE_IDENTITY_SIGN_IN", "Sign in →")}
        </V2Button>
      </V2Card>
    </Shell>
  );
};

/**
 * A login page reached without a /{slug}/digit-ui/ route. Sign-in is bound to
 * a tenant, so the visitor needs their organisation's own link.
 */
const ChooseOrganisationCard = ({ tr, Shell }) => (
  <Shell>
    <V2Card
      style={{
        width: "100%",
        maxWidth: "420px",
        padding: "32px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        borderRadius: "14px",
        border: "none",
        boxShadow: "0 12px 32px rgba(8, 20, 40, 0.18), 0 2px 8px rgba(8, 20, 40, 0.10)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Header />
      </div>
      <h1 style={{ margin: 0, fontSize: "1.5rem", textAlign: "center", color: "var(--color-text-heading, #1D2433)" }}>
        {tr("CORE_IDENTITY_CHOOSE_ORGANISATION", "Choose your organisation")}
      </h1>
      <p role="alert" style={{ margin: 0, color: "var(--color-text-secondary, #505A5F)", lineHeight: 1.5 }}>
        {tr(
          "CORE_IDENTITY_USE_ORGANISATION_LINK",
          "Sign in from your organisation's own link. It looks like /your-organisation/digit-ui/. Ask your administrator if you do not have it.",
        )}
      </p>
    </V2Card>
  </Shell>
);
