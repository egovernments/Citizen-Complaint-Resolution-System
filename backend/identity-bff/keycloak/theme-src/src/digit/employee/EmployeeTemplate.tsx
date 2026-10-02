import { useEffect } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import { useBranding } from "../branding/BrandingContext";
import { PoweredByDigit, TenantHeader } from "../components/Chrome";
import { Carousel, bannerImagesOf } from "../components/Carousel";
import { Toast } from "../components/Toast";
import type { DigitTemplateProps } from "../shared/kc";
import "../styles/digit.css";

/**
 * pages/employee/Login/login.js — V2LoginShell + V2Card — for every screen
 * Keycloak shows in the digit-employee flow.
 *
 * Keycloak's own template duties are kept: the page title, the scripts it
 * needs (useInitialize), the server message, "try another way", identity
 * providers and the info area. The server message is raised the way the
 * legacy page raises errors: a toast at the bottom of the viewport.
 */
export default function EmployeeTemplate(props: DigitTemplateProps) {
    const {
        displayInfo = false,
        displayMessage = true,
        headerNode,
        socialProvidersNode = null,
        infoNode = null,
        documentTitle,
        kcContext,
        i18n,
        doUseDefaultCss,
        toast,
        children
    } = props;
    const { msgStr, msg } = i18n;
    const { realm, auth, url, message, isAppInitiatedAction } = kcContext;
    const { branding } = useBranding();

    useEffect(() => {
        document.title = documentTitle ?? msgStr("loginTitle", realm.displayName || realm.name);
    }, [documentTitle]);

    useSetClassName({ qualifiedName: "html", className: "dg-html" });
    useSetClassName({ qualifiedName: "body", className: "dg-body" });

    const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
    if (!isReadyToRender) return null;

    const serverToast =
        displayMessage && message !== undefined && (message.type !== "warning" || !isAppInitiatedAction)
            ? message
            : undefined;

    const card = (
        <div className="dg-card dg-card--employee">
            <TenantHeader />
            <header>
                <h1 id="kc-page-title" className="dg-title dg-title--employee">
                    {headerNode}
                </h1>
            </header>
            <div id="kc-content">{children}</div>
            {auth !== undefined && auth.showTryAnotherWayLink && (
                <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                    <input type="hidden" name="tryAnotherWay" value="on" />
                    <button type="submit" id="try-another-way" className="dg-link dg-forgot">
                        {msg("doTryAnotherWay")}
                    </button>
                </form>
            )}
            {socialProvidersNode}
            {displayInfo && <div id="kc-info">{infoNode}</div>}
        </div>
    );

    const bannerImages = bannerImagesOf(branding?.loginConfig);

    return (
        <div className="dg-root dg-employee">
            {bannerImages !== undefined ? (
                <div className="dg-scope dg-carousel-shell">
                    <div className="dg-carousel-shell__media">
                        <Carousel images={bannerImages} />
                    </div>
                    <div className="dg-carousel-shell__form">
                        {card}
                        <PoweredByDigit className="dg-employee-footer" onDarkSurface={false} />
                    </div>
                </div>
            ) : (
                <div className="dg-banner">
                    <div className="dg-scope dg-banner__shell">{card}</div>
                    <PoweredByDigit className="dg-employee-footer" />
                </div>
            )}
            {toast !== undefined ? (
                <Toast label={toast} />
            ) : serverToast !== undefined ? (
                <ServerToast type={serverToast.type} html={serverToast.summary} />
            ) : null}
        </div>
    );
}

/** Keycloak's message (already localized by Keycloak), as a toast. */
export function ServerToast(props: { type: string; html: string }) {
    // Keycloak messages can carry markup; the toast shows text only.
    const text = (() => {
        const sanitized = kcSanitize(props.html);
        if (typeof document === "undefined") return sanitized;
        const el = document.createElement("div");
        el.innerHTML = sanitized;
        return el.textContent ?? sanitized;
    })();
    return <Toast label={text} kind={props.type === "error" || props.type === "warning" ? "error" : "info"} />;
}
