package org.egov.identity.keycloak.sms;

import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderFactory;

public interface DigitSmsSenderFactory extends ProviderFactory<DigitSmsSender> {

    @Override
    default void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    default void close() {
    }
}
