import { i18nBuilder } from "keycloakify/login";
import type { ThemeName } from "../kc.gen";

/**
 * Theme-defined copy.
 *
 * Only strings the Configurator shows and Keycloak has no equivalent for live
 * here; everything else (field labels, Keycloak's own error text) comes from
 * Keycloak's message bundle so a realm override or a Keycloak upgrade keeps
 * working. French is carried because Bomet enables `fr_FR`.
 */
const { useI18n, ofTypeI18n } = i18nBuilder
    .withThemeName<ThemeName>()
    .withCustomTranslations({
        en: {
            digitErrorTitle: "There is a problem",
            digitSuccessTitle: "Done",
            digitWarningTitle: "Check this first",
            digitInfoTitle: "For your information",
            digitSignInProblemTitle: "Could not sign in",
            digitWelcomeBack: "Welcome back",
            digitSignInLede:
                "Continue with your password or an identity provider. You will choose a workspace after sign-in.",
            digitContinue: "Continue",
            digitSignInWithProvider: "Log in with {0}",
            digitOr: "OR",
            digitShowPassword: "Show password",
            digitHidePassword: "Hide password",
            digitForgotPassword: "Forgot your password?",
            digitPasswordHelp: "Set up or reset your password",
            digitResetPasswordTitle: "Reset your password",
            digitResetPasswordLede: "Enter the email address associated with your account.",
            digitResetPasswordUsernameLede:
                "Enter the email address or username associated with your account.",
            digitResetPasswordUsernameOnlyLede:
                "Enter the username associated with your account.",
            digitEmailOrUsername: "Email address or username",
            digitResetPasswordSubmit: "Email me a reset link",
            digitBackToDigit: "Return to DIGIT",
            digitSecurity: "Security",
            digitAccount: "Account",
            digitVerification: "Verification",
            digitSessionEyebrow: "Session",
            digitNonEnumerating:
                "If an eligible account exists, we will email a secure one-use link. We never reveal which sign-in methods an email uses."
        },
        fr: {
            digitErrorTitle: "Un problème est survenu",
            digitSuccessTitle: "Terminé",
            digitWarningTitle: "À vérifier",
            digitInfoTitle: "Pour information",
            digitSignInProblemTitle: "Connexion impossible",
            digitWelcomeBack: "Bon retour",
            digitSignInLede:
                "Continuez avec votre mot de passe ou un fournisseur d'identité. Vous choisirez un espace de travail après la connexion.",
            digitContinue: "Continuer",
            digitSignInWithProvider: "Se connecter avec {0}",
            digitOr: "OU",
            digitShowPassword: "Afficher le mot de passe",
            digitHidePassword: "Masquer le mot de passe",
            digitForgotPassword: "Mot de passe oublié ?",
            digitPasswordHelp: "Configurer ou réinitialiser votre mot de passe",
            digitResetPasswordTitle: "Réinitialiser votre mot de passe",
            digitResetPasswordLede: "Saisissez l’adresse e-mail associée à votre compte.",
            digitResetPasswordUsernameLede:
                "Saisissez l’adresse e-mail ou le nom d’utilisateur associé à votre compte.",
            digitResetPasswordUsernameOnlyLede:
                "Saisissez le nom d’utilisateur associé à votre compte.",
            digitEmailOrUsername: "Adresse e-mail ou nom d’utilisateur",
            digitResetPasswordSubmit: "Recevoir un lien de réinitialisation",
            digitBackToDigit: "Revenir à DIGIT",
            digitSecurity: "Sécurité",
            digitAccount: "Compte",
            digitVerification: "Vérification",
            digitSessionEyebrow: "Session",
            digitNonEnumerating:
                "Si un compte éligible existe, nous enverrons un lien sécurisé à usage unique. Nous ne révélons jamais les méthodes de connexion associées à une adresse."
        }
    })
    .build();

type I18n = typeof ofTypeI18n;

export { useI18n, type I18n };
