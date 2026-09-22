import { useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import { useScript } from "keycloakify/login/pages/Login.useScript";
import type { KcContext } from "../KcContext";
import { Field, PasswordField } from "../components/Field";
import { SocialProviders } from "../components/SocialProviders";

/**
 * login.ftl — the password challenge, and the only screen in the journey that
 * ever receives a password. Structurally this is Keycloak's own form (same
 * action, same field names, same hidden `credentialId`, same passkey script);
 * what changed is that it is dressed as the Configurator's sign-in card.
 */
export default function Login(props: DigitPageProps<Extract<KcContext, { pageId: "login.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const {
        social,
        realm,
        url,
        usernameHidden,
        login,
        auth,
        registrationDisabled,
        messagesPerField,
        enableWebAuthnConditionalUI,
        authenticators,
        client
    } = kcContext;

    const { msg, msgStr } = i18n;
    const [isSubmitting, setIsSubmitting] = useState(false);
    const webAuthnButtonId = "authenticateWebAuthnButton";

    useScript({ webAuthnButtonId, kcContext, i18n });

    const credentialError = messagesPerField.existsError("username", "password")
        ? kcSanitize(messagesPerField.getFirstError("username", "password"))
        : undefined;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!messagesPerField.existsError("username", "password")}
            eyebrow={msg("digitWelcomeBack")}
            headerNode={msg("loginAccountTitle")}
            lede={msg("digitSignInLede")}
            messageTitle={msg("digitSignInProblemTitle")}
            displayInfo
            infoNode={
                <div className="digit-section">
                    {/* Preserved from the FreeMarker theme this replaced: the
                        way back to the Configurator, which owns password setup
                        and reset. `client.baseUrl` is Keycloak's registered
                        redirect base, not a caller-supplied URL. */}
                    {client.baseUrl !== undefined && (
                        <p className="digit-footnote" id="kc-digit-password-help">
                            <a className="digit-link" href={client.baseUrl}>
                                {msg("digitPasswordHelp")}
                            </a>
                        </p>
                    )}
                    {realm.password && realm.registrationAllowed && !registrationDisabled && (
                        <p className="digit-footnote" id="kc-registration">
                            {msg("noAccount")}{" "}
                            <a className="digit-link" href={url.registrationUrl}>
                                {msg("doRegister")}
                            </a>
                        </p>
                    )}
                </div>
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
                        <div>
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
                                    errorHtml={credentialError}
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

                            <PasswordField
                                id="password"
                                label={msg("password")}
                                showLabel={msgStr("digitShowPassword")}
                                hideLabel={msgStr("digitHidePassword")}
                                errorHtml={usernameHidden ? credentialError : undefined}
                                input={{
                                    name: "password",
                                    autoComplete: "current-password",
                                    autoFocus: usernameHidden
                                }}
                            />
                        </div>

                        {(realm.rememberMe && !usernameHidden) || realm.resetPasswordAllowed ? (
                            <div className="digit-form-row" id="kc-form-options">
                                {realm.rememberMe && !usernameHidden ? (
                                    <label className="digit-checkbox" htmlFor="rememberMe">
                                        <input
                                            id="rememberMe"
                                            name="rememberMe"
                                            type="checkbox"
                                            defaultChecked={!!login.rememberMe}
                                        />
                                        {msg("rememberMe")}
                                    </label>
                                ) : (
                                    <span />
                                )}
                                {realm.resetPasswordAllowed && (
                                    <a className="digit-link" href={url.loginResetCredentialsUrl}>
                                        {msg("doForgotPassword")}
                                    </a>
                                )}
                            </div>
                        ) : null}

                        <div id="kc-form-buttons">
                            <input
                                type="hidden"
                                id="id-hidden-input"
                                name="credentialId"
                                value={auth.selectedCredential}
                            />
                            <button
                                className="digit-button digit-button--primary"
                                name="login"
                                id="kc-login"
                                type="submit"
                                disabled={isSubmitting}
                            >
                                {isSubmitting && (
                                    <span className="digit-spinner" aria-hidden="true" />
                                )}
                                {msgStr("doLogIn")}
                            </button>
                        </div>
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
