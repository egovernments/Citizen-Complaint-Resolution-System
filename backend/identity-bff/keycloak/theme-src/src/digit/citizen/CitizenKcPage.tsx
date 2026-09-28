import { Suspense, lazy } from "react";
import DefaultPage from "keycloakify/login/DefaultPage";
import type { KcContext } from "../../login/KcContext";
import { useI18n } from "../../login/i18n";
import { BrandingProvider } from "../branding/BrandingContext";
import { digitClasses } from "../shared/kc";
import { ErrorPage, Info, LoginPageExpired } from "../shared/MessagePages";
import Template from "./CitizenTemplate";
import PhoneNumber from "./pages/PhoneNumber";
import SmsOtp from "./pages/SmsOtp";
import PhoneProfile from "./pages/PhoneProfile";

const UserProfileFormFields = lazy(() => import("keycloakify/login/UserProfileFormFields"));

/**
 * digit-citizen: the digit-citizen-browser flow — phone number, SMS OTP and,
 * for a first sign-in, the name step — plus Keycloak's error/info/expired
 * screens, all in the legacy citizen chrome.
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
                        case "login-phone-number.ftl":
                            return <PhoneNumber {...pageProps} kcContext={kcContext} />;
                        case "login-sms-otp.ftl":
                            return <SmsOtp {...pageProps} kcContext={kcContext} />;
                        case "login-phone-profile.ftl":
                            return <PhoneProfile {...pageProps} kcContext={kcContext} />;
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
