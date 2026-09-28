import { useState } from "react";
import { useScript } from "keycloakify/login/pages/Login.useScript";
import type { KcContext } from "../../../login/KcContext";
import { useBranding } from "../../branding/BrandingContext";
import { PasswordInput, TextField } from "../../components/Fields";
import { PrivacyConsent, pickPrivacyPolicy } from "../../components/Privacy";
import type { DigitPageProps } from "../../shared/kc";

type LoginTexts = { header?: string; submitButtonLabel?: string; secondaryButtonLabel?: string };

function textsOf(loginConfig: unknown): LoginTexts {
    if (typeof loginConfig !== "object" || loginConfig === null) return {};
    const texts = (loginConfig as { texts?: unknown }).texts;
    return typeof texts === "object" && texts !== null ? (texts as LoginTexts) : {};
}

/**
 * login.ftl for digit-employee: pages/employee/Login/login.js (password mode).
 *
 * The form is Keycloak's — same action, field names and hidden
 * `credentialId` — dressed as the legacy card. As in login.js the submit is
 * enabled once both fields have text and, where the tenant has a privacy
 * policy, the consent box is ticked. A failed attempt raises the legacy
 * INVALID_LOGIN_CREDENTIALS toast rather than naming which half was wrong;
 * like login.js it does not outline either field in red.
 */
export default function Login(props: DigitPageProps<Extract<KcContext, { pageId: "login.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { realm, url, login, auth, messagesPerField, usernameHidden } = kcContext;
    const { branding, i18n: digit } = useBranding();

    const [username, setUsername] = useState(login.username ?? "");
    const [password, setPassword] = useState("");
    const [consented, setConsented] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useScript({ webAuthnButtonId: "authenticateWebAuthnButton", kcContext, i18n });

    const policy = pickPrivacyPolicy(branding?.privacyPolicy);
    const texts = textsOf(branding?.loginConfig);
    const invalidCredentials = messagesPerField.existsError("username", "password");

    const canSubmit =
        (usernameHidden || username.trim().length > 0) &&
        password.trim().length > 0 &&
        (policy === undefined || consented) &&
        !isSubmitting;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!invalidCredentials}
            headerNode={digit.tr(texts.header, digit.t("CORE_COMMON_LOGIN"))}
            toast={invalidCredentials ? digit.t("INVALID_LOGIN_CREDENTIALS") : undefined}
        >
            <form
                id="kc-form-login"
                className="dg-form dg-form--employee"
                action={url.loginAction}
                method="post"
                noValidate
                onSubmit={event => {
                    if (!canSubmit) {
                        event.preventDefault();
                        return;
                    }
                    // login.js trims the username before it authenticates.
                    const field = event.currentTarget.elements.namedItem("username");
                    if (field instanceof HTMLInputElement) field.value = field.value.trim();
                    setIsSubmitting(true);
                }}
            >
                {!usernameHidden && (
                    <TextField
                        id="username"
                        label={digit.t("CORE_LOGIN_USERNAME")}
                        required
                        input={{
                            name: "username",
                            type: "text",
                            autoComplete: "username",
                            value: username,
                            onChange: event => setUsername(event.target.value)
                        }}
                    />
                )}
                <div className="dg-field">
                    <label className="dg-label" htmlFor="password">
                        {digit.t("CORE_LOGIN_PASSWORD")}
                        <span className="dg-label__required" aria-hidden="true">
                            *
                        </span>
                    </label>
                    <PasswordInput
                        id="password"
                        name="password"
                        value={password}
                        onChange={setPassword}
                        showLabel="Show password"
                        hideLabel="Hide password"
                    />
                </div>

                {policy !== undefined && (
                    <PrivacyConsent policy={policy} checked={consented} onChange={setConsented} />
                )}

                <input type="hidden" id="id-hidden-input" name="credentialId" value={auth.selectedCredential ?? ""} />
                <button className="dg-button" name="login" id="kc-login" type="submit" disabled={!canSubmit}>
                    {isSubmitting && <span className="dg-spinner" aria-hidden="true" />}
                    {digit.tr(texts.submitButtonLabel, digit.t("CORE_COMMON_LOGIN"))}
                </button>

                {realm.resetPasswordAllowed && (
                    <a className="dg-link dg-forgot" id="kc-forgot-password" href={url.loginResetCredentialsUrl}>
                        {digit.tr(texts.secondaryButtonLabel, digit.t("CORE_COMMON_FORGOT_PASSWORD"))}
                    </a>
                )}
            </form>
        </Template>
    );
}
