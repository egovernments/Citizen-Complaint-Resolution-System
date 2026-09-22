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
    /** {@link #SOURCE_PATH_PRERENDERED} (also what null is written as) or {@link #SOURCE_PATH_RESOLVED}. */
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

    /** A finished v1 envelope the bridge only gated and delivered; the default, including pre-column rows. */
    public static final String SOURCE_PATH_PRERENDERED = "PRERENDERED";

    /** Every row born of a thin event, including the channel-less ones. */
    public static final String SOURCE_PATH_RESOLVED = "RESOLVED";

    /** Channel of a row for a decision taken before there was a channel (no routing, no audience, cap refused). */
    public static final String CHANNEL_NONE = "NONE";

    /** The recipient of a channel-less row. Lower case, so it cannot be mistaken for a subscriber. */
    public static final String RECIPIENT_NONE = "none";
}
