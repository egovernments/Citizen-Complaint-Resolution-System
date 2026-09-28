package org.egov.identity.keycloak.auth;

import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;

public class DigitPhoneProfileAuthenticatorFactory extends AbstractPhoneAuthenticatorFactory {

    public static final String PROVIDER_ID = "digit-phone-profile-form";
    private static final DigitPhoneProfileAuthenticator SINGLETON = new DigitPhoneProfileAuthenticator();

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
        return "DIGIT phone profile form";
    }

    @Override
    public String getHelpText() {
        return "Asks a phone-verified user without a first name for their name.";
    }
}
