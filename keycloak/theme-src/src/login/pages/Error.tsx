import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { DigitPageProps } from "../pageProps";
import type { KcContext } from "../KcContext";
import { Alert } from "../components/Alert";

/**
 * error.ftl — the generic authentication error, including an expired or
 * already-used action link.
 */
export default function Error(props: DigitPageProps<Extract<KcContext, { pageId: "error.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { message, client, skipLink } = kcContext;
    const { msg } = i18n;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={false}
            eyebrow={msg("digitSessionEyebrow")}
            headerNode={msg("errorTitle")}
        >
            <div id="kc-error-message" className="digit-section">
                <Alert
                    kind="error"
                    title={msg("digitErrorTitle")}
                    html={kcSanitize(message.summary)}
                />
                {!skipLink && !!client?.baseUrl && (
                    <a
                        id="backToApplication"
                        className="digit-button digit-button--outline"
                        href={client.baseUrl}
                    >
                        {msg("backToApplication")}
                    </a>
                )}
            </div>
        </Template>
    );
}
