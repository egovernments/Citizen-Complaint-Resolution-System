package org.egov.novubridge.service.thin;

/**
 * Every NB_* code the thin-event path writes. Keep {@code contract/error-codes.txt} and the
 * published {@code error-codes.md} in step with this class by hand.
 */
public final class ThinEventErrorCodes {

    private ThinEventErrorCodes() {
    }

    /** A required field is missing or blank. REJECTED, channel NONE, DLQ'd. */
    public static final String INVALID_THIN_EVENT = "NB_INVALID_THIN_EVENT";

    /** No active routing row for the eventName. SKIPPED, channel NONE. */
    public static final String NO_ROUTING = "NB_NO_ROUTING";

    /** Every matched audience resolved to nobody. SKIPPED, channel NONE. */
    public static final String NO_RECIPIENTS = "NB_NO_RECIPIENTS";

    /** An audience names a scheme with no resolver; never guessed at. SKIPPED, channel NONE. */
    public static final String UNKNOWN_AUDIENCE_SCHEME = "NB_UNKNOWN_AUDIENCE_SCHEME";

    /** No template for the key in the locale or the default. SKIPPED on the real channel. */
    public static final String NO_TEMPLATE = "NB_NO_TEMPLATE";

    /** eventName has no active EventCatalogue row. REJECTED, channel NONE, DLQ'd. */
    public static final String EVENT_NOT_IN_CATALOGUE = "NB_EVENT_NOT_IN_CATALOGUE";

    /** The fan-out exceeded the per-event cap; nothing is delivered. SKIPPED, channel NONE. */
    public static final String RECIPIENT_LIMIT_EXCEEDED = "NB_RECIPIENT_LIMIT_EXCEEDED";

    /**
     * An audience lookup or a recipient's render/dispatch failed on infrastructure. The rest of
     * the event is delivered first, then the event is DLQ'd; a replay re-sends only what is not
     * already SENT (transaction ids are stable).
     */
    public static final String RESOLUTION_INCOMPLETE = "NB_RESOLUTION_INCOMPLETE";

    /** A config master could not be read and no cached copy exists. DLQ'd for replay. */
    public static final String CONFIG_UNAVAILABLE = "NB_CONFIG_UNAVAILABLE";
}
