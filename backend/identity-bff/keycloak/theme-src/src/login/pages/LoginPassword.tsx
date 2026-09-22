import { useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import { useScript } from "keycloakify/login/pages/LoginPassword.useScript";
import type { KcContext } from "../KcContext";
import { PasswordField } from "../components/Field";

/**
 * login-password.ftl — the second step of the identity-first flow. The
 * attempted username is rendered by the template's header, as Keycloak does.
 */
export default function LoginPassword(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-password.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { realm, url, messagesPerField, enableWebAuthnConditionalUI, authenticators } = kcContext;
    const { msg, msgStr } = i18n;
    const [isSubmitting, setIsSubmitting] = useState(false);
    const webAuthnButtonId = "authenticateWebAuthnButton";

    useScript({ webAuthnButtonId, kcContext, i18n });

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitSecurity")}
            headerNode={msg("doLogIn")}
            messageTitle={msg("digitSignInProblemTitle")}
            displayMessage={!messagesPerField.existsError("password")}
        >
            <form
                id="kc-form-login"
                className="digit-section"
                onSubmit={() => {
                    setIsSubmitting(true);
                    return true;
                }}
                action={url.loginAction}
                method="post"
                noValidate
            >
                <PasswordField
                    id="password"
                    label={msg("password")}
                    showLabel={msgStr("digitShowPassword")}
                    hideLabel={msgStr("digitHidePassword")}
                    errorHtml={
                        messagesPerField.existsError("password")
                            ? kcSanitize(messagesPerField.get("password"))
                            : undefined
                    }
                    input={{
                        name: "password",
                        autoFocus: true,
                        autoComplete: "current-password"
                    }}
                />

                {realm.resetPasswordAllowed && (
                    <p className="digit-footnote">
                        <a className="digit-link" href={url.loginResetCredentialsUrl}>
                            {msg("doForgotPassword")}
                        </a>
                    </p>
                )}

                <button
                    className="digit-button digit-button--primary"
                    name="login"
                    id="kc-login"
                    type="submit"
                    disabled={isSubmitting}
                >
                    {isSubmitting && <span className="digit-spinner" aria-hidden="true" />}
                    {msgStr("doLogIn")}
                </button>
            </form>

            {enableWebAuthnConditionalUI && (
                <>
                    <form id="webauth" action={url.loginAction} method="post">
                        <input type="hidden" id="clientDataJSON" name="clientDataJSON" />
                        <input type="hidden" id="authenticatorData" name="authenticatorData" />
                        <input type="hidden" id="signature" name="signature" />
                        <input type="hidden" id="credentialId" name="credentialId" />
                        <input type="hidden" id="userHandle" name="userHandle" />
                        <input type="hidden" id="error" name="error" />
                    </form>
                    {authenticators !== undefined && authenticators.authenticators.length !== 0 && (
                        <form id="authn_select">
                            {authenticators.authenticators.map((authenticator, index) => (
                                <input
                                    key={index}
                                    type="hidden"
                                    name="authn_use_chk"
                                    readOnly
                                    value={authenticator.credentialId}
                                />
                            ))}
                        </form>
                    )}
                    <button
                        id={webAuthnButtonId}
                        type="button"
                        className="digit-button digit-button--outline"
                        style={{ marginTop: "1.25rem" }}
                    >
                        {msgStr("passkey-doAuthenticate")}
                    </button>
                </>
            )}
        </Template>
    );
}
