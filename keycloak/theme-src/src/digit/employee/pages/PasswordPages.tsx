import { useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { KcContext } from "../../../login/KcContext";
import { useBranding } from "../../branding/BrandingContext";
import { PasswordInput, TextField } from "../../components/Fields";
import type { DigitPageProps } from "../../shared/kc";

function plain(html: string): string {
    if (typeof document === "undefined") return html;
    const el = document.createElement("div");
    el.innerHTML = kcSanitize(html);
    return el.textContent ?? "";
}

/**
 * login-reset-password.ftl — where "Forgot password?" lands. digit-ui's own
 * forgot-password screen is a card with the header, one field and Continue;
 * this is that card, posting the username to Keycloak's reset action.
 */
export function LoginResetPassword(props: DigitPageProps<Extract<KcContext, { pageId: "login-reset-password.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, auth, messagesPerField } = kcContext;
    const { msg } = i18n;
    const { i18n: digit } = useBranding();
    const [username, setUsername] = useState(auth.attemptedUsername ?? "");
    const error = messagesPerField.existsError("username") ? plain(messagesPerField.get("username")) : undefined;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={error === undefined}
            headerNode={digit.t("CORE_COMMON_FORGOT_PASSWORD")}
        >
            <form
                id="kc-reset-password-form"
                className="dg-form dg-form--employee"
                action={url.loginAction}
                method="post"
                noValidate
            >
                <p className="dg-text">{msg("emailInstruction")}</p>
                <TextField
                    id="username"
                    label={digit.t("CORE_LOGIN_USERNAME")}
                    required
                    invalid={error !== undefined}
                    error={error}
                    input={{
                        name: "username",
                        type: "text",
                        autoComplete: "username",
                        value: username,
                        onChange: event => setUsername(event.target.value)
                    }}
                />
                <button className="dg-button" type="submit" disabled={username.trim() === ""}>
                    {digit.t("CORE_COMMON_CONTINUE")}
                </button>
                <a className="dg-link dg-forgot" href={url.loginUrl}>
                    {digit.t("CORE_COMMON_GO_BACK")}
                </a>
            </form>
        </Template>
    );
}

/**
 * login-update-password.ftl — digit-ui's change-password card: new password,
 * confirm, Change Password. Keycloak checks and stores it.
 */
export function LoginUpdatePassword(props: DigitPageProps<Extract<KcContext, { pageId: "login-update-password.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, messagesPerField, isAppInitiatedAction } = kcContext;
    const { msg, msgStr } = i18n;
    const { i18n: digit } = useBranding();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");

    const newError = messagesPerField.existsError("password") ? plain(messagesPerField.get("password")) : undefined;
    const confirmError = messagesPerField.existsError("password-confirm")
        ? plain(messagesPerField.get("password-confirm"))
        : undefined;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!messagesPerField.existsError("password", "password-confirm")}
            headerNode={digit.t("CORE_COMMON_CHANGE_PASSWORD")}
        >
            <form
                id="kc-passwd-update-form"
                className="dg-form dg-form--employee"
                action={url.loginAction}
                method="post"
                noValidate
            >
                <div className="dg-field">
                    <label className="dg-label" htmlFor="password-new">
                        {digit.t("CORE_LOGIN_NEW_PASSWORD")}
                        <span className="dg-label__required" aria-hidden="true">
                            *
                        </span>
                    </label>
                    <PasswordInput
                        id="password-new"
                        name="password-new"
                        value={password}
                        onChange={setPassword}
                        autoComplete="new-password"
                        invalid={newError !== undefined}
                        showLabel="Show password"
                        hideLabel="Hide password"
                    />
                    {newError !== undefined && (
                        <p id="password-new-error" className="dg-field-error" aria-live="polite">
                            {newError}
                        </p>
                    )}
                </div>
                <div className="dg-field">
                    <label className="dg-label" htmlFor="password-confirm">
                        {digit.t("CORE_LOGIN_CONFIRM_NEW_PASSWORD")}
                        <span className="dg-label__required" aria-hidden="true">
                            *
                        </span>
                    </label>
                    <PasswordInput
                        id="password-confirm"
                        name="password-confirm"
                        value={confirm}
                        onChange={setConfirm}
                        autoComplete="new-password"
                        invalid={confirmError !== undefined}
                        showLabel="Show password"
                        hideLabel="Hide password"
                    />
                    {confirmError !== undefined && (
                        <p id="password-confirm-error" className="dg-field-error" aria-live="polite">
                            {confirmError}
                        </p>
                    )}
                </div>
                <label className="dg-checkbox" htmlFor="logout-sessions">
                    <input
                        type="checkbox"
                        id="logout-sessions"
                        name="logout-sessions"
                        value="on"
                        defaultChecked
                        className="dg-checkbox__input"
                    />
                    <span className="dg-checkbox__box" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M9.00016 16.1698L4.83016 11.9998L3.41016 13.4098L9.00016 18.9998L21.0002 6.99984L19.5902 5.58984L9.00016 16.1698Z" />
                        </svg>
                    </span>
                    <span className="dg-checkbox__label">{msg("logoutOtherSessions")}</span>
                </label>
                <button
                    className="dg-button"
                    type="submit"
                    disabled={password === "" || confirm === ""}
                >
                    {digit.t("CORE_COMMON_CHANGE_PASSWORD")}
                </button>
                {isAppInitiatedAction && (
                    <button
                        className="dg-button dg-button--secondary"
                        type="submit"
                        name="cancel-aia"
                        value="true"
                    >
                        {msgStr("doCancel")}
                    </button>
                )}
            </form>
        </Template>
    );
}
