package org.egov.identity.keycloak.sms;

/**
 * Who an SMS is for. {@code tenant} is the route tenant slug (may be null),
 * {@code purpose} is e.g. {@code login_otp}.
 */
public record SmsContext(String realm, String tenant, String locale, String purpose) {
}
