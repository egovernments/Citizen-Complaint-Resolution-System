package org.egov.identity.keycloak.forms;

import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.forms.login.freemarker.FreeMarkerLoginFormsProviderFactory;
import org.keycloak.models.KeycloakSession;

/**
 * Registers {@link DigitLoginFormsProvider} as the realm-wide login forms
 * provider. Keycloak picks the factory with the highest {@code order()} when
 * no {@code spi-login-provider} is configured (DefaultKeycloakSessionFactory
 * .resolveDefaultProvider); the stock {@code freemarker} factory has order 0.
 */
public class DigitLoginFormsProviderFactory extends FreeMarkerLoginFormsProviderFactory {

    public static final String PROVIDER_ID = "digit-freemarker";

    @Override
    public LoginFormsProvider create(KeycloakSession session) {
        return new DigitLoginFormsProvider(session);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public int order() {
        return 10;
    }
}
