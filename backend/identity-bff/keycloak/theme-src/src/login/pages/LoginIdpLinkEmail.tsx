import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * login-idp-link-email.ftl — Keycloak has emailed a link that proves the
 * address belongs to the person before the provider account is linked.
 */
export default function LoginIdpLinkEmail(
    props: DigitPageProps<Extract<KcContext, { pageId: "login-idp-link-email.ftl" }>>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, realm, brokerContext, idpAlias } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            eyebrow={msg("digitVerification")}
            headerNode={msg("emailLinkIdpTitle", idpAlias)}
            lede={msg("emailLinkIdp1", idpAlias, brokerContext.username, realm.displayName)}
        >
            <div className="digit-section">
                <p className="digit-note" id="instruction2">
                    {msg("emailLinkIdp2")}{" "}
                    <a className="digit-link" href={url.loginAction}>
                        {msg("doClickHere")}
                    </a>{" "}
                    {msg("emailLinkIdp3")}
                </p>
                <p className="digit-note" id="instruction3">
                    {msg("emailLinkIdp4")}{" "}
                    <a className="digit-link" href={url.loginAction}>
                        {msg("doClickHere")}
                    </a>{" "}
                    {msg("emailLinkIdp5")}
                </p>
            </div>
        </Template>
    );
}
