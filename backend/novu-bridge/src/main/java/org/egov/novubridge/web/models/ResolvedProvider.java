package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolvedProvider {
    private String providerName;
    private String channel;
    private Map<String, Object> credentials;  // Generic credentials map - user provides in Novu format
    private String novuApiKey;  // Optional provider-specific Novu API key
    private Boolean isActive;
    private Integer priority;
}