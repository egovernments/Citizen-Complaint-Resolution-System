package org.egov.novubridge.service.resolution;

import org.springframework.util.StringUtils;

/**
 * Who to notify and how to reach them. Deliberately not {@code Contact}, which is part of the
 * frozen v1 envelope contract.
 *
 * @param type   {@code CITIZEN}, {@code EMPLOYEE}, or the role code the audience resolved as
 * @param phone  E.164, country code already prefixed
 * @param locale a locale the resolver already knows; null means "ask the LocaleProvider"
 */
public record Recipient(String userId, String type, String name, String phone, String email, String locale) {

    /**
     * The uuid, else the phone, else null. Null means no message and no row can be addressed to
     * this person; inventing a key would make two people share one ledger row.
     */
    public String subscriberKey() {
        if (StringUtils.hasText(userId)) {
            return userId.trim();
        }
        if (StringUtils.hasText(phone)) {
            return phone.trim();
        }
        return null;
    }

    /** EMAIL needs an email; every other channel a phone. */
    public boolean reachableOn(String channel) {
        return "EMAIL".equalsIgnoreCase(channel) ? StringUtils.hasText(email) : StringUtils.hasText(phone);
    }

    @Override
    public String toString() {
        // No PII in logs.
        return "Recipient[" + type + " " + (StringUtils.hasText(userId) ? userId : "<no-uuid>") + "]";
    }
}
