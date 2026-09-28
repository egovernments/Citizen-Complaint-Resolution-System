import type { ReactElement, ReactNode } from "react";
import type { ClassKey } from "keycloakify/login";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import type { I18n } from "../../login/i18n";
import type { KcContext } from "../../login/KcContext";

/** The six keys the phone/OTP authenticator reports errors with (#2167). */
export const DIGIT_SPI_MESSAGE_KEYS = [
    "digitInvalidPhone",
    "digitInvalidOtp",
    "digitOtpExpired",
    "digitTooManyAttempts",
    "digitResendTooSoon",
    "digitSmsSendFailed"
] as const;

export type DigitSpiMessageKey = (typeof DIGIT_SPI_MESSAGE_KEYS)[number];

/**
 * Which SPI key produced a message. Keycloak only ships the resolved text, so
 * compare it with the same key resolved from the same bundle (the theme's
 * messages, which Keycloak used to resolve it). A realm-level override of the
 * text still matches because both sides read it.
 */
export function spiMessageKey(text: string | undefined, i18n: Pick<I18n, "msgStr">): DigitSpiMessageKey | undefined {
    if (!text) return undefined;
    const normalized = text.trim();
    return DIGIT_SPI_MESSAGE_KEYS.find(key => i18n.msgStr(key).trim() === normalized);
}

export type DigitTemplateProps = TemplateProps<KcContext, I18n> & {
    /** Citizen: sentence under the title. */
    lede?: ReactNode;
    /** Citizen: "card" (SelectMobileNumber/SelectOtp) or the FormStep look (SelectName). */
    variant?: "card" | "formstep";
    /** Toast raised by the page itself (e.g. invalid credentials). */
    toast?: string;
};

export type DigitPageProps<NarrowedKcContext> = Omit<PageProps<NarrowedKcContext, I18n>, "Template"> & {
    Template: (props: DigitTemplateProps) => ReactElement | null;
};

/**
 * Keycloak class keys → this theme's classes, for screens that fall through
 * to Keycloakify's DefaultPage (TOTP setup, user profile, …): they still
 * render inside the DIGIT card instead of the stock Keycloak look.
 */
export const digitClasses: Partial<Record<ClassKey, string>> = {
    kcFormClass: "dg-kc-form",
    kcFormGroupClass: "dg-kc-group",
    kcLabelClass: "dg-label",
    kcLabelWrapperClass: "",
    kcInputWrapperClass: "",
    kcInputClass: "dg-input",
    kcInputLargeClass: "dg-input",
    kcTextareaClass: "dg-input",
    kcInputErrorMessageClass: "dg-field-error",
    kcInputHelperTextBeforeClass: "dg-hint",
    kcInputHelperTextAfterClass: "dg-hint",
    kcFormButtonsClass: "dg-kc-group",
    kcFormOptionsClass: "dg-kc-group",
    kcFormSettingClass: "dg-kc-group",
    kcButtonClass: "dg-button",
    kcButtonPrimaryClass: "",
    kcButtonSecondaryClass: "dg-button--secondary",
    kcButtonDefaultClass: "dg-button--secondary",
    kcButtonBlockClass: "",
    kcButtonLargeClass: "",
    kcCheckboxInputClass: "",
    kcSrOnlyClass: "dg-visually-hidden",
    kcAlertClass: "dg-text",
    kcAlertTitleClass: "",
    kcContentClass: "",
    kcContentWrapperClass: "",
    kcFormAreaClass: "",
    kcFormCardClass: "",
    kcLoginClass: "",
    kcHeaderClass: "",
    kcHeaderWrapperClass: "",
    kcFormHeaderClass: "",
    kcInfoAreaClass: "",
    kcInfoAreaWrapperClass: "",
    kcSignUpClass: ""
};
