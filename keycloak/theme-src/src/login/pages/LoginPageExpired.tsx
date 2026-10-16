import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * login-page-expired.ftl — the expired authentication session. Both of
 * Keycloak's recovery routes are kept, as buttons rather than inline links,
 * because this is the one page where the action is the whole content.
 */
export default function LoginPageExpired(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-page-expired.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitSessionEyebrow")}
            headerNode={msg("pageExpiredTitle")}
        >
            <div className="digit-section">
                <p className="digit-lede" id="instruction1">
                    {msg("pageExpiredMsg1")}
                </p>
                <a
                    id="loginRestartLink"
                    className="digit-button digit-button--primary"
                    href={url.loginRestartFlowUrl}
                >
                    {msg("doClickHere")}
                </a>
                <p className="digit-lede">{msg("pageExpiredMsg2")}</p>
                <a
                    id="loginContinueLink"
                    className="digit-button digit-button--outline"
                    href={url.loginAction}
                >
                    {msg("doClickHere")}
                </a>
            </div>
        </Template>
    );
}
