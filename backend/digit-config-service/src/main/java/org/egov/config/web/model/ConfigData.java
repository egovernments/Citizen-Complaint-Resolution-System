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
public class ConfigData {

    @JsonProperty("id")
    private String id;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("schemaCode")
    private String schemaCode;

    @JsonProperty("uniqueIdentifier")
    private String uniqueIdentifier;

    @JsonProperty("data")
    private JsonNode data;

    @JsonProperty("isActive")
    private Boolean isActive;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;
}
