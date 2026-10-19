import { Suspense, lazy, useMemo } from "react";
import DefaultPage from "keycloakify/login/DefaultPage";
import type { KcContext } from "../../login/KcContext";
import { useI18n } from "../../login/i18n";
import { BrandingProvider } from "../branding/BrandingContext";
import { digitClasses } from "../shared/kc";
import { ErrorPage, Info, LoginPageExpired } from "../shared/MessagePages";
import Template from "./EmployeeTemplate";
import Login from "./pages/Login";
import { LoginResetPassword, LoginUpdatePassword } from "./pages/PasswordPages";

const UserProfileFormFields = lazy(() => import("keycloakify/login/UserProfileFormFields"));

/**
 * digit-employee: the digit-employee-browser flow (username + password) and
 * the screens Keycloak can show around it. Anything not listed renders
 * through DefaultPage inside the same legacy card and class map, so no screen
 * of this flow drops to the stock Keycloak look.
 */
export default function EmployeeKcPage(props: { kcContext: KcContext }) {
    const { kcContext } = props;
    const footer = useMemo(() => ({
        digitFooter: kcContext.properties.DIGIT_FOOTER_URL,
        digitFooterBw: kcContext.properties.DIGIT_FOOTER_BW_URL,
        digitHomeUrl: kcContext.properties.DIGIT_HOME_URL
    }), [kcContext.properties]);
    const { i18n } = useI18n({ kcContext });
    const pageProps = { kcContext, i18n, classes: digitClasses, Template, doUseDefaultCss: false } as const;

    return (
        <BrandingProvider
            digitTenant={kcContext.digitTenant}
            loginAction={kcContext.url.loginAction}
            languageTag={kcContext.locale?.currentLanguageTag}
            footer={footer}
            publicApiBaseUrl={kcContext.properties.DIGIT_PUBLIC_API_BASE_URL}
            mdmsPath={kcContext.properties.DIGIT_MDMS_SEARCH_PATH}
            configModule={kcContext.properties.DIGIT_UI_CONFIG_MODULE_NAME}
            defaultLocale={kcContext.properties.DIGIT_DEFAULT_LOCALE}
            bffBaseUrl={kcContext.properties.DIGIT_IDENTITY_BFF_BASE_URL}
        >
            <Suspense>
                {(() => {
                    switch (kcContext.pageId) {
                        case "login.ftl":
                            return <Login {...pageProps} kcContext={kcContext} />;
                        case "login-reset-password.ftl":
                            return <LoginResetPassword {...pageProps} kcContext={kcContext} />;
                        case "login-update-password.ftl":
                            return <LoginUpdatePassword {...pageProps} kcContext={kcContext} />;
                        case "login-page-expired.ftl":
                            return <LoginPageExpired {...pageProps} kcContext={kcContext} />;
                        case "info.ftl":
                            return <Info {...pageProps} kcContext={kcContext} />;
                        case "error.ftl":
                            return <ErrorPage {...pageProps} kcContext={kcContext} />;
                        default:
                            return (
                                <DefaultPage
                                    {...pageProps}
                                    kcContext={kcContext}
                                    Template={Template as never}
                                    UserProfileFormFields={UserProfileFormFields}
                                    doMakeUserConfirmPassword
                                />
                            );
                    }
                })()}
            </Suspense>
        </BrandingProvider>
    );
}
