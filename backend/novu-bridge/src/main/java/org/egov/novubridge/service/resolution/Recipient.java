package org.egov.novubridge.service.resolution;

/**
 * Who to notify, and how to reach them — the same field set the v1 envelope's {@code contact}
 * block carries, because that is what this becomes.
 *
 * <p>Deliberately not {@code Contact} itself: {@code Contact} is part of a frozen published
 * contract, and a resolver is free code. Sharing the class would make a change to either a change
 * to both.
 */
public final class Recipient {

    private final String userId;
    private final String type;
    private final String name;
    private final String phone;
    private final String email;
    private final String locale;

    public Recipient(String userId, String type, String name, String phone, String email, String locale) {
        this.userId = userId;
        this.type = type;
        this.name = name;
        this.phone = phone;
        this.email = email;
        this.locale = locale;
    }

    public String userId() {
        return userId;
    }

    /** {@code CITIZEN}, {@code EMPLOYEE}, or a role code — whatever the audience resolved as. */
    public String type() {
        return type;
    }

    public String name() {
        return name;
    }

    /** E.164, with the country code already prefixed. */
    public String phone() {
        return phone;
    }

    public String email() {
        return email;
    }

    /** A locale the resolver already knows for this person; null means "ask the LocaleProvider". */
    public String locale() {
        return locale;
    }

    /**
     * The half of the subscriber id that identifies the person: the uuid, else the phone, else
     * nothing.
     *
     * <p>Returning null is a real answer, not a failure: a recipient with neither a uuid nor a
     * phone cannot be keyed, so no message and no ledger row can be addressed to them. Today's
     * code drops such a recipient silently at publish time; this keeps that, because inventing a
     * key would make two different people share one row.
     */
    public String subscriberKey() {
        if (hasText(userId)) {
            return userId.trim();
        }
        if (hasText(phone)) {
            return phone.trim();
        }
        return null;
    }

    /** Whether this person can be reached on the channel at all. EMAIL needs an email; the rest a phone. */
    public boolean reachableOn(String channel) {
        return "EMAIL".equalsIgnoreCase(channel) ? hasText(email) : hasText(phone);
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    @Override
    public String toString() {
        // No PII: a recipient is logged by key and type, never by name/phone/email.
        return "Recipient[" + type + " " + (hasText(userId) ? userId : "<no-uuid>") + "]";
    }
}
