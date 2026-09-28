package org.egov.identity.keycloak.sms;

import org.keycloak.provider.Provider;

/**
 * Delivers one text message. Implementations must not retry silently and must
 * throw {@link SmsSendException} when the message was not accepted, so the
 * login page can show {@code digitSmsSendFailed}.
 */
public interface DigitSmsSender extends Provider {

    void send(String e164, String text, SmsContext context) throws SmsSendException;

    @Override
    default void close() {
    }
}
