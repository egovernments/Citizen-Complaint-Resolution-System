import React, { useMemo, useState } from "react";
import {
  getTenantId,
  getProductLabel,
  getStateLabel,
  getBrandTheme,
} from "../config/dashboardConfig";

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
 * Rendered inside `.dashboard-root` so it inherits the dashboard's theme tokens;
 * colour-bearing elements use the theme CSS variables via inline styles so the
 * look matches the dashboard regardless of which Tailwind utilities were emitted.
 *
 * The quick-fill buttons are demo conveniences only — they pre-fill the form,
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

const inputStyle = {
  borderRadius: "0.375rem",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--foreground)",
  padding: "0.5rem 0.75rem",
  fontSize: "13px",
  outline: "none",
};

const DashboardLogin = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const tenantId = getTenantId();
  const productLabel = useMemo(() => getProductLabel(), []);
  const stateLabel = useMemo(() => getStateLabel(), []);
  const brandStyle = useMemo(() => {
    const theme = getBrandTheme();
    return {
      "--brand-teal": theme.teal,
      "--brand-dark": theme.dark,
      "--brand-slate": theme.slate,
    };
  }, []);

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
    <div
      className="dashboard-root tw-font-sans"
      style={{
        ...brandStyle,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          borderRadius: "0.75rem",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          boxShadow: "0 10px 30px -12px rgba(0,0,0,0.25)",
        }}
      >
        {/* Branded header band — mirrors the sidebar chrome */}
        <div
          style={{
            background: "var(--chrome)",
            color: "var(--chrome-foreground)",
            padding: "1.25rem 1.5rem",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--chrome-muted)",
            }}
          >
            {stateLabel}
          </p>
          <h1 style={{ margin: "0.25rem 0 0", fontSize: "20px", fontWeight: 700, lineHeight: 1.2 }}>
            {productLabel}
          </h1>
          <p style={{ margin: "0.25rem 0 0", fontSize: "12px", color: "var(--chrome-muted)" }}>
            Sign in to the operations dashboard
          </p>
        </div>

        <div style={{ padding: "1.5rem" }}>
          <form onSubmit={signIn} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                }}
              >
                Username
              </span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                placeholder="e.g. DEMO_SUPERVISOR"
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                }}
              >
                Password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                placeholder="••••••••"
              />
            </label>

            {error ? (
              <div
                style={{
                  borderRadius: "0.375rem",
                  border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)",
                  background: "var(--status-breach-bg)",
                  color: "var(--destructive)",
                  padding: "0.5rem 0.75rem",
                  fontSize: "12px",
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: "0.25rem",
                borderRadius: "0.375rem",
                border: "none",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                padding: "0.625rem 0.75rem",
                fontSize: "13px",
                fontWeight: 600,
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <p
              style={{
                margin: "0 0 0.5rem",
                textAlign: "center",
                fontSize: "10px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--muted-foreground)",
              }}
            >
              Demo logins (tenant {tenantId})
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {DEMO_USERS.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => {
                    setUsername(u.username);
                    setPassword("eGov@123");
                    setError(null);
                  }}
                  title={`Fill ${u.username}`}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.125rem",
                    borderRadius: "0.375rem",
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--foreground)",
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>{u.label}</span>
                  <span style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>{u.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardLogin;
