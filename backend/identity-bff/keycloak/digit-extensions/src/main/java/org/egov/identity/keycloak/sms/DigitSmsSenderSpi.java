package org.egov.identity.keycloak.sms;

import org.keycloak.provider.Provider;
import org.keycloak.provider.ProviderFactory;
import org.keycloak.provider.Spi;

/** SPI {@code digit-sms-sender}; providers {@code log}, {@code mailpit}, {@code http}. */
public class DigitSmsSenderSpi implements Spi {

    public static final String NAME = "digit-sms-sender";

    @Override
    public boolean isInternal() {
        return false;
    }

    @Override
    public String getName() {
        return NAME;
    }

    @Override
    public Class<? extends Provider> getProviderClass() {
        return DigitSmsSender.class;
    }

    @Override
    @SuppressWarnings("rawtypes")
    public Class<? extends ProviderFactory> getProviderFactoryClass() {
        return DigitSmsSenderFactory.class;
    }
}
