import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * login-idp-link-confirm.ftl — the account-conflict screen: someone signed in
 * with Google or GitHub for an address that already exists in the realm.
 *
 * The copy is Keycloak's, which states the conflict without confirming
 * anything about the other account's sign-in methods. Linking stays an explicit
 * choice; a matching email is never treated as proof on its own.
 */
export default function LoginIdpLinkConfirm(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-idp-link-confirm.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, idpAlias } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitAccount")}
            headerNode={msg("confirmLinkIdpTitle")}
        >
            <form id="kc-register-form" className="digit-stack-sm" action={url.loginAction} method="post">
                <button
                    type="submit"
                    className="digit-button digit-button--primary"
                    name="submitAction"
                    id="linkAccount"
                    value="linkAccount"
                >
                    {msg("confirmLinkIdpContinue", idpAlias)}
                </button>
                <button
                    type="submit"
                    className="digit-button digit-button--outline"
                    name="submitAction"
                    id="updateProfile"
                    value="updateProfile"
                >
                    {msg("confirmLinkIdpReviewProfile")}
                </button>
            </form>
        </Template>
    );
}
