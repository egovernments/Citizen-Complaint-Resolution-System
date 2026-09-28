import { useEffect, useRef, useState } from "react";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import type { I18n } from "../../login/i18n";
import { useBranding } from "../branding/BrandingContext";
import { SafeImage, useTenantLabel } from "../components/Chrome";
import { Toast } from "../components/Toast";
import { ServerToast } from "../employee/EmployeeTemplate";
import type { DigitTemplateProps } from "../shared/kc";
import "../styles/digit.css";

/**
 * The citizen chrome around pages/citizen/Login: TopBar (react-components)
 * with the tenant's white logo and name and the language menu, the
 * `.citizen-form-wrapper` page, and the `citizen-home-footer` strip.
 *
 * The hamburger and the notification bell of the legacy top bar are left
 * out: before sign-in the first opens a sidebar with nothing to offer and the
 * second leads to a page that needs a session.
 */
export default function CitizenTemplate(props: DigitTemplateProps) {
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
        lede,
        variant = "card",
        toast,
        children
    } = props;
    const { msgStr, msg } = i18n;
    const { realm, auth, url, message, isAppInitiatedAction } = kcContext;
    const { branding } = useBranding();
    const tenantLabel = useTenantLabel();

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

    const footerSrc = branding?.footer.digitFooter || branding?.footer.digitFooterBw;
    const homeUrl = branding?.footer.digitHomeUrl;

    return (
        <div className="dg-root dg-citizen">
            <div className="dg-navbar">
                <div className="dg-navbar__inner">
                    <div className="dg-navbar__brand">
                        <SafeImage
                            className="dg-navbar__logo"
                            id="topbar-logo"
                            src={branding?.stateInfo.logoUrlWhite || branding?.stateInfo.logoUrl}
                            alt={tenantLabel ?? "DIGIT"}
                        />
                        {tenantLabel !== undefined && <h3 className="dg-navbar__tenant">{tenantLabel}</h3>}
                    </div>
                    <div className="dg-navbar__right">
                        <LanguageMenu i18n={i18n} />
                    </div>
                </div>
            </div>

            <main className="dg-citizen-main">
                {variant === "formstep" ? (
                    <div className="dg-scope dg-formstep-wrapper">{children}</div>
                ) : (
                    <div className="dg-scope dg-citizen-wrapper">
                        <div className="dg-scope dg-citizen-shell">
                            <div className="dg-card dg-card--citizen">
                                <header className="dg-citizen-header">
                                    <h1 id="kc-page-title" className="dg-title dg-title--citizen">
                                        {headerNode}
                                    </h1>
                                    {lede !== undefined && <p className="dg-lede">{lede}</p>}
                                </header>
                                <div id="kc-content">{children}</div>
                                {auth !== undefined && auth.showTryAnotherWayLink && (
                                    <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                                        <input type="hidden" name="tryAnotherWay" value="on" />
                                        <button type="submit" id="try-another-way" className="dg-resend__button">
                                            {msg("doTryAnotherWay")}
                                        </button>
                                    </form>
                                )}
                                {socialProvidersNode}
                                {displayInfo && <div id="kc-info">{infoNode}</div>}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <div className="dg-citizen-footer">
                {footerSrc &&
                    (homeUrl ? (
                        <a href={homeUrl} target="_blank" rel="noopener noreferrer">
                            <SafeImage src={footerSrc} alt="Powered by DIGIT" />
                        </a>
                    ) : (
                        <SafeImage src={footerSrc} alt="Powered by DIGIT" />
                    ))}
            </div>

            {toast !== undefined ? (
                <Toast label={toast} />
            ) : serverToast !== undefined ? (
                <ServerToast type={serverToast.type} html={serverToast.summary} />
            ) : null}
        </div>
    );
}

/**
 * ChangeLanguage in the citizen top bar (hidden at ≤640px, as digit-ui's
 * `mobileView` does). Switching goes through Keycloak's own locale links so
 * the next page, and the branding strings, come back in that language.
 */
function LanguageMenu(props: { i18n: I18n }) {
    const { currentLanguage, enabledLanguages } = props.i18n;
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    if (enabledLanguages.length === 0) return null;

    return (
        <div className="dg-lang" ref={ref} id="kc-locale">
            <button
                type="button"
                className="dg-lang__trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <span>{currentLanguage.label}</span>
                <svg className="dg-lang__arrow" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 10l5 5 5-5z" />
                </svg>
            </button>
            {open && (
                <ul className="dg-lang__menu" role="listbox">
                    {enabledLanguages.map(language => (
                        <li key={language.languageTag}>
                            <a
                                href={language.href}
                                aria-current={language.languageTag === currentLanguage.languageTag}
                                lang={language.languageTag}
                            >
                                {language.label}
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
