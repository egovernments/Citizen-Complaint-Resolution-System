import type { ClassKey } from "keycloakify/login";

/**
 * Stock Keycloak class keys mapped onto the theme's own classes.
 *
 * The hand-written pages below do not need this, but Keycloakify's
 * `DefaultPage` does: it is what renders any screen this theme has not
 * overridden (a user-profile step, TOTP setup, a recovery-code page). Without
 * the map those screens would render unstyled, which is exactly the
 * "falls back to the default Keycloak appearance" outcome #2108 rules out.
 */
export const classes: Partial<Record<ClassKey, string>> = {
    kcFormClass: "digit-section",
    kcFormGroupClass: "digit-field",
    kcFormSettingClass: "digit-form-row",
    kcFormOptionsClass: "digit-form-row",
    kcFormButtonsClass: "digit-stack-sm",
    kcLabelClass: "digit-label",
    kcLabelWrapperClass: "",
    kcInputWrapperClass: "",
    kcInputClass: "digit-input",
    kcInputLargeClass: "digit-input",
    kcTextareaClass: "digit-input",
    kcInputErrorMessageClass: "digit-field-error",
    kcInputHelperTextBeforeClass: "digit-note",
    kcInputHelperTextAfterClass: "digit-note",
    kcInputGroup: "digit-input-group",
    kcFormPasswordVisibilityButtonClass: "digit-input-group__button",
    kcButtonClass: "digit-button",
    kcButtonPrimaryClass: "digit-button--primary",
    kcButtonSecondaryClass: "digit-button--outline",
    kcButtonDefaultClass: "digit-button--outline",
    kcButtonBlockClass: "",
    kcButtonLargeClass: "",
    kcCheckClass: "digit-checkbox",
    kcCheckLabelClass: "digit-checkbox",
    kcCheckInputClass: "",
    kcCheckboxInputClass: "",
    kcInputClassCheckbox: "",
    kcInputClassCheckboxLabel: "digit-checkbox",
    kcInputClassRadio: "",
    kcInputClassRadioLabel: "digit-checkbox",
    kcAlertClass: "digit-alert",
    kcAlertTitleClass: "digit-alert__body",
    kcSrOnlyClass: "digit-visually-hidden",
    kcFormSocialAccountListClass: "digit-stack-sm",
    kcFormSocialAccountListGridClass: "digit-stack-sm",
    kcFormSocialAccountListButtonClass: "digit-button digit-button--outline",
    kcSelectAuthListClass: "digit-stack-sm",
    kcSelectAuthListItemClass: "digit-panel",
    kcSelectAuthListItemHeadingClass: "digit-panel__name",
    kcSelectAuthListItemDescriptionClass: "digit-panel__meta",
    kcRecoveryCodesList: "digit-list",
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
