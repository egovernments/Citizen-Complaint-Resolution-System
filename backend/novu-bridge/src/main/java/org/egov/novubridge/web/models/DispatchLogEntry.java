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
    private String channel;
    private String recipientValue;
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
}
