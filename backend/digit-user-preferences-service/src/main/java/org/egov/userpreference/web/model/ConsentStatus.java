package org.egov.userpreference.web.model;

/**
 * Whether a user has opted into a channel.
 *
 * <p>{@link ConsentPolicy} stores the wire value as a {@code String} rather
 * than as this enum: the Go service's {@code ConsentStatus} was a string type,
 * so an unrecognised value deserialized cleanly and was then reported as
 * {@code INVALID_CONSENT_STATUS} with the offending value echoed back. Typing
 * the field as an enum would instead fail during deserialization and collapse
 * that into the generic {@code INVALID_PAYLOAD_FORMAT}.
 */
public enum ConsentStatus {

    GRANTED,
    REVOKED;

    public static boolean isValid(String value) {
        for (ConsentStatus status : values()) {
            if (status.name().equals(value)) {
                return true;
            }
        }
        return false;
    }
}
