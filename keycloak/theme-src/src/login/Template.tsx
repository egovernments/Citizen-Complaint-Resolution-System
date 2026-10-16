import { useEffect, type ReactNode } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import { RotateCcw } from "lucide-react";
import type { I18n } from "./i18n";
import type { KcContext } from "./KcContext";
import { getBrand } from "./brand";
import { AuthBackdrop, RotatingNarrative } from "./components/AuthBackdrop";
import { Alert, type AlertKind } from "./components/Alert";
import "./styles/theme.css";

export type DigitTemplateProps = TemplateProps<KcContext, I18n> & {
    /** Small caps line above the title, e.g. "Welcome back". */
    eyebrow?: ReactNode;
    /** Sentence under the title. */
    lede?: ReactNode;
    /** Heading for Keycloak's server message, when a page wants its own. */
    messageTitle?: ReactNode;
};

const ALERT_KIND: Record<string, AlertKind> = {
    error: "error",
    success: "success",
    warning: "warning",
    info: "info"
};

const ALERT_TITLE = {
    error: "digitErrorTitle",
    success: "digitSuccessTitle",
    warning: "digitWarningTitle",
    info: "digitInfoTitle"
} as const;

/**
 * The Configurator's `AuthShell`, rendered for Keycloak-owned screens.
 *
 * Everything Keycloak's own template is responsible for is still here — the
 * locale switch, the attempted-username/restart control, the server message,
 * "try another way", the info area — only the frame around them changed. The
 * security boundary is untouched: pages still post to `url.loginAction` with
 * Keycloak's own hidden fields.
 */
export default function Template(props: DigitTemplateProps) {
    const {
        displayInfo = false,
        displayMessage = true,
        displayRequiredFields = false,
        headerNode,
        socialProvidersNode = null,
        infoNode = null,
        documentTitle,
        kcContext,
        i18n,
        doUseDefaultCss,
        eyebrow,
        lede,
        messageTitle,
        children
    } = props;

    const { msg, msgStr, currentLanguage, enabledLanguages } = i18n;
    const { realm, auth, url, message, isAppInitiatedAction } = kcContext;
    const brand = getBrand(kcContext);

    useEffect(() => {
        document.title = documentTitle ?? msgStr("loginTitle", realm.displayName || realm.name);
    }, [documentTitle]);

    useSetClassName({ qualifiedName: "html", className: "digit-auth-html" });
    useSetClassName({ qualifiedName: "body", className: "digit-auth-body" });

    // Keycloak-owned scripts (passkeys, authChecker) still have to be inserted;
    // `doUseDefaultCss` is false so none of the stock stylesheets come with it.
    const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });

    if (!isReadyToRender) {
        return null;
    }

    const showAttemptedUsername =
        auth !== undefined && auth.showUsername && !auth.showResetCredentials;

    return (
        <div className="digit-shell">
            <div className="digit-brand">
                <AuthBackdrop brand={brand} />

                <div className="digit-brand__top">
                    <img
                        src={brand.logoUrl}
                        alt="eGov Foundation"
                        width={180}
                        height={37}
                        className="digit-brand__logo"
                    />
                    <div>
                        <p className="digit-brand__product">{brand.appName}</p>
                        <p className="digit-brand__tagline">
                            Digital infrastructure for public services
                        </p>
                    </div>
                </div>

                <div className="digit-brand__body">
                    <p className="digit-brand__headline">
                        Manage complaints from intake to closure.
                    </p>
                    <p className="digit-brand__lede">
                        Set up your account to receive complaints, assign them to the right team,
                        track service timelines, record actions and evidence, and monitor resolution
                        across departments and localities.
                    </p>
                    <RotatingNarrative />
                </div>

                <p className="digit-brand__foot">© 2026 eGovernments Foundation · DIGIT</p>
            </div>

            <main id="main-content" className="digit-main">
                <div className="digit-card">
                    <div className="digit-card__stack">
                        {enabledLanguages.length > 1 && (
                            <div className="digit-locale" id="kc-locale">
                                <label className="digit-visually-hidden" htmlFor="kc-locale-select">
                                    {msgStr("languages")}
                                </label>
                                <select
                                    id="kc-locale-select"
                                    value={currentLanguage.languageTag}
                                    onChange={event => {
                                        const target = enabledLanguages.find(
                                            language => language.languageTag === event.target.value
                                        );
                                        if (target !== undefined) {
                                            window.location.href = target.href;
                                        }
                                    }}
                                >
                                    {enabledLanguages.map(({ languageTag, label }) => (
                                        <option key={languageTag} value={languageTag}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <header>
                            {eyebrow !== undefined && <p className="digit-eyebrow">{eyebrow}</p>}
                            <h1 id="kc-page-title" className="digit-title">
                                {headerNode}
                            </h1>
                            {lede !== undefined && <p className="digit-lede">{lede}</p>}
                            {displayRequiredFields && (
                                <p className="digit-note">
                                    <span aria-hidden="true">*</span> {msg("requiredFields")}
                                </p>
                            )}
                            {showAttemptedUsername && (
                                <p className="digit-lede" id="kc-username">
                                    <span id="kc-attempted-username">{auth.attemptedUsername}</span>{" "}
                                    <a
                                        id="reset-login"
                                        className="digit-link"
                                        href={url.loginRestartFlowUrl}
                                        aria-label={msgStr("restartLoginTooltip")}
                                    >
                                        <RotateCcw size={14} aria-hidden="true" />{" "}
                                        {msg("restartLoginTooltip")}
                                    </a>
                                </p>
                            )}
                        </header>

                        {/* App-initiated actions should not see warning messages about the
                            need to complete the action during login. */}
                        {displayMessage &&
                            message !== undefined &&
                            (message.type !== "warning" || !isAppInitiatedAction) && (
                                <Alert
                                    kind={ALERT_KIND[message.type] ?? "info"}
                                    title={
                                        messageTitle ??
                                        msg(ALERT_TITLE[message.type] ?? "digitInfoTitle")
                                    }
                                    html={kcSanitize(message.summary)}
                                />
                            )}

                        <div id="kc-content">{children}</div>

                        {auth !== undefined && auth.showTryAnotherWayLink && (
                            <form
                                id="kc-select-try-another-way-form"
                                action={url.loginAction}
                                method="post"
                            >
                                <input type="hidden" name="tryAnotherWay" value="on" />
                                <button type="submit" id="try-another-way" className="digit-link digit-link--block">
                                    {msg("doTryAnotherWay")}
                                </button>
                            </form>
                        )}

                        {socialProvidersNode}

                        {displayInfo && <div id="kc-info">{infoNode}</div>}
                    </div>
                </div>
            </main>
        </div>
    );
}
