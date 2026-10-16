import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * login-idp-link-confirm-override.ftl — re-linking an identity that is already
 * linked to another provider account.
 */
export default function LoginIdpLinkConfirmOverride(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-idp-link-confirm-override.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, idpDisplayName } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitAccount")}
            headerNode={msg("confirmOverrideIdpTitle")}
        >
            <form id="kc-register-form" className="digit-section" action={url.loginAction} method="post">
                <p className="digit-lede">
                    {msg("pageExpiredMsg1")}{" "}
                    <a id="loginRestartLink" className="digit-link" href={url.loginRestartFlowUrl}>
                        {msg("doClickHere")}
                    </a>
                </p>
                <button
                    type="submit"
                    className="digit-button digit-button--primary"
                    name="submitAction"
                    id="confirmOverride"
                    value="confirmOverride"
                >
                    {msg("confirmOverrideIdpContinue", idpDisplayName)}
                </button>
            </form>
        </Template>
    );
}
