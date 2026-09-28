package org.egov.identity.keycloak.auth;

import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;

public class DigitSmsOtpAuthenticatorFactory extends AbstractPhoneAuthenticatorFactory {

    public static final String PROVIDER_ID = "digit-sms-otp";
    private static final DigitSmsOtpAuthenticator SINGLETON = new DigitSmsOtpAuthenticator();

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
        return "DIGIT SMS OTP";
    }

    @Override
    public String getHelpText() {
        return "Verifies the SMS code sent by the DIGIT phone number form, then finds or creates the user by verified phoneNumber.";
    }
}
