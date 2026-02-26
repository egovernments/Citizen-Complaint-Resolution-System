package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ProviderDetail {

    @JsonProperty("id")
    private String id;

    @JsonProperty("providerName")
    private String providerName;

    @JsonProperty("channel")
    private String channel;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("enabled")
    @Builder.Default
    private Boolean enabled = true;

    @JsonProperty("value")
    private JsonNode value;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;
}
