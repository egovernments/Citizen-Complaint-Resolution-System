import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";
import { PasswordField } from "../components/Field";

/**
 * login-update-password.ftl — the UPDATE_PASSWORD required action.
 *
 * This is the screen the Configurator's "Set up or reset your password" link
 * lands on: the identity BFF asks Keycloak to email an execute-actions link for
 * VERIFY_EMAIL + UPDATE_PASSWORD, and the user arrives here to choose the
 * password. Keycloak sets and stores it; nothing in DIGIT sees it.
 */
export default function LoginUpdatePassword(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-update-password.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, messagesPerField, isAppInitiatedAction } = kcContext;
    const { msg, msgStr } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!messagesPerField.existsError("password", "password-confirm")}
            eyebrow={msg("digitSecurity")}
            headerNode={msg("updatePasswordTitle")}
        >
            <form
                id="kc-passwd-update-form"
                className="digit-section"
                action={url.loginAction}
                method="post"
                noValidate
            >
                <div>
                    <PasswordField
                        id="password-new"
                        label={msg("passwordNew")}
                        showLabel={msgStr("digitShowPassword")}
                        hideLabel={msgStr("digitHidePassword")}
                        errorHtml={
                            messagesPerField.existsError("password")
                                ? kcSanitize(messagesPerField.get("password"))
                                : undefined
                        }
                        input={{
                            name: "password-new",
                            autoFocus: true,
                            autoComplete: "new-password"
                        }}
                    />
                    <PasswordField
                        id="password-confirm"
                        label={msg("passwordConfirm")}
                        showLabel={msgStr("digitShowPassword")}
                        hideLabel={msgStr("digitHidePassword")}
                        errorHtml={
                            messagesPerField.existsError("password-confirm")
                                ? kcSanitize(messagesPerField.get("password-confirm"))
                                : undefined
                        }
                        input={{
                            name: "password-confirm",
                            autoComplete: "new-password"
                        }}
                    />
                </div>

                <label className="digit-checkbox" htmlFor="logout-sessions">
                    <input type="checkbox" id="logout-sessions" name="logout-sessions" value="on" />
                    {msg("logoutOtherSessions")}
                </label>

                <div className="digit-stack-sm">
                    <button className="digit-button digit-button--primary" type="submit">
                        {msgStr("doSubmit")}
                    </button>
                    {isAppInitiatedAction && (
                        <button
                            className="digit-button digit-button--outline"
                            type="submit"
                            name="cancel-aia"
                            value="true"
                        >
                            {msgStr("doCancel")}
                        </button>
                    )}
                </div>
            </form>
        </Template>
    );
}
