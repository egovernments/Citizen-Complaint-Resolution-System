import { Suspense, lazy } from "react";
import DefaultPage from "keycloakify/login/DefaultPage";
import type { KcContext } from "./KcContext";
import { useI18n } from "./i18n";
import { classes } from "./classes";
import Template from "./Template";
import "./styles/theme.css";

const UserProfileFormFields = lazy(() => import("keycloakify/login/UserProfileFormFields"));

const Login = lazy(() => import("./pages/Login"));
const LoginUsername = lazy(() => import("./pages/LoginUsername"));
const LoginPassword = lazy(() => import("./pages/LoginPassword"));
const LoginResetPassword = lazy(() => import("./pages/LoginResetPassword"));
const LoginUpdatePassword = lazy(() => import("./pages/LoginUpdatePassword"));
const LoginVerifyEmail = lazy(() => import("./pages/LoginVerifyEmail"));
const LoginIdpLinkConfirm = lazy(() => import("./pages/LoginIdpLinkConfirm"));
const LoginIdpLinkConfirmOverride = lazy(() => import("./pages/LoginIdpLinkConfirmOverride"));
const LoginIdpLinkEmail = lazy(() => import("./pages/LoginIdpLinkEmail"));
const LoginPageExpired = lazy(() => import("./pages/LoginPageExpired"));
const Info = lazy(() => import("./pages/Info"));
const Error = lazy(() => import("./pages/Error"));

const doMakeUserConfirmPassword = true;

/**
 * Every page reachable from the supported password journey is overridden.
 * Anything else still renders through `DefaultPage`, but inside this theme's
 * Template and with this theme's class map, so no screen drops to the stock
 * Keycloak appearance.
 */
export default function KcPage(props: { kcContext: KcContext }) {
    const { kcContext } = props;
    const { i18n } = useI18n({ kcContext });

    const pageProps = {
        kcContext,
        i18n,
        classes,
        Template,
        doUseDefaultCss: false
    } as const;

    return (
        <Suspense>
            {(() => {
                switch (kcContext.pageId) {
                    case "login.ftl":
                        return <Login {...pageProps} kcContext={kcContext} />;
                    case "login-username.ftl":
                        return <LoginUsername {...pageProps} kcContext={kcContext} />;
                    case "login-password.ftl":
                        return <LoginPassword {...pageProps} kcContext={kcContext} />;
                    case "login-reset-password.ftl":
                        return <LoginResetPassword {...pageProps} kcContext={kcContext} />;
                    case "login-update-password.ftl":
                        return <LoginUpdatePassword {...pageProps} kcContext={kcContext} />;
                    case "login-verify-email.ftl":
                        return <LoginVerifyEmail {...pageProps} kcContext={kcContext} />;
                    case "login-idp-link-confirm.ftl":
                        return <LoginIdpLinkConfirm {...pageProps} kcContext={kcContext} />;
                    case "login-idp-link-confirm-override.ftl":
                        return <LoginIdpLinkConfirmOverride {...pageProps} kcContext={kcContext} />;
                    case "login-idp-link-email.ftl":
                        return <LoginIdpLinkEmail {...pageProps} kcContext={kcContext} />;
                    case "login-page-expired.ftl":
                        return <LoginPageExpired {...pageProps} kcContext={kcContext} />;
                    case "info.ftl":
                        return <Info {...pageProps} kcContext={kcContext} />;
                    case "error.ftl":
                        return <Error {...pageProps} kcContext={kcContext} />;
                    default:
                        return (
                            <DefaultPage
                                {...pageProps}
                                kcContext={kcContext}
                                UserProfileFormFields={UserProfileFormFields}
                                doMakeUserConfirmPassword={doMakeUserConfirmPassword}
                            />
                        );
                }
            })()}
        </Suspense>
    );
}
