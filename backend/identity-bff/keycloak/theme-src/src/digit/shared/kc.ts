import type { ReactElement, ReactNode } from "react";
import type { ClassKey } from "keycloakify/login";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import type { I18n } from "../../login/i18n";
import type { KcContext } from "../../login/KcContext";

export type DigitTemplateProps = TemplateProps<KcContext, I18n> & {
    /** Citizen: sentence under the title. */
    lede?: ReactNode;
    /** Citizen: "card" or the FormStep look. */
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
