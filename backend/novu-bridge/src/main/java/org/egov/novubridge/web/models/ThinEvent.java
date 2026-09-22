package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.springframework.util.StringUtils.hasText;

/**
 * The thin domain event (schema version 1): the producer says only what happened to which entity;
 * the box decides who to tell, on which channel, in which language, with which words. The
 * complement of {@link NotificationEvent}, told apart by {@code kind}. Channel, subscriber and
 * rendered text are absent on purpose.
 *
 * <p>Wire form: {@code contract/thin-event-v1.schema.json} (packaged in this jar, published at
 * {@code docs/2.20/notifications/contract/}). Keep them in step by hand; the schema's required set
 * is exactly what {@code ThinEventValidator} enforces.
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

    /** Producing module. REQUIRED here, unlike the envelope: the catalogue's owner key. */
    private String module;

    /** The EVENT KEY: dotted, module-prefixed, unique; distinguishes outcomes needing different words. */
    private String eventName;

    /** What {@code entityId} names, in the producer's own vocabulary. */
    private String entityType;

    /** The producer's handle for the thing this happened to; becomes the ledger reference_number. */
    private String entityId;

    /** DIGIT tenant. Decides routing, templates, channel policy and provider. */
    private String tenantId;

    /** IDEMPOTENCY SEED: {@code transactionId = <transactionSeed>:<subscriberId>:<channel>}. */
    private String transactionSeed;

    /** The people this event is ABOUT, keyed by the name routing refers to as {@code ACTOR:<name>}. */
    private Map<String, ActorRef> actors;

    /** Explicit contact overrides for account-less flows; reached by the audience {@code EVENT_RECIPIENTS}. */
    private List<ActorRef> recipients;

    /** Placeholder name to literal value — the words that plug into a template's {@code {tokens}}. */
    private Map<String, Object> data;

    /** Placeholder name to a localization code or ordered array of codes; read via {@link #localizationCodes}. */
    private Map<String, Object> localized;

    /** Which egov-localization modules to search, IN ORDER. */
    private List<String> localizationModules;

    /** Locale to a partial {@code data} override; the escape hatch for a value with no code. */
    private Map<String, Map<String, Object>> dataByLocale;

    /**
     * The ONE locale {@code localized} codes are resolved in, for the whole event; absent means
     * {@code novu.bridge.default.locale}. Per event, not per recipient, to match what producers did.
     */
    private String localizationLocale;

    /**
     * The event name stamped on envelopes and ledger rows; absent means {@link #eventName}. Lets a
     * migrating producer keep the operator-facing label its Logs filters already use.
     */
    private String ledgerEventName;

    /**
     * Free-form payload echoed onto every envelope's {@code data} block (the ledger reads
     * referenceNumber/action/toState from it). Not placeholder values: those are {@link #data}.
     */
    private Map<String, Object> payload;

    /** The only value of {@link #getKind()} this class describes. */
    public static final String KIND = "THIN";

    /**
     * {@code transactionSeed}, else {@code <entityId>:<eventName>}, else {@code eventId}, as the
     * contract says. Never null for a validated event. A channel-less row uses {@code <seed>:NONE}.
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

    /** {@link #ledgerEventName} when set, else {@link #eventName}. */
    public String resolvedLedgerEventName() {
        return hasText(ledgerEventName) ? ledgerEventName.trim() : eventName;
    }

    /**
     * The codes to try for one placeholder, from either wire form (a string or an array). Anything
     * else is ignored rather than guessed at, so the token stays unsubstituted.
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
