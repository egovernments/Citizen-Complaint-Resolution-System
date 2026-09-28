package org.egov.identity.keycloak.sms;

public class SmsSendException extends Exception {
    public SmsSendException(String message) {
        super(message);
    }

    public SmsSendException(String message, Throwable cause) {
        super(message, cause);
    }
}
