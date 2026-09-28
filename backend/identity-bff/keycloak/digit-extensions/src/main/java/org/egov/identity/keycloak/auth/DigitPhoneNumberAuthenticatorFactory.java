package org.egov.identity.keycloak.auth;

import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;

public class DigitPhoneNumberAuthenticatorFactory extends AbstractPhoneAuthenticatorFactory {

    public static final String PROVIDER_ID = "digit-phone-number-form";
    private static final DigitPhoneNumberAuthenticator SINGLETON = new DigitPhoneNumberAuthenticator();

    @Override
    public Authenticator create(KeycloakSession session) {
        return SINGLETON;
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "DIGIT phone number form";
    }

    @Override
    public String getHelpText() {
        return "Asks for a mobile number, validates it against the route tenant's MobileNumberValidation and sends an SMS OTP. Never reveals whether an account exists.";
    }
}
