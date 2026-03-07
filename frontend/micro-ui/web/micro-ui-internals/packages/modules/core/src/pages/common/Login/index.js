import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useHistory, useLocation } from "react-router-dom";
import {
  AppContainer,
  Button,
  CardText,
  FieldV1,
  InputCard,
  LinkLabel,
  Toast,
} from "@egovernments/digit-ui-components";
import { getAuthAdapter } from "@egovernments/digit-ui-libraries";

const DEFAULT_REDIRECT = (contextPath) => `/${contextPath}/citizen`;

// Hardcode labels — this page renders before DIGIT's i18n loads
const t = (key) =>
  ({
    CORE_COMMON_LOGIN: "Login",
    CORE_COMMON_SIGNUP: "Sign Up",
    CORE_COMMON_EMAIL: "Email",
    CORE_COMMON_PASSWORD: "Password",
    CORE_COMMON_NAME: "Full Name",
    CORE_COMMON_FORGOT_PASSWORD: "Forgot password?",
    CORE_COMMON_SSO_GOOGLE: "Sign in with Google",
    CORE_COMMON_SSO_GITHUB: "Sign in with GitHub",
    CORE_SSO_DIVIDER: "or",
    CORE_CHECKING_EMAIL: "Checking...",
    CORE_AUTH_FAILED: "Authentication failed",
    CORE_NAME_REQUIRED: "Please enter your name",
  })[key] || key;

const UnifiedLogin = ({ stateCode }) => {
  const history = useHistory();
  const location = useLocation();

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

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);

    try {
      if (emailStatus === "new") {
        if (!name.trim()) {
          setError(t("CORE_NAME_REQUIRED"));
          setLoading(false);
          return;
        }
        await adapter.signup({ email, password, name: name.trim() });
      } else {
        await adapter.login({ email, password });
      }
      history.replace(from);
    } catch (err) {
      setError(err.message || t("CORE_AUTH_FAILED"));
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = (provider) => {
    adapter.loginWithProvider(provider);
  };

  const isSignup = emailStatus === "new";

  const isSubmitDisabled = useMemo(
    () => !email || !password || emailStatus === "checking" || loading,
    [email, password, emailStatus, loading]
  );

  const inputCardTexts = useMemo(
    () => ({
      header: isSignup ? t("CORE_COMMON_SIGNUP") : t("CORE_COMMON_LOGIN"),
      submitBarLabel: loading
        ? "..."
        : isSignup
        ? t("CORE_COMMON_SIGNUP")
        : t("CORE_COMMON_LOGIN"),
    }),
    [isSignup, loading]
  );

  return (
    <div className="citizen-form-wrapper">
      <AppContainer>
        <InputCard
          t={t}
          texts={inputCardTexts}
          submit
          onNext={handleSubmit}
          isDisable={isSubmitDisabled}
        >
          {/* SSO providers */}
          {providers.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              {providers.map((provider) => (
                <Button
                  key={provider}
                  label={t(`CORE_COMMON_SSO_${provider.toUpperCase()}`) || `Sign in with ${provider}`}
                  onButtonClick={() => handleSSO(provider)}
                  variation="secondary"
                  style={{ width: "100%", marginBottom: "8px" }}
                />
              ))}
              <CardText style={{ textAlign: "center" }}>
                &mdash; {t("CORE_SSO_DIVIDER")} &mdash;
              </CardText>
            </div>
          )}

          {/* Email field */}
          <div>
            <FieldV1
              withoutLabel
              error={emailStatus === "checking" ? t("CORE_CHECKING_EMAIL") : ""}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleEmailBlur}
              placeholder="you@example.com"
              populators={{
                name: "email",
                validation: { maxlength: 256 },
              }}
              props={{ fieldStyle: { width: "100%" } }}
              type="text"
              value={email}
            />
          </div>

          {/* Password field */}
          <div>
            <FieldV1
              withoutLabel
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              populators={{
                name: "password",
                validation: { minlength: 8 },
              }}
              props={{ fieldStyle: { width: "100%" } }}
              type="password"
              value={password}
            />
          </div>

          {/* Name field (signup only) */}
          {isSignup && (
            <div>
              <FieldV1
                withoutLabel
                onChange={(e) => setName(e.target.value)}
                placeholder={t("CORE_COMMON_NAME")}
                populators={{
                  name: "name",
                }}
                props={{ fieldStyle: { width: "100%" } }}
                type="text"
                value={name}
              />
            </div>
          )}

          {/* Forgot password link */}
          {emailStatus === "exists" && (
            <div style={{ textAlign: "center", marginTop: "8px" }}>
              <LinkLabel onClick={() => {}}>
                {t("CORE_COMMON_FORGOT_PASSWORD")}
              </LinkLabel>
            </div>
          )}
        </InputCard>

        {error && <Toast type="error" label={error} onClose={() => setError(null)} />}
      </AppContainer>
    </div>
  );
};

export default UnifiedLogin;
