import { useState } from "react";
import { useScript } from "keycloakify/login/pages/Login.useScript";
import type { KcContext } from "../../../login/KcContext";
import { resolveAccountAction } from "../../branding/branding";
import { useBranding } from "../../branding/BrandingContext";
import type { LoginMessageKey } from "../../branding/strings";
import { PasswordInput, TextField } from "../../components/Fields";
import { PrivacyConsent, pickPrivacyPolicy, type PrivacyPolicy } from "../../components/Privacy";
import type { DigitPageProps } from "../../shared/kc";
import { employeeReturnTo, requestPasswordSetup } from "../../shared/passwordHelp";

/**
 * login.js always renders PrivacyComponent and gates the submit on it; a
 * tenant without an MDMS PrivacyPolicy still gets the consent line, and the
 * popup then carries only its title.
 */
const NO_POLICY: PrivacyPolicy = { contents: [] };

/** Headings for the password check Keycloak runs before an account action (#2645). */
const CONFIRM_HEADINGS = new Map<string, LoginMessageKey>([
    ["UPDATE_PASSWORD", "CORE_LOGIN_CONFIRM_UPDATE_PASSWORD"],
    ["CONFIGURE_TOTP", "CORE_LOGIN_CONFIRM_CONFIGURE_TOTP"],
    ["UPDATE_EMAIL", "CORE_LOGIN_CONFIRM_UPDATE_EMAIL"]
]);

type ResetState = "idle" | "sending" | "sent" | "failed";

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
 * enabled once both fields have text and the consent box is ticked. A failed attempt raises the legacy
 * INVALID_LOGIN_CREDENTIALS toast rather than naming which half was wrong;
 * like login.js it does not outline either field in red.
 *
 * "Forgot password?" is always shown, as in login.js. It opens an email form
 * that asks the identity BFF for a password link (shared/passwordHelp.ts);
 * the answer never reveals whether the account exists. Both forms sit in the
 * one Template: keycloakify reloads the page when a Template mounts a second
 * time, which threw the email form away before it showed (#2700).
 *
 * When the identity BFF sends someone already signed in here to change their
 * password, authenticator or email (`kc_action`), Keycloak first asks for the
 * password again. The card then says so and offers a way back to the account
 * page. No username is passed in the URL (it would reach access logs), so the
 * person types it as for any sign-in.
 */
export default function Login(props: DigitPageProps<Extract<KcContext, { pageId: "login.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, login, auth, messagesPerField, usernameHidden } = kcContext;
    const { branding, slug, i18n: digit } = useBranding();

    const [username, setUsername] = useState(login.username ?? "");
    const [password, setPassword] = useState("");
    const [consented, setConsented] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [forgot, setForgot] = useState(false);
    const [resetState, setResetState] = useState<ResetState>("idle");
    const [accountAction] = useState(() => resolveAccountAction({ loginAction: url.loginAction }));
    const confirming = accountAction !== undefined;
    const accountPage = slug ? `${employeeReturnTo(slug)}user/account` : undefined;

    useScript({ webAuthnButtonId: "authenticateWebAuthnButton", kcContext, i18n });

    const policy = pickPrivacyPolicy(branding?.privacyPolicy) ?? NO_POLICY;
    const texts = textsOf(branding?.loginConfig);
    const showEmailHint = !usernameHidden && username.trim() !== "" && !username.includes("@");
    const invalidCredentials = messagesPerField.existsError("username", "password");

    const canSubmit =
        (usernameHidden || username.trim().length > 0) &&
        password.trim().length > 0 &&
        consented &&
        !isSubmitting;

    if (forgot) {
        return (
            <Template
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={doUseDefaultCss}
                classes={classes}
                displayMessage={false}
                headerNode={digit.t("CORE_COMMON_FORGOT_PASSWORD")}
                toast={resetState === "failed" ? digit.t("CORE_LOGIN_RESET_LINK_FAILED") : undefined}
            >
                <ForgotPassword
                    kcContext={kcContext}
                    returnTo={employeeReturnTo(slug)}
                    tenantSlug={slug}
                    state={resetState}
                    onStateChange={setResetState}
                    onBack={() => {
                        setForgot(false);
                        setResetState("idle");
                    }}
                />
            </Template>
        );
    }

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!invalidCredentials}
            headerNode={
                confirming
                    ? digit.t(CONFIRM_HEADINGS.get(accountAction) ?? "CORE_LOGIN_CONFIRM_ACTION")
                    : digit.tr(texts.header, digit.t("CORE_COMMON_LOGIN"))
            }
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
                        label={digit.t("CORE_LOGIN_EMAIL")}
                        required
                        input={{
                            name: "username",
                            type: "text",
                            autoComplete: "username",
                            "aria-describedby": showEmailHint ? "username-hint" : undefined,
                            value: username,
                            onChange: event => setUsername(event.target.value)
                        }}
                    />
                )}
                {showEmailHint && (
                    <p id="username-hint" className="dg-text" role="note">
                        {digit.t("CORE_LOGIN_EMAIL_HINT")}
                    </p>
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

                <PrivacyConsent policy={policy} checked={consented} onChange={setConsented} />

                <input type="hidden" id="id-hidden-input" name="credentialId" value={auth.selectedCredential ?? ""} />
                <button className="dg-button" name="login" id="kc-login" type="submit" disabled={!canSubmit}>
                    {isSubmitting && <span className="dg-spinner" aria-hidden="true" />}
                    {digit.tr(texts.submitButtonLabel, digit.t("CORE_COMMON_LOGIN"))}
                </button>

                <button
                    type="button"
                    className="dg-link dg-forgot"
                    id="kc-forgot-password"
                    onClick={() => setForgot(true)}
                >
                    {digit.tr(texts.secondaryButtonLabel, digit.t("CORE_COMMON_FORGOT_PASSWORD"))}
                </button>
                {confirming && accountPage && (
                    <a className="dg-link dg-forgot" id="kc-cancel" href={accountPage}>
                        {digit.t("CORE_COMMON_CANCEL")}
                    </a>
                )}
            </form>
        </Template>
    );
}

/**
 * The forgot-password card's body: email in, one non-committal confirmation
 * out. digit-ui's own forgot-password page resets the DIGIT (egov-user)
 * password by SMS OTP, but a Keycloak-managed employee signs in with the
 * Keycloak credential, so the link comes from Keycloak by email. Login owns
 * the Template and the request state, which drives its heading and toast.
 */
function ForgotPassword(props: {
    kcContext: Extract<KcContext, { pageId: "login.ftl" }>;
    returnTo?: string;
    tenantSlug?: string;
    state: ResetState;
    onStateChange: (state: ResetState) => void;
    onBack: () => void;
}) {
    const { kcContext, state, onStateChange: setState } = props;
    const { i18n: digit } = useBranding();
    const [email, setEmail] = useState(kcContext.login.username?.includes("@") ? kcContext.login.username : "");
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

    return (
        <form
            id="kc-reset-password-form"
            className="dg-form dg-form--employee"
            noValidate
            onSubmit={event => {
                event.preventDefault();
                if (!valid || state === "sending") return;
                setState("sending");
                void requestPasswordSetup({
                    baseUrl: kcContext.properties.DIGIT_IDENTITY_BFF_BASE_URL,
                    email,
                    returnTo: props.returnTo,
                    surface: "employee",
                    tenantSlug: props.tenantSlug
                }).then(ok =>
                    setState(ok ? "sent" : "failed")
                );
            }}
        >
            {state === "sent" ? (
                <p className="dg-text" role="status">
                    {digit.t("CORE_LOGIN_RESET_LINK_SENT")}
                </p>
            ) : (
                <>
                    <p className="dg-text">{digit.t("CORE_LOGIN_FORGOT_PASSWORD_TEXT")}</p>
                    <TextField
                        id="email"
                        label={digit.t("CORE_LOGIN_EMAIL")}
                        required
                        input={{
                            name: "email",
                            type: "email",
                            autoComplete: "email",
                            value: email,
                            onChange: event => setEmail(event.target.value)
                        }}
                    />
                    <button className="dg-button" type="submit" disabled={!valid || state === "sending"}>
                        {state === "sending" && <span className="dg-spinner" aria-hidden="true" />}
                        {digit.t("CORE_COMMON_CONTINUE")}
                    </button>
                </>
            )}
            <button type="button" className="dg-link dg-forgot" onClick={props.onBack}>
                {digit.t("CORE_COMMON_GO_BACK")}
            </button>
        </form>
    );
}
