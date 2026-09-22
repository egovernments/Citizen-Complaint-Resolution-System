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
            digitSignInWithProvider: "Continue with {0}",
            digitOr: "OR",
            digitShowPassword: "Show password",
            digitHidePassword: "Hide password",
            digitPasswordHelp: "No password yet, or need to reset it? Return to DIGIT password help",
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
            digitSignInWithProvider: "Continuer avec {0}",
            digitOr: "OU",
            digitShowPassword: "Afficher le mot de passe",
            digitHidePassword: "Masquer le mot de passe",
            digitPasswordHelp:
                "Pas encore de mot de passe, ou besoin de le réinitialiser ? Revenir à l'aide DIGIT",
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
