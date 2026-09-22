import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";
import { Field } from "../components/Field";

/**
 * login-reset-password.ftl — Keycloak's forgotten-password initiation.
 *
 * The DIGIT realm normally keeps `resetPasswordAllowed=false` and recovery
 * runs through the Configurator's non-enumerating password-setup request, so
 * this screen is only reachable where an operator has turned Keycloak's own
 * reset back on. It is themed all the same: #2108 requires that no reachable
 * screen falls back to the stock appearance. The closing note repeats the
 * Configurator's non-enumerating wording.
 */
export default function LoginResetPassword(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-reset-password.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, realm, auth, messagesPerField } = kcContext;
    const { msg, msgStr } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!messagesPerField.existsError("username")}
            eyebrow={msg("digitAccount")}
            headerNode={msg("emailForgotTitle")}
            lede={realm.duplicateEmailsAllowed ? msg("emailInstructionUsername") : msg("emailInstruction")}
        >
            <form
                id="kc-reset-password-form"
                className="digit-section"
                action={url.loginAction}
                method="post"
                noValidate
            >
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
                            ? kcSanitize(messagesPerField.get("username"))
                            : undefined
                    }
                    input={{
                        name: "username",
                        type: "text",
                        autoFocus: true,
                        autoComplete: "username",
                        defaultValue: auth.attemptedUsername ?? ""
                    }}
                />

                <button className="digit-button digit-button--primary" type="submit">
                    {msgStr("doSubmit")}
                </button>

                <p className="digit-note">{msg("digitNonEnumerating")}</p>

                <p className="digit-footnote">
                    <a className="digit-link" href={url.loginUrl}>
                        {msg("backToLogin")}
                    </a>
                </p>
            </form>
        </Template>
    );
}
