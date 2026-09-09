package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Mirrors the real, unmodified DIGIT-Core {@code user-otp} service's own
 * {@code org.egov.persistence.contract.SMSRequest} — the flat message it
 * publishes to its {@code sms.topic} (env {@code SMS_TOPIC}) for
 * {@code egov-notification-sms} to consume.
 *
 * <p><b>Field names here were reverse-engineered from the constructor
 * signature of the decompiled user-otp jar</b> (image
 * {@code egovio/user-otp:master-e22c7c5}) — {@code (mobileNumber, message,
 * category, currentTime, countryCode)} — not read from source, since that
 * repo isn't vendored here. Verify these against the real
 * {@code SMSRequest.java} if/when that source becomes available; Jackson
 * field-name casing in particular is an assumption, not a confirmed fact.
 *
 * <p>Notably, this message carries no {@code tenantId} at all — see
 * {@link org.egov.novubridge.config.NovuBridgeConfiguration#getUserOtpDefaultTenantId()}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserOtpSmsMessage {
    private String mobileNumber;   // bare national number, no country code (assumed no leading '+')
    private String message;        // fully rendered SMS body — already localized by user-otp
    private String category;       // e.g. REGISTRATION | LOGIN | PWD_RESET — carried through, unused for delivery
    private Long currentTime;
    private String countryCode;    // e.g. "+258"
}
