import React, { useState } from "react";
import { getTenantId } from "../config/dashboardConfig";

/**
 * Self-contained employee login for the standalone dashboard build.
 *
 * The standalone /dashboard-ui app has no login of its own — it expects an
 * Employee.token in localStorage (normally set by the main digit-ui login on the
 * same origin). This gate makes the dashboard demo-able on its own: it performs a
 * real OAuth password grant against /user/oauth/token, stores the token + the
 * returned userInfo (with the significant role first, so the scoping indicator is
 * legible), and hands control back to AdminDashboard.
 *
 * The two quick-fill buttons are demo conveniences only — they pre-fill the form,
 * they do not bypass authentication.
 */

// Basic egov-user-client: (empty secret), base64 of "egov-user-client:"
const OAUTH_BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo=";

const DEMO_USERS = [
  { label: "Supervisor", username: "DEMO_SUPERVISOR", hint: "sees officer-level KPIs" },
  { label: "GRO", username: "DEMO_GRO", hint: "officer-level KPIs hidden" },
];

/** Order roles so the first non-EMPLOYEE role leads (drives the scoping badge). */
function withSignificantRoleFirst(userInfo) {
  if (!userInfo || !Array.isArray(userInfo.roles)) return userInfo;
  const roles = [...userInfo.roles].sort(
    (a, b) => (a.code === "EMPLOYEE" ? 1 : 0) - (b.code === "EMPLOYEE" ? 1 : 0)
  );
  return { ...userInfo, roles };
}

export function hasDashboardSession() {
  try {
    const raw = window.localStorage?.getItem("Employee.token");
    return Boolean(raw && raw !== "undefined" && raw !== "null");
  } catch {
    return false;
  }
}

export function clearDashboardSession() {
  ["Employee.token", "Employee.user-info", "Employee.tenant-id", "user-info", "token"].forEach(
    (k) => {
      try {
        window.localStorage?.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  );
}

const DashboardLogin = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const tenantId = getTenantId();

  async function signIn(e) {
    if (e) e.preventDefault();
    if (!username || !password) {
      setError("Enter a username and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = new URLSearchParams({
        grant_type: "password",
        username,
        password,
        tenantId,
        userType: "EMPLOYEE",
        scope: "read",
      });
      const res = await fetch("/user/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: OAUTH_BASIC,
        },
        body,
      });
      if (!res.ok) {
        let msg = `Sign-in failed (${res.status}).`;
        try {
          const j = await res.json();
          msg = j.error_description || j.error || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const data = await res.json();
      const userInfo = withSignificantRoleFirst(data.UserRequest);
      window.localStorage.setItem("Employee.token", JSON.stringify(data.access_token));
      window.localStorage.setItem("Employee.user-info", JSON.stringify(userInfo));
      window.localStorage.setItem("Employee.tenant-id", JSON.stringify(tenantId));
      window.localStorage.setItem("user-info", JSON.stringify(userInfo));
      window.localStorage.setItem("token", JSON.stringify(data.access_token));
      if (onLogin) onLogin(userInfo);
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tw-flex tw-min-h-screen tw-items-center tw-justify-center tw-bg-background tw-px-4">
      <div className="tw-w-full tw-max-w-sm tw-rounded-lg tw-border tw-border-border tw-bg-surface tw-p-6 tw-shadow-sm">
        <div className="tw-mb-5 tw-text-center">
          <h1 className="tw-text-[18px] tw-font-semibold tw-text-foreground">
            Complaint Resolution
          </h1>
          <p className="tw-mt-1 tw-text-[12px] tw-text-muted-foreground">
            Sign in to the operations dashboard
          </p>
        </div>

        <form onSubmit={signIn} className="tw-flex tw-flex-col tw-gap-3">
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
              Username
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="tw-rounded-md tw-border tw-border-border tw-bg-background tw-px-3 tw-py-2 tw-text-[13px] tw-text-foreground focus:tw-border-primary focus:tw-outline-none"
              placeholder="e.g. DEMO_SUPERVISOR"
            />
          </label>

          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tw-rounded-md tw-border tw-border-border tw-bg-background tw-px-3 tw-py-2 tw-text-[13px] tw-text-foreground focus:tw-border-primary focus:tw-outline-none"
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <div className="tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] tw-bg-status-breach-bg tw-px-3 tw-py-2 tw-text-[12px] tw-text-destructive">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="tw-mt-1 tw-rounded-md tw-bg-primary tw-px-3 tw-py-2 tw-text-[13px] tw-font-medium tw-text-primary-foreground hover:tw-opacity-90 disabled:tw-opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="tw-mt-5 tw-border-t tw-border-border tw-pt-4">
          <p className="tw-mb-2 tw-text-center tw-text-[10px] tw-uppercase tw-tracking-wide tw-text-muted-foreground">
            Demo logins (tenant {tenantId})
          </p>
          <div className="tw-flex tw-gap-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.username}
                type="button"
                onClick={() => {
                  setUsername(u.username);
                  setPassword("eGov@123");
                  setError(null);
                }}
                className="tw-flex tw-flex-1 tw-flex-col tw-items-start tw-gap-0.5 tw-rounded-md tw-border tw-border-border tw-bg-surface-2 tw-px-3 tw-py-2 tw-text-left hover:tw-border-primary"
                title={`Fill ${u.username}`}
              >
                <span className="tw-text-[12px] tw-font-medium tw-text-foreground">{u.label}</span>
                <span className="tw-text-[10px] tw-text-muted-foreground">{u.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardLogin;
