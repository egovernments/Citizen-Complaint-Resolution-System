import { useState } from "react";
import type { KcContext } from "../../../login/KcContext";
import { useBranding } from "../../branding/BrandingContext";
import type { DigitPageProps } from "../../shared/kc";

/**
 * The server's rule (DigitPhoneProfileAuthenticator, Keycloak's person-name
 * validator): any Unicode letters, apostrophes, hyphens and so on, minus
 * these prohibited characters, checked after whitespace is collapsed. Java's
 * `\v` and `\p{Cntrl}` are spelled out as code points.
 */
const NAME_PROHIBITED = /[<>&"\n\x0B\f\r\x85\u2028\u2029$%!#?§;*~/\\|^=[\]{}()\x00-\x1F\x7F]/;
const NAME_MAX = 50;
const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");

/**
 * login-phone-profile.ftl (new citizens only): pages/citizen/Login/SelectName.js,
 * which is still the older FormStep card — header, card text, one "Name"
 * field and a right-aligned Next — so this page keeps that look rather than
 * the v2 card of the two steps before it.
 *
 * The name posts as `firstName`; digit-ui asks for a single name.
 */
export default function PhoneProfile(props: DigitPageProps<Extract<KcContext, { pageId: "login-phone-profile.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, messagesPerField } = kcContext;
    const { i18n: digit } = useBranding();

    const [name, setName] = useState(kcContext.firstName ?? "");
    const [touched, setTouched] = useState(messagesPerField.existsError("firstName"));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const trimmed = cleanName(name);
    const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX && !NAME_PROHIBITED.test(trimmed);
    const showError = touched && !valid;

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            variant="formstep"
            displayMessage={!messagesPerField.existsError("firstName")}
            headerNode={digit.t("CS_LOGIN_PROVIDE_NAME")}
        >
            <form
                id="kc-phone-profile-form"
                action={url.loginAction}
                method="post"
                noValidate
                onSubmit={event => {
                    setTouched(true);
                    if (!valid || isSubmitting) {
                        event.preventDefault();
                        return;
                    }
                    const field = event.currentTarget.elements.namedItem("firstName");
                    if (field instanceof HTMLInputElement) field.value = trimmed;
                    setIsSubmitting(true);
                }}
            >
                <div className="dg-formstep">
                    <h1 id="kc-page-title" className="dg-formstep__header">
                        {digit.t("CS_LOGIN_PROVIDE_NAME")}
                    </h1>
                    <p className="dg-formstep__text">{digit.t("CS_LOGIN_NAME_TEXT")}</p>
                    <label className="dg-formstep__label" htmlFor="firstName">
                        {digit.t("CORE_COMMON_NAME")}
                    </label>
                    <div className={`dg-formstep__input${showError ? " is-invalid" : ""}`}>
                        <input
                            id="firstName"
                            name="firstName"
                            type="text"
                            autoComplete="name"
                            maxLength={NAME_MAX}
                            value={name}
                            aria-invalid={showError || undefined}
                            aria-describedby={showError ? "firstName-error" : undefined}
                            onChange={event => setName(event.target.value)}
                            onBlur={() => setTouched(true)}
                        />
                    </div>
                    {showError && (
                        <p id="firstName-error" className="dg-field-error" aria-live="polite">
                            {digit.t("CORE_COMMON_NAME_VALIDMSG")}
                        </p>
                    )}
                    <div className="dg-formstep__actions">
                        <button
                            type="submit"
                            id="login-name-next"
                            className="dg-formstep__submit"
                            disabled={isSubmitting}
                        >
                            <span>{digit.t("CS_COMMONS_NEXT")}</span>
                        </button>
                    </div>
                </div>
            </form>
        </Template>
    );
}
