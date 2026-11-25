import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PopUp, Button } from "@egovernments/digit-ui-components";
import {
  startIdleTimer,
  idleTimeoutMs,
  idleWarningMs,
  idleProfileFor,
  storageActivityStore,
  redirectToLogin,
  isKeycloakAuth,
  onEmployeeSignOut,
  SIGN_OUT_REASONS,
} from "@egovernments/digit-ui-libraries";

// Logs a signed-in user out after a period with no mouse, keyboard, touch or
// scroll activity (#224, VAPT "Insecure Session Management"): an employee on
// employee pages, a citizen on citizen pages, with DIGIT login. Public pages
// and Keycloak mode are untouched. Default 15 minutes for both; set globalConfigs
// EMPLOYEE_IDLE_TIMEOUT_MINUTES / CITIZEN_IDLE_TIMEOUT_MINUTES to change it, or
// to 0 to turn it off. See idleProfileFor for what differs between the two.
//
// A minute before (EMPLOYEE_/CITIZEN_IDLE_WARNING_SECONDS, 0 = no warning) a
// dialog says so and offers to stay signed in. For an employee, staying signed
// in or working in another of their tabs closes the dialog in every tab. A
// citizen's complaint draft survives the sign-out (authSession keeps it).
//
// Also ends an employee tab's login when that employee logs out in another
// tab: since #224 every tab holds its own login, so the logout button alone
// used to leave the other tabs signed in.

// Remembers, per tab, which login the shared activity clock was last reset for.
// A NEW token here (any login screen, the dashboard's own login, a password
// change) counts as fresh activity; a reloaded or restored tab keeps its token,
// so a stale clock still logs it out.
const SEEN_LOGIN_KEY = "Digit.IdleLogoutLogin";
const fingerprint = (token) => {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) h = (h * 31 + token.charCodeAt(i)) | 0;
  return String(h);
};

// Ends THIS login on the server and clears only this tab's credentials
// (authSession.redirectToLogin) — never localStorage.clear(), which would also
// sign out a citizen in another tab and wipe caches and drafts. The reason is
// shown on the login page.
const endThisLogin = async (reason) => {
  try {
    await Digit.UserService.logoutUser();
  } catch (e) {
    /* already invalid on the server: still clear the tab */
  }
  redirectToLogin(reason);
};

// Theme variables with literal fallbacks, as in SessionCollisionNotice.
const C = {
  text: "var(--color-text-primary, #0B0C0C)",
  muted: "var(--color-text-secondary, #505A5F)",
};

const formatCountdown = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
};

// Shown in the warning window. While it is up, moving the mouse does not keep
// the session (see startIdleTimer): only "Stay signed in", the close button or
// a click outside the dialog does, and that also closes it in the other tabs.
const IdleWarning = ({ signOutAt, onStay, onSignOutNow }) => {
  const { t } = useTranslation();
  const tx = (key, fallback) => (t(key) === key ? fallback : t(key));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stay = () => onStay();

  return (
    <PopUp
      className="digit-idle-warning-popup"
      style={{ maxWidth: "30rem", width: "min(30rem, 94vw)" }}
      showIcon={false}
      heading={tx("CORE_IDLE_WARNING_HEADING", "Are you still there?")}
      onClose={stay}
      onOverlayClick={stay}
      footerStyles={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}
      children={[
        <div key="body" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.25rem 0" }}>
          {/* Announced once when the dialog opens; the ticking clock below is
              hidden from screen readers so it is not read out every second. */}
          <div role="alert" style={{ fontSize: "0.9375rem", lineHeight: 1.55, color: C.text }}>
            {tx(
              "CORE_IDLE_WARNING_BODY",
              "You have not used CMS for a while. For your security you will be signed out soon. Anything you have not saved will be lost."
            )}
          </div>
          <div aria-hidden="true" style={{ fontSize: "0.875rem", color: C.muted }}>
            {tx("CORE_IDLE_WARNING_COUNTDOWN", "Signing out in")}{" "}
            <strong style={{ color: C.text, fontVariantNumeric: "tabular-nums" }}>{formatCountdown(signOutAt - now)}</strong>
          </div>
        </div>,
      ]}
      footerChildren={[
        <Button
          key="signout"
          type="button"
          size="large"
          variation="secondary"
          label={tx("CORE_IDLE_WARNING_SIGN_OUT", "Sign out now")}
          onClick={onSignOutNow}
        />,
        <Button
          key="stay"
          type="button"
          size="large"
          variation="primary"
          label={tx("CORE_IDLE_WARNING_STAY", "Stay signed in")}
          onClick={stay}
        />,
      ]}
    />
  );
};

const IdleLogout = () => {
  const { pathname } = useLocation();
  const user = window?.Digit?.UserService?.getUser?.();
  const token = user?.access_token || null;
  const profile = token && !isKeycloakAuth() ? idleProfileFor({ pathname, userType: user?.info?.type }) : null;
  const userType = profile?.userType || null;
  const active = !!profile;
  const [signOutAt, setSignOutAt] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    setSignOutAt(null);
    timer.current = null;
    if (!profile) return undefined;
    const config = (key) => window?.globalConfigs?.getConfig?.(key);
    const timeoutMs = idleTimeoutMs(config(profile.timeoutConfig));
    if (!timeoutMs) return undefined;
    const clock = storageActivityStore(window[profile.clockStorage], profile.activityKey);

    try {
      const seen = window.sessionStorage.getItem(SEEN_LOGIN_KEY);
      const current = fingerprint(token);
      if (seen !== current) {
        clock.write(Date.now());
        window.sessionStorage.setItem(SEEN_LOGIN_KEY, current);
      }
    } catch (e) {
      /* blocked storage: the per-tab countdown still works */
    }

    const stop = startIdleTimer({
      timeoutMs,
      onIdle: () => endThisLogin(SIGN_OUT_REASONS.IDLE),
      warnBeforeMs: idleWarningMs(config(profile.warningConfig), timeoutMs),
      onWarn: (at) => setSignOutAt(at),
      onActive: () => setSignOutAt(null),
      shared: clock,
    });
    timer.current = stop;
    return () => {
      timer.current = null;
      stop();
    };
    // `profile` is a new object each render; its identity is the user type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, token]);

  // Independent of the idle setting: the same employee logging out in another
  // tab ends this one too. A different employee's tab stays signed in.
  const userId = user?.info?.uuid || null;
  useEffect(() => {
    if (userType !== "EMPLOYEE") return undefined;
    return onEmployeeSignOut(() => endThisLogin(SIGN_OUT_REASONS.OTHER_TAB), { userId });
  }, [userType, token, userId]);

  if (!active || !signOutAt) return null;
  return (
    <IdleWarning
      signOutAt={signOutAt}
      onStay={() => timer.current?.keepAlive?.()}
      onSignOutNow={() => Digit.UserService.logout()}
    />
  );
};

export default IdleLogout;
