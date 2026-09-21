package org.egov.novubridge.service.thin;

/**
 * Every {@code NB_*} code the thin-event path can write, in one place.
 *
 * <p><b>Why a constants class at all</b>, when the rest of the service writes its codes as
 * literals at the point of use. Two of these are emitted today; the rest belong to the
 * resolution stage, which does not exist yet. {@code ErrorCodeCatalogTest} asserts in BOTH
 * directions — an emitted code must be catalogued, and a catalogued code must appear in the main
 * source — so a code documented ahead of its emitter would fail the build, and a code left
 * undocumented until its emitter lands would leave the operator-facing page describing only half
 * the path. Naming them here, referenced from the code that already uses them and from the code
 * that soon will, keeps the catalogue honest without inventing a fake emitter for any of them.
 *
 * <p>Each constant says where it will be written and what row it produces. The row shapes are the
 * published contract ({@code docs/2.12/notifications/contract/outputs.md}); the meanings are in
 * {@code error-codes.md}.
 *
 * <p>Deliberately absent: a code for "this build cannot resolve a thin event". There is no such
 * build — the resolution stage is not optional and there is no bean whose absence turns it off —
 * so a code for that outcome would be a documented state nothing can reach.
 *
 * <p>Also deliberately absent: a duplicate-suppression code. The bridge does not suppress a replayed
 * event — a redelivery is dispatched again and upserts the same ledger row, exactly as it does on
 * the pre-rendered path. There is no "already SENT" gate anywhere, and adding one is a decision
 * nobody has taken.
 */
public final class ThinEventErrorCodes {

    private ThinEventErrorCodes() {
    }

    /**
     * A required field is missing or blank: {@code kind}, {@code eventId}, {@code eventType},
     * {@code module}, {@code eventName}, {@code tenantId}. The thin-event twin of
     * {@code NB_INVALID_EVENT}, kept separate so an operator can tell at a glance which contract
     * the producer broke. Row: {@code REJECTED}, channel {@code NONE} — the event never reached a
     * channel — and the consumer DLQs it.
     *
     * <p>Emitted today, by {@link ThinEventValidator}.
     */
    public static final String INVALID_THIN_EVENT = "NB_INVALID_THIN_EVENT";

    /**
     * No active routing row matches the event's {@code eventName} for this tenant. Row:
     * {@code SKIPPED}, channel {@code NONE}. The single most likely reason an operator sees
     * "nothing was sent" after onboarding a new event: the event is real, the config is not there
     * yet.
     *
     * <p>Written by the resolution stage.
     */
    public static final String NO_ROUTING = "NB_NO_ROUTING";

    /**
     * Routing rows matched, and every audience on them resolved to an empty list — no actor named,
     * no role holder in the tenant, no event recipients. Row: {@code SKIPPED}, channel
     * {@code NONE}.
     *
     * <p>Written by the resolution stage.
     */
    public static final String NO_RECIPIENTS = "NB_NO_RECIPIENTS";

    /**
     * A routing row's audience names a scheme with no resolver — {@code SOMETHING:x} where
     * {@code SOMETHING} is neither {@code ACTOR} nor {@code ROLE} nor {@code EVENT_RECIPIENTS}.
     * Never guessed at. Row: {@code SKIPPED}, channel {@code NONE}.
     *
     * <p>Written by the resolution stage.
     */
    public static final String UNKNOWN_AUDIENCE_SCHEME = "NB_UNKNOWN_AUDIENCE_SCHEME";

    /**
     * No template for {@code (eventName, audience, channel, locale)}, nor for the default locale.
     * Row: {@code SKIPPED} on the REAL channel — by this point the box knows which channel it
     * could not render for, and saying so is more useful than a channel-less row.
     *
     * <p>Written by the resolution stage.
     */
    public static final String NO_TEMPLATE = "NB_NO_TEMPLATE";

    /**
     * {@code eventName} has no active row in {@code NOTIFICATIONS.EventCatalogue}. Row:
     * {@code REJECTED} + DLQ: an uncatalogued event name cannot be validated, its placeholder
     * vocabulary is unknown, and letting it through would make the Configurator's checks a
     * suggestion rather than a contract.
     *
     * <p>Written by the resolution stage.
     */
    public static final String EVENT_NOT_IN_CATALOGUE = "NB_EVENT_NOT_IN_CATALOGUE";

    /**
     * The fan-out for one event exceeded the per-event recipient cap. A thin event naming a role
     * is an unbounded instruction — one message in, one message per role holder out — so the cap
     * exists to stop a mis-seeded role turning a single transition into a five-figure send. Row:
     * {@code SKIPPED}, channel {@code NONE}, and nothing is delivered: half a fan-out is worse
     * than none, because nobody can tell which half.
     *
     * <p>Written by the resolution stage.
     */
    public static final String RECIPIENT_LIMIT_EXCEEDED = "NB_RECIPIENT_LIMIT_EXCEEDED";
}
