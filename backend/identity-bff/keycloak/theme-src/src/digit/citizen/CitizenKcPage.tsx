import { Suspense, lazy } from "react";
import DefaultPage from "keycloakify/login/DefaultPage";
import type { KcContext } from "../../login/KcContext";
import { useI18n } from "../../login/i18n";
import { BrandingProvider } from "../branding/BrandingContext";
import { digitClasses } from "../shared/kc";
import { ErrorPage, Info, LoginPageExpired } from "../shared/MessagePages";
import Template from "./CitizenTemplate";

const UserProfileFormFields = lazy(() => import("keycloakify/login/UserProfileFormFields"));

/**
 * digit-citizen: Keycloak's error/info/expired screens and, through
 * DefaultPage, every other page the citizen client's flow renders (login.ftl
 * included), all in the legacy citizen chrome. Which sign-in methods citizens
 * get is open (#2189).
 */
export default function CitizenKcPage(props: { kcContext: KcContext }) {
    const { kcContext } = props;
    const { i18n } = useI18n({ kcContext });
    const pageProps = { kcContext, i18n, classes: digitClasses, Template, doUseDefaultCss: false } as const;

    return (
        <BrandingProvider
            digitTenant={kcContext.digitTenant}
            loginAction={kcContext.url.loginAction}
            languageTag={kcContext.locale?.currentLanguageTag}
            bffBaseUrl={kcContext.properties.DIGIT_IDENTITY_BFF_BASE_URL}
        >
            <Suspense>
                {(() => {
                    switch (kcContext.pageId) {
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
