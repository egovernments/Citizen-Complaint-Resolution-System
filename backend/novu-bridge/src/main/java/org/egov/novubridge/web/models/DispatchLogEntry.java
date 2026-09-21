package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class DispatchLogEntry {
    private UUID id;
    private String eventId;
    private String transactionId;
    private String referenceNumber;
    private String module;
    private String eventName;
    private String tenantId;
    /** SMS | WHATSAPP | EMAIL, or {@link #CHANNEL_NONE} for a decision taken before a channel existed. */
    private String channel;
    private String recipientValue;
    /**
     * Which inbound kind produced this row: {@link #SOURCE_PATH_PRERENDERED} or
     * {@link #SOURCE_PATH_RESOLVED}. Null here means PRERENDERED — the repository writes that
     * value rather than a NULL, so the column is never ambiguous and never needs a reader to know
     * what an absence meant.
     */
    private String sourcePath;
    private String templateKey;
    private String templateVersion;
    private String status;
    private Integer attemptCount;
    private String lastErrorCode;
    private String lastErrorMessage;
    private Map<String, Object> providerResponse;
    /** Operator test-send (Providers screen). Hidden from the Logs screen unless asked for. */
    private Boolean isTest;
    /** Provider-side correlation id (Novu transactionId, SMSCountry jobId) — how receipts find the row. */
    private String providerRef;
    /** Stamped by a DELIVERED receipt. */
    private Long deliveredTime;
    private Long createdTime;
    private Long lastModifiedTime;

    /**
     * The producer sent a finished v1 envelope; the bridge only gated and delivered it. The
     * default for every row, including every row written before the column existed — which is
     * what those rows were.
     */
    public static final String SOURCE_PATH_PRERENDERED = "PRERENDERED";

    /**
     * The producer sent a thin domain event and the box took responsibility for it. Written on
     * EVERY row born of a thin event, including the channel-less ones where resolution produced
     * nothing to send — a row that came in on the thin path must not claim to be pre-rendered.
     */
    public static final String SOURCE_PATH_RESOLVED = "RESOLVED";

    /**
     * The channel of a row for a decision the box took BEFORE there was a channel: no routing
     * matched, no audience resolved to anyone, the fan-out was refused. "Every outcome is a row"
     * has to cover those too, and they have no channel to name.
     */
    public static final String CHANNEL_NONE = "NONE";

    /** The recipient of a channel-less row. Lower case, so it cannot be mistaken for a subscriber. */
    public static final String RECIPIENT_NONE = "none";
}
