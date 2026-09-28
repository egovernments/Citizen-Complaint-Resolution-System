import { useMemo, useState } from "react";
import { Phone } from "lucide-react";
import type { KcContext } from "../../../login/KcContext";
import { useBranding } from "../../branding/BrandingContext";
import {
    DEFAULT_MOBILE_PATTERN,
    DEFAULT_MOBILE_PREFIX,
    buildMobileErrorMessage,
    computeMobileLengths
} from "../../shared/mobileValidation";
import { spiMessageKey, type DigitPageProps } from "../../shared/kc";

function safeRegExp(pattern: string): RegExp {
    try {
        return new RegExp(pattern);
    } catch {
        return new RegExp(DEFAULT_MOBILE_PATTERN);
    }
}

/**
 * login-phone-number.ftl: pages/citizen/Login/SelectMobileNumber.js.
 *
 * The rule comes from the SPI's `countryCode`/`mobileNumberRegex` (the same
 * MobileNumberValidation record the BFF serves), then the branding document,
 * then digit-ui's constants — the order SelectMobileNumber.js resolves it.
 * The hint under the field is always visible and turns red when the number
 * does not match, exactly as in digit-ui. Keycloak re-checks it server-side.
 */
export default function PhoneNumber(props: DigitPageProps<Extract<KcContext, { pageId: "login-phone-number.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, message, messagesPerField } = kcContext;
    const { branding, i18n: digit } = useBranding();

    const rawPattern =
        kcContext.mobileNumberRegex || branding?.mobileValidation?.mobileNumberRegex || DEFAULT_MOBILE_PATTERN;
    const prefix = kcContext.countryCode || branding?.mobileValidation?.countryCode || DEFAULT_MOBILE_PREFIX;
    const pattern = useMemo(() => safeRegExp(rawPattern), [rawPattern]);
    const { max } = useMemo(() => computeMobileLengths(rawPattern), [rawPattern]);
    const maxLength = max > 0 ? max : 15;
    const hint = useMemo(
        () => buildMobileErrorMessage(rawPattern, (key, fallback) => digit.tr(key, fallback)),
        [rawPattern, digit]
    );

    const serverSaysInvalid =
        messagesPerField.existsError("phoneNumber") || spiMessageKey(message?.summary, i18n) === "digitInvalidPhone";

    const [value, setValue] = useState(kcContext.phoneNumber ?? "");
    const [error, setError] = useState(serverSaysInvalid);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isValid = pattern.test(value);

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!serverSaysInvalid}
            headerNode={digit.t("CS_LOGIN_PROVIDE_MOBILE_NUMBER")}
            lede={digit.t("CS_LOGIN_TEXT")}
        >
            <form
                id="kc-phone-number-form"
                className="dg-form dg-form--citizen"
                action={url.loginAction}
                method="post"
                noValidate
                onSubmit={event => {
                    if (!isValid || isSubmitting) {
                        event.preventDefault();
                        setError(true);
                        return;
                    }
                    setIsSubmitting(true);
                }}
            >
                <div className="dg-field">
                    <label className="dg-label" htmlFor="login-mobile">
                        {digit.t("CORE_COMMON_MOBILE_NUMBER")}
                        <span className="dg-label__required" aria-hidden="true">
                            *
                        </span>
                    </label>
                    <div className={`dg-phone${error ? " is-invalid" : ""}`}>
                        <span className="dg-phone__prefix" id="login-mobile-prefix">
                            <Phone aria-hidden="true" />
                            {prefix}
                        </span>
                        <input
                            id="login-mobile"
                            name="phoneNumber"
                            className="dg-phone__input"
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="tel-national"
                            maxLength={maxLength}
                            value={value}
                            aria-invalid={error || undefined}
                            aria-describedby="login-mobile-hint login-mobile-prefix"
                            onChange={event => {
                                const next = event.target.value.replace(/\D/g, "").slice(0, maxLength);
                                setValue(next);
                                setError(next !== "" && !pattern.test(next));
                            }}
                        />
                    </div>
                    <p id="login-mobile-hint" className={`dg-hint${error ? " is-error" : ""}`} aria-live="polite">
                        {hint}
                    </p>
                </div>
                <button className="dg-button" id="kc-login" type="submit" disabled={!isValid || isSubmitting}>
                    {isSubmitting && <span className="dg-spinner" aria-hidden="true" />}
                    {digit.t("CS_COMMONS_NEXT")}
                </button>
            </form>
        </Template>
    );
}
