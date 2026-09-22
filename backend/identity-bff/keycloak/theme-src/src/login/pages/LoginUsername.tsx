import { useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import { useScript } from "keycloakify/login/pages/LoginUsername.useScript";
import type { KcContext } from "../KcContext";
import { Field } from "../components/Field";
import { SocialProviders } from "../components/SocialProviders";

/**
 * login-username.ftl — the identity-first variant of the challenge, shown when
 * the realm splits username and password across two steps.
 */
export default function LoginUsername(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-username.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const {
        social,
        realm,
        url,
        usernameHidden,
        login,
        registrationDisabled,
        messagesPerField,
        enableWebAuthnConditionalUI,
        authenticators
    } = kcContext;

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
            displayMessage={!messagesPerField.existsError("username")}
            eyebrow={msg("digitWelcomeBack")}
            headerNode={msg("doLogIn")}
            lede={msg("digitSignInLede")}
            messageTitle={msg("digitSignInProblemTitle")}
            displayInfo={realm.password && realm.registrationAllowed && !registrationDisabled}
            infoNode={
                <p className="digit-footnote" id="kc-registration">
                    {msg("noAccount")}{" "}
                    <a className="digit-link" href={url.registrationUrl}>
                        {msg("doRegister")}
                    </a>
                </p>
            }
            socialProvidersNode={
                realm.password && social?.providers !== undefined && social.providers.length !== 0 ? (
                    <SocialProviders
                        providers={social.providers}
                        label={msg("identity-provider-login-label")}
                        orLabel={msgStr("digitOr")}
                    />
                ) : null
            }
        >
            <div id="kc-form">
                {realm.password && (
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
                        {!usernameHidden && (
                            <Field
                                id="username"
                                label={
                                    !realm.loginWithEmailAllowed
                                        ? msg("username")
                                        : !realm.registrationEmailAsUsername
                                          ? msg("usernameOrEmail")
                                          : msg("email")
                                }
                                errorHtml={
                                    messagesPerField.existsError("username")
                                        ? kcSanitize(messagesPerField.getFirstError("username"))
                                        : undefined
                                }
                                input={{
                                    name: "username",
                                    type: "text",
                                    defaultValue: login.username ?? "",
                                    autoFocus: true,
                                    autoComplete: enableWebAuthnConditionalUI
                                        ? "username webauthn"
                                        : "username"
                                }}
                            />
                        )}

                        {realm.rememberMe && !usernameHidden && (
                            <label className="digit-checkbox" htmlFor="rememberMe">
                                <input
                                    id="rememberMe"
                                    name="rememberMe"
                                    type="checkbox"
                                    defaultChecked={!!login.rememberMe}
                                />
                                {msg("rememberMe")}
                            </label>
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
                )}
            </div>

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
