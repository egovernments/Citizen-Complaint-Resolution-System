import React, { useState, useCallback, useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { Toast } from "@egovernments/digit-ui-components";
import { getAuthAdapter } from "@egovernments/digit-ui-libraries";

const DEFAULT_REDIRECT = (contextPath) => `/${contextPath}/citizen`;

const UnifiedLogin = ({ stateCode }) => {
  const history = useHistory();
  const location = useLocation();
  // Hardcode labels — this page renders before DIGIT's i18n loads
  const t = (key) => ({
    CORE_COMMON_LOGIN: "Login",
    CORE_COMMON_SIGNUP: "Sign Up",
    CORE_COMMON_EMAIL: "Email",
    CORE_COMMON_PASSWORD: "Password",
    CORE_COMMON_NAME: "Full Name",
    CORE_COMMON_FORGOT_PASSWORD: "Forgot password?",
    CORE_COMMON_SSO_GOOGLE: "Sign in with Google",
    CORE_COMMON_SSO_GITHUB: "Sign in with GitHub",
  })[key] || key;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [emailStatus, setEmailStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const contextPath = window?.contextPath || "digit-ui";
  const adapter = getAuthAdapter();
  const providers = adapter.getSupportedProviders();
  const from = location.state?.from || DEFAULT_REDIRECT(contextPath);

  const checkEmail = useCallback(
    async (emailValue) => {
      if (!emailValue || !emailValue.includes("@")) {
        setEmailStatus("idle");
        return;
      }
      setEmailStatus("checking");
      try {
        const exists = await adapter.checkEmailExists(emailValue);
        setEmailStatus(exists ? "exists" : "new");
      } catch {
        setEmailStatus("idle");
      }
    },
    [adapter]
  );

  useEffect(() => {
    if (adapter.isAuthenticated()) {
      history.replace(from);
    }
  }, []);

  const handleEmailBlur = () => {
    checkEmail(email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (emailStatus === "new") {
        if (!name.trim()) {
          setError("Please enter your name");
          setLoading(false);
          return;
        }
        await adapter.signup({ email, password, name: name.trim() });
      } else {
        await adapter.login({ email, password });
      }
      history.replace(from);
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = (provider) => {
    adapter.loginWithProvider(provider);
  };

  const isSubmitDisabled =
    !email || !password || emailStatus === "checking" || loading;

  return (
    <div
      className="unified-login-container"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        padding: "1rem",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          backgroundColor: "#fff",
        }}
      >
        <h2 style={{ marginBottom: "1.5rem", textAlign: "center" }}>
          {emailStatus === "new" ? t("CORE_COMMON_SIGNUP") || "Sign Up" : t("CORE_COMMON_LOGIN") || "Log In"}
        </h2>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
            {t("CORE_COMMON_EMAIL") || "Email"}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={handleEmailBlur}
            placeholder="you@example.com"
            required
            style={{
              width: "100%",
              padding: "0.75rem",
              border: "1px solid #ccc",
              borderRadius: "4px",
              fontSize: "1rem",
            }}
          />
          {emailStatus === "checking" && (
            <span style={{ fontSize: "0.8rem", color: "#666" }}>Checking...</span>
          )}
        </div>

        {providers.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            {providers.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSSO(provider)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontSize: "1rem",
                  marginBottom: "0.5rem",
                }}
              >
                {t(`CORE_COMMON_SSO_${provider.toUpperCase()}`) || `Sign in with ${provider}`}
              </button>
            ))}
            <div
              style={{
                textAlign: "center",
                margin: "1rem 0",
                color: "#999",
                fontSize: "0.85rem",
              }}
            >
              &mdash; or &mdash;
            </div>
          </div>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
            {t("CORE_COMMON_PASSWORD") || "Password"}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            required
            minLength={8}
            style={{
              width: "100%",
              padding: "0.75rem",
              border: "1px solid #ccc",
              borderRadius: "4px",
              fontSize: "1rem",
            }}
          />
        </div>

        {emailStatus === "new" && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
              {t("CORE_COMMON_NAME") || "Name"}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              style={{
                width: "100%",
                padding: "0.75rem",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitDisabled}
          style={{
            width: "100%",
            padding: "0.75rem",
            backgroundColor: isSubmitDisabled ? "#ccc" : "#F47738",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "1rem",
            cursor: isSubmitDisabled ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading
            ? "..."
            : emailStatus === "new"
            ? t("CORE_COMMON_SIGNUP") || "Sign Up"
            : t("CORE_COMMON_LOGIN") || "Log In"}
        </button>

        {emailStatus === "exists" && (
          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
              }}
              style={{ color: "#F47738", fontSize: "0.9rem" }}
            >
              {t("CORE_COMMON_FORGOT_PASSWORD") || "Forgot password?"}
            </a>
          </div>
        )}

        {error && <Toast type="error" label={error} onClose={() => setError(null)} />}
      </form>
    </div>
  );
};

export default UnifiedLogin;
