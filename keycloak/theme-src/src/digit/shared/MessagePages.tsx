import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { KcContext } from "../../login/KcContext";
import { useBranding } from "../branding/BrandingContext";
import type { DigitPageProps } from "./kc";
import { isLostSessionMessage } from "./lostSession";

/**
 * info.ftl — "we have sent you something" / "you are done here", in the
 * legacy employee card. Keycloak's own text, since digit-ui has no screen
 * for these states. With no redirect, the way back is the tenant's own
 * sign-in (`signInUrl`) when this tab knows the tenant.
 */
export function Info(
    props: DigitPageProps<Extract<KcContext, { pageId: "info.ftl" }>> & {
        signInUrl?: (slug: string, baseUrl: string | undefined) => string | undefined;
    }
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes, signInUrl } = props;
    const { messageHeader, message, requiredActions, skipLink, pageRedirectUri, actionUri, client } = kcContext;
    const { advancedMsgStr, msg } = i18n;
    const { slug } = useBranding();
    const baseUrl = (slug && signInUrl?.(slug, client.baseUrl)) || client.baseUrl;

    const bodyHtml = (() => {
        let html = message.summary?.trim() ?? "";
        if (requiredActions) {
            html += ` <b>${requiredActions
                .map(requiredAction => advancedMsgStr(`requiredAction.${requiredAction}`))
                .join(", ")}</b>`;
        }
        return kcSanitize(html);
    })();

    const next = skipLink
        ? null
        : pageRedirectUri
          ? { href: pageRedirectUri, label: msg("backToApplication") }
          : actionUri
            ? { href: actionUri, label: msg("proceedWithAction") }
            : baseUrl
              ? { href: baseUrl, label: msg("backToApplication") }
              : null;

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
                        __html: kcSanitize(messageHeader ? advancedMsgStr(messageHeader) : message.summary)
                    }}
                />
            }
        >
            <div id="kc-info-message" className="dg-form dg-form--message">
                <p className="dg-text" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                {next !== null && (
                    <a className="dg-button" href={next.href}>
                        {next.label}
                    </a>
                )}
            </div>
        </Template>
    );
}

/**
 * error.ftl — raised as the legacy error toast, with the way back. A lost
 * sign-in session (lostSession.ts) offers to start again: at the tenant's own
 * sign-in (`signInUrl`, given by the surface's page) when this tab knows the
 * tenant, else at the client's base URL.
 */
export function ErrorPage(
    props: DigitPageProps<Extract<KcContext, { pageId: "error.ftl" }>> & {
        signInUrl?: (slug: string, baseUrl: string | undefined) => string | undefined;
    }
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes, signInUrl } = props;
    const { message, client, skipLink } = kcContext;
    const { msg, msgStr } = i18n;
    const { slug } = useBranding();
    const next = isLostSessionMessage(message.summary, msgStr)
        ? {
              id: "restartSignIn",
              href: (slug && signInUrl?.(slug, client?.baseUrl)) || client?.baseUrl,
              label: msg("digitStartSignInAgain")
          }
        : { id: "backToApplication", href: client?.baseUrl, label: msg("backToApplication") };

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={false}
            headerNode={msg("errorTitle")}
        >
            <div id="kc-error-message" className="dg-form dg-form--message">
                <p
                    className="dg-text"
                    dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
                />
                {!skipLink && !!next.href && (
                    <a id={next.id} className="dg-button" href={next.href}>
                        {next.label}
                    </a>
                )}
            </div>
        </Template>
    );
}

/** login-page-expired.ftl — both of Keycloak's recovery routes. */
export function LoginPageExpired(props: DigitPageProps<Extract<KcContext, { pageId: "login-page-expired.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url } = kcContext;
    const { msg } = i18n;
    const { i18n: digit } = useBranding();

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            headerNode={msg("pageExpiredTitle")}
        >
            <div className="dg-form dg-form--message">
                <p className="dg-text" id="instruction1">
                    {msg("pageExpiredMsg1")}
                </p>
                <a id="loginRestartLink" className="dg-button" href={url.loginRestartFlowUrl}>
                    {digit.t("CORE_COMMON_LOGIN")}
                </a>
                <p className="dg-text">{msg("pageExpiredMsg2")}</p>
                <a id="loginContinueLink" className="dg-button dg-button--secondary" href={url.loginAction}>
                    {digit.t("CORE_COMMON_CONTINUE")}
                </a>
            </div>
        </Template>
    );
}
