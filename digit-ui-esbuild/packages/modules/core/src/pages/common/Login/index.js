import React, { useState, useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { Toast } from "@egovernments/digit-ui-components";
import { getAuthAdapter } from "@egovernments/digit-ui-libraries";
import SandBoxHeader from "../../../components/SandBoxHeader";
import ImageComponent from "../../../components/ImageComponent";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const UnifiedLogin = ({ stateCode }) => {
  const history = useHistory();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const contextPath = window?.contextPath || "digit-ui";
  const adapter = getAuthAdapter();
  const providers = adapter ? adapter.getSupportedProviders() : [];

  const tenants =
    Digit.SessionStorage.get("initData")?.tenants ||
    window?.globalConfigs?.getConfig("TENANTS") ||
    [];

  useEffect(() => {
    if (adapter && adapter.isAuthenticated()) {
      const user = adapter.getUser();
      if (user && user.type === "EMPLOYEE") {
        history.replace(`/${contextPath}/employee`);
      } else {
        history.replace(location.state?.from || `/${contextPath}/citizen`);
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const loginTenant = tenantId || stateCode;
      const result = await adapter.login({
        email,
        password,
        tenantId: loginTenant,
      });

      const user = result?.user || (adapter && adapter.getUser());
      if (user && user.type === "EMPLOYEE") {
        window.location.replace(
          window.location.origin + "/" + contextPath + "/employee"
        );
      } else {
        history.replace(location.state?.from || `/${contextPath}/citizen`);
      }
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = (provider) => {
    if (adapter) adapter.loginWithProvider(provider);
  };

  const isSubmitDisabled = !email || !password || loading;

  const fieldStyle = {
    width: "100%",
    padding: "0.625rem 0.75rem",
    border: "1px solid #B1B4B6",
    borderRadius: "4px",
    fontSize: "0.9375rem",
    fontFamily: "Roboto, sans-serif",
    backgroundColor: "#fff",
    height: "42px",
    boxSizing: "border-box",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    marginBottom: "0.375rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "#0B0C0C",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#F0F0F0",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "#fff",
          borderRadius: "8px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)",
          padding: "2rem 2rem 1.5rem",
        }}
      >
        <div style={{ marginBottom: "1.5rem" }}>
          <SandBoxHeader showTenant={false} />
        </div>

        <h2
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            color: "#0B0C0C",
            margin: "0 0 0.25rem",
          }}
        >
          Login
        </h2>
        <p
          style={{
            fontSize: "0.8125rem",
            color: "#505A5F",
            margin: "0 0 1.5rem",
          }}
        >
          Sign in to access employee services
        </p>

        <form onSubmit={handleSubmit}>
          {tenants.length > 1 && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>
                City <span style={{ color: "#D4351C" }}>*</span>
              </label>
              <select
                id="kc-tenant-select"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                style={{ ...fieldStyle, cursor: "pointer" }}
              >
                <option value="">Select city</option>
                {tenants
                  .filter((t) => t.code !== stateCode)
                  .map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name || t.code}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>
              Username / Email <span style={{ color: "#D4351C" }}>*</span>
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter username or email"
              required
              style={fieldStyle}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={labelStyle}>
              Password <span style={{ color: "#D4351C" }}>*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              style={fieldStyle}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            style={{
              width: "100%",
              padding: "0.625rem 1rem",
              backgroundColor: isSubmitDisabled ? "#B1B4B6" : "#F47738",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "1rem",
              fontWeight: 700,
              fontFamily: "Roboto, sans-serif",
              cursor: isSubmitDisabled ? "not-allowed" : "pointer",
              height: "42px",
            }}
          >
            {loading ? "Signing in..." : "Login"}
          </button>

          {providers.length > 0 && (
            <React.Fragment>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  margin: "1.25rem 0",
                  gap: "0.75rem",
                }}
              >
                <div style={{ flex: 1, height: "1px", backgroundColor: "#D6D6D6" }} />
                <span style={{ fontSize: "0.8125rem", color: "#505A5F" }}>or</span>
                <div style={{ flex: 1, height: "1px", backgroundColor: "#D6D6D6" }} />
              </div>

              {providers.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => handleSSO(provider)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 1rem",
                    border: "1px solid #B1B4B6",
                    borderRadius: "4px",
                    backgroundColor: "#fff",
                    cursor: "pointer",
                    fontSize: "0.9375rem",
                    fontWeight: 500,
                    fontFamily: "Roboto, sans-serif",
                    height: "42px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.625rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  {provider.toLowerCase() === "google" && <GoogleIcon />}
                  <span>Sign in with {provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
                </button>
              ))}
            </React.Fragment>
          )}
        </form>

        {error && (
          <Toast type="error" label={error} onClose={() => setError(null)} />
        )}
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <ImageComponent
          alt="Powered by DIGIT"
          src={window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")}
          style={{ cursor: "pointer", height: "1.25em" }}
          onClick={() => {
            window
              .open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank")
              .focus();
          }}
        />
      </div>
    </div>
  );
};

export default UnifiedLogin;
