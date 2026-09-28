package org.egov.identity.keycloak.auth;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel.Requirement;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

abstract class AbstractPhoneAuthenticatorFactory implements AuthenticatorFactory {

    private static final Requirement[] REQUIREMENTS = {Requirement.REQUIRED, Requirement.ALTERNATIVE, Requirement.DISABLED};

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // Fail at boot, not at first login, on a bad digit-phone-otp / digit-sms-sender config.
        PhoneOtpRuntime.get();
    }

    @Override
    public void close() {
    }

    @Override
    public String getReferenceCategory() {
        return "digit-phone-otp";
    }

    @Override
    public boolean isConfigurable() {
        return false;
    }

    @Override
    public Requirement[] getRequirementChoices() {
        return REQUIREMENTS;
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return List.of();
    }
}
