import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * login-verify-email.ftl — the VERIFY_EMAIL required action, which the
 * password-setup email pairs with UPDATE_PASSWORD for an unverified address.
 */
export default function LoginVerifyEmail(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-verify-email.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, user } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitVerification")}
            headerNode={msg("emailVerifyTitle")}
            lede={msg("emailVerifyInstruction1", user?.email ?? "")}
        >
            <p className="digit-note">
                {msg("emailVerifyInstruction2")}{" "}
                <a className="digit-link" href={url.loginAction}>
                    {msg("doClickHere")}
                </a>{" "}
                {msg("emailVerifyInstruction3")}
            </p>
        </Template>
    );
}
