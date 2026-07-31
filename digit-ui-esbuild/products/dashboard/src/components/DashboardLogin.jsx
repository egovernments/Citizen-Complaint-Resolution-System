import React, { useMemo, useState } from "react";
import {
  getTenantId,
  getProductLabel,
  getStateLabel,
  getBrandTheme,
} from "../config/dashboardConfig";
import {
  clearSession,
  getOAuthBasic,
  hasAuth,
  persistSession,
  withSignificantRoleFirst,
} from "../services/authService";
import useDashboardT from "../i18n/useDashboardT";

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


// label/hint are functions of t so they resolve at render time (never frozen at import).
const DEMO_USERS = [
  {
    label: (t) => t("DASHBOARD_LOGIN_DEMO_SUPERVISOR", "Supervisor"),
    username: "DEMO_SUPERVISOR",
    hint: (t) => t("DASHBOARD_LOGIN_DEMO_SUPERVISOR_HINT", "all departments"),
  },
  {
    label: (t) => t("DASHBOARD_LOGIN_DEMO_WATER", "Water officer"),
    username: "DEMO_WATER",
    hint: (t) => t("DASHBOARD_LOGIN_DEMO_WATER_HINT", "Water dept only"),
  },
  {
    label: (t) => t("DASHBOARD_LOGIN_DEMO_HEALTH", "Health officer"),
    username: "DEMO_HEALTH",
    hint: (t) => t("DASHBOARD_LOGIN_DEMO_HEALTH_HINT", "Medical dept only"),
  },
];


// Session storage lives in authService (single source of truth); these thin
// re-exports keep the existing AdminDashboard import sites unchanged.
export const hasDashboardSession = hasAuth;
export const clearDashboardSession = clearSession;

const inputStyle = {
  borderRadius: "0.375rem",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--foreground)",
  padding: "0.5rem 0.75rem",
  fontSize: "13px",
  outline: "none",
};

const DashboardLogin = ({ onLogin, expired = false }) => {
  const { t } = useDashboardT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(
    // Distinguish "your session ended" from "you got the password wrong": the
    // user did nothing wrong and reloading will not help them (#1466).
    // Localised like every sibling string on this screen — this is the one
    // message shown to a user who did nothing wrong, so it should not be the
    // only English text on an otherwise translated form.
    expired
      ? t("DASHBOARD_LOGIN_SESSION_EXPIRED", "Your session has expired. Please sign in again.")
      : null
  );

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
      setError(t("DASHBOARD_LOGIN_ENTER_CREDENTIALS", "Enter a username and password."));
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
          Authorization: getOAuthBasic(),
        },
        body,
      });
      if (!res.ok) {
        let msg = `${t("DASHBOARD_LOGIN_SIGN_IN_FAILED", "Sign-in failed")} (${res.status}).`;
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
      // refresh_token is persisted (owner-stamped) so authService can silently
      // renew the access token on a 401 instead of forcing a re-login (#1466).
      persistSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        userInfo,
        tenantId,
      });
      if (onLogin) onLogin(userInfo);
    } catch (err) {
      setError(err.message || `${t("DASHBOARD_LOGIN_SIGN_IN_FAILED", "Sign-in failed")}.`);
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
            {t("DASHBOARD_LOGIN_SUBTITLE", "Sign in to the operations dashboard")}
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
                {t("DASHBOARD_LOGIN_USERNAME", "Username")}
              </span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                placeholder={t("DASHBOARD_LOGIN_USERNAME_PLACEHOLDER", "e.g. DEMO_SUPERVISOR")}
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
                {t("DASHBOARD_LOGIN_PASSWORD", "Password")}
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
              {submitting
                ? t("DASHBOARD_LOGIN_SIGNING_IN", "Signing in…")
                : t("DASHBOARD_LOGIN_SIGN_IN", "Sign in")}
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
              {t("DASHBOARD_LOGIN_DEMO_LOGINS", "Demo logins")} ({t("DASHBOARD_LOGIN_TENANT", "tenant")} {tenantId})
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
                  title={`${t("DASHBOARD_LOGIN_FILL", "Fill")} ${u.username}`}
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
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>{u.label(t)}</span>
                  <span style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>{u.hint(t)}</span>
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
