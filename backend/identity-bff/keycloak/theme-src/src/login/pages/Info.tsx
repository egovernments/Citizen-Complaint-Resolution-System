import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";

/**
 * info.ftl — every "we have sent you something" / "you are done here" page,
 * including the one shown after a required action completes.
 */
export default function Info(props: DigitPageProps<Extract<KcContext, { pageId: "info.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { messageHeader, message, requiredActions, skipLink, pageRedirectUri, actionUri, client } =
        kcContext;
    const { advancedMsgStr, msg } = i18n;

    const bodyHtml = (() => {
        let html = message.summary?.trim() ?? "";
        if (requiredActions) {
            html += ` <b>${requiredActions
                .map(requiredAction => advancedMsgStr(`requiredAction.${requiredAction}`))
                .join(", ")}</b>`;
        }
        return kcSanitize(html);
    })();

    const back = (() => {
        if (skipLink) {
            return null;
        }
        if (pageRedirectUri) {
            return { href: pageRedirectUri, label: msg("backToApplication") };
        }
        if (actionUri) {
            return { href: actionUri, label: msg("proceedWithAction") };
        }
        if (client.baseUrl) {
            return { href: client.baseUrl, label: msg("backToApplication") };
        }
        return null;
    })();

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={false}
            headerNode={
                <span
                    dangerouslySetInnerHTML={{
                        __html: kcSanitize(
                            messageHeader ? advancedMsgStr(messageHeader) : message.summary
                        )
                    }}
                />
            }
        >
            <div id="kc-info-message" className="digit-section">
                <p className="digit-lede" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                {back !== null && (
                    <a className="digit-button digit-button--outline" href={back.href}>
                        {back.label}
                    </a>
                )}
            </div>
        </Template>
    );
}
