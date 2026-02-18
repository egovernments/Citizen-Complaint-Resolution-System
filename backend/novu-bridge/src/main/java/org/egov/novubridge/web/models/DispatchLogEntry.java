package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DispatchLogEntry {
    private UUID id;
    private String eventId;
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
    private Long createdTime;
    private Long lastModifiedTime;
}
