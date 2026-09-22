package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * The bridge's SECOND inbound kind (schema version 1): a thin domain event. The producer says
 * only <i>this happened to this entity</i>; the box decides who to tell, on which channel, in
 * which language, and what the words are.
 *
 * <p>The exact complement of {@link NotificationEvent}, which carries a finished message for one
 * recipient on one channel. Neither replaces the other: the pre-rendered envelope is a public
 * interface forever, and CORE-SMS and any external producer keep using it. The two are told apart
 * by {@code kind} — {@code "THIN"} here, absent or {@code "RENDERED"} there — read off the raw
 * map before binding, never inferred from which fields happen to be set.
 *
 * <p>Required: kind, eventId, eventType, module, eventName, tenantId. Note what is <b>absent on
 * purpose</b>: {@code channel}, {@code subscriberId}, {@code renderedBody}, {@code subject},
 * {@code templateKey}, {@code templateId}, {@code contentVariables}. The box produces all of
 * those. A producer that filled them in would be re-implementing the thing this removes.
 *
 * <p>One thin event becomes N ledger rows — one per recipient x channel the routing config
 * resolves to — plus, where the box decides there is nothing to deliver, a channel-less row
 * ({@code channel = "NONE"}) carrying the reason. The v1 envelopes the resolution stage mints are
 * in-process objects handed straight to the dispatch pipeline; they are never published back onto
 * Kafka.
 *
 * <p><b>Published contract.</b> The wire form of this class is
 * {@code contract/thin-event-v1.schema.json} (packaged in this jar, and published at
 * {@code docs/2.12/notifications/contract/}). Keep them in step by hand: every field below
 * appears in the schema, and the schema's required set is exactly what
 * {@code ThinEventValidator} enforces.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ThinEvent {

    /** The discriminator. Always {@code "THIN"} for this kind; see {@code KIND}. */
    private String kind;

    /** Version of this KIND; absent means "1". Versions independently of the envelope. */
    private String schemaVersion;

    /** Uuid of the DOMAIN EVENT, not of a message. One thin event, N ledger rows, one eventId. */
    private String eventId;

    /** Producer contract constant; must be on the {@code novu.bridge.event.types} allowlist. */
    private String eventType;

    /** When the producing module decided the event happened, ISO-8601 in UTC. Informational. */
    private String eventTime;

    /** Service that emitted the event, for tracing. */
    private String producer;

    /**
     * Producing module. REQUIRED here, unlike the envelope: it is the catalogue's owner key, it
     * is recorded verbatim in the ledger, and it is how the Configurator groups rows.
     */
    private String module;

    /**
     * The EVENT KEY: dotted, module-prefixed, globally unique. Replaces the
     * {@code (businessService, action, toState)} triple, and must distinguish outcomes that need
     * different words — {@code RATE.CLOSEDAFTERRESOLUTION} is not {@code RATE.CLOSEDAFTERREJECTION}.
     */
    private String eventName;

    /** What {@code entityId} names, in the producer's own vocabulary. */
    private String entityType;

    /** The producer's handle for the thing this happened to; becomes the ledger reference_number. */
    private String entityId;

    /** DIGIT tenant. Decides routing, templates, channel policy and provider. */
    private String tenantId;

    /**
     * IDEMPOTENCY SEED. The box completes it rather than inventing one:
     * {@code transactionId = <transactionSeed>:<subscriberId>:<channel>}. A producer setting
     * {@code <entityId>:<ACTION>:<TOSTATE>} gets transaction ids byte-identical to the
     * pre-rendered path, so a mid-flight redeploy cannot double-send.
     */
    private String transactionSeed;

    /**
     * The named people this event is ABOUT, keyed by the name routing config refers to as
     * {@code ACTOR:<name>}. The only recipient knowledge a producer supplies — and the only
     * knowledge the box cannot reconstruct. Producers do not name audiences and do not expand
     * role pools.
     */
    private Map<String, ActorRef> actors;

    /** Explicit contact overrides for account-less flows; reached by the audience {@code EVENT_RECIPIENTS}. */
    private List<ActorRef> recipients;

    /** Placeholder name to literal value — the words that plug into a template's {@code {tokens}}. */
    private Map<String, Object> data;

    /**
     * Placeholder name to localization CODE, or to an ordered array of codes to try. Resolved by
     * the box once per recipient locale, which the producer cannot do: it builds placeholders
     * once per event but the box renders once per locale. Use {@link #localizationCodes(String)}
     * rather than reading this map directly — both wire forms are legal.
     */
    private Map<String, Object> localized;

    /** Which egov-localization modules to search, IN ORDER. */
    private List<String> localizationModules;

    /** Locale to a partial {@code data} override; the escape hatch for a value with no code. */
    private Map<String, Map<String, Object>> dataByLocale;

    /**
     * The ONE locale the event's {@code localized} codes are resolved in, for the WHOLE event.
     * Absent means {@code novu.bridge.default.locale}.
     *
     * <p>Deliberately per-event and not per-recipient, because that is what the behaviour being
     * replaced does: a producer builds its placeholder values once, in the locale its inbound
     * request asked for, and then renders per-recipient templates against that one set. So in a
     * two-language fan-out both recipients get the template text in their own language and the
     * SAME substituted values. Reproducing that is what makes the cutover a move rather than a
     * change; localizing per recipient is a real improvement and a separate, deliberate decision.
     *
     * <p>A producer migrating from the pre-rendered path sets this to the locale it used to build
     * its values with, and its messages come out byte-identical.
     */
    private String localizationLocale;

    /**
     * The event name stamped on the minted envelopes and on every ledger row. Absent means
     * {@link #eventName}.
     *
     * <p>It exists because the two names are two different things. {@link #eventName} is the CONFIG
     * KEY — it must distinguish outcomes that need different words, so it carries the target state
     * ({@code …ASSIGN.PENDINGATLME}). The ledger's {@code event_name} is an OPERATOR-FACING LABEL
     * that a deployment has been filtering and reporting on for releases. A producer cutting over
     * from the pre-rendered path sets this to whatever it used to send, and its Logs screen,
     * saved filters and dashboards keep working across the release; a producer starting fresh
     * leaves it out and gets the config key, which is the more informative of the two.
     */
    private String ledgerEventName;

    /**
     * Free-form structured payload echoed onto every minted envelope's {@code data} block.
     *
     * <p>NOT the same thing as {@link #data}. {@code data} is placeholder values — the words that
     * go into the message, which never leave the box. This is the producer's own vocabulary for
     * the row: the v1 envelope has always carried such a block, the ledger reads
     * {@code referenceNumber}, {@code action} and {@code toState} out of it as fallbacks, and a
     * producer moving to the thin event would otherwise lose it.
     */
    private Map<String, Object> payload;

    /** The only value of {@link #getKind()} this class describes. */
    public static final String KIND = "THIN";

    /**
     * The idempotency seed this event actually carries, falling back exactly as the published
     * contract says: {@code transactionSeed}, else {@code <entityId>:<eventName>}, else
     * {@code <eventId>}. The box completes it into a transaction id per recipient x channel —
     * {@code <seed>:<subscriberId>:<channel>} — and stamps {@code <seed>:NONE} on a channel-less
     * row, which keeps the ledger's unique key intact for a decision taken before any channel
     * existed.
     *
     * <p>The last fallback is why this never returns null for a validated event: {@code eventId}
     * is required.
     */
    public String resolvedTransactionSeed() {
        if (hasText(transactionSeed)) {
            return transactionSeed.trim();
        }
        if (hasText(entityId) && hasText(eventName)) {
            return entityId.trim() + ":" + eventName.trim();
        }
        return eventId == null ? null : eventId.trim();
    }

    /**
     * The name this event is recorded under: {@link #ledgerEventName} when the producer named one,
     * else {@link #eventName}. Never null for a validated event.
     */
    public String resolvedLedgerEventName() {
        return hasText(ledgerEventName) ? ledgerEventName.trim() : eventName;
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    /**
     * The localization codes to try for one placeholder, in order, normalising the two legal wire
     * forms — a bare string and an array of strings — into one list. Anything else (a number, an
     * object, a null element) is ignored rather than guessed at: an un-resolvable token is left
     * unsubstituted, which is the documented behaviour, and inventing a code would silently
     * render the wrong words.
     *
     * @return never null; empty when the token has no codes
     */
    public List<String> localizationCodes(String token) {
        Object raw = localized == null ? null : localized.get(token);
        if (raw == null) {
            return Collections.emptyList();
        }
        if (raw instanceof CharSequence) {
            return List.of(raw.toString());
        }
        if (raw instanceof Iterable) {
            List<String> codes = new ArrayList<>();
            for (Object element : (Iterable<?>) raw) {
                if (element instanceof CharSequence) {
                    codes.add(element.toString());
                }
            }
            return Collections.unmodifiableList(codes);
        }
        return Collections.emptyList();
    }
}
