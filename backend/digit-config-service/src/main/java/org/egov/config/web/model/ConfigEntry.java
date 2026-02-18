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
public class ConfigEntry {

    @JsonProperty("id")
    private String id;

    @JsonProperty("configCode")
    private String configCode;

    @JsonProperty("module")
    private String module;

    @JsonProperty("eventType")
    private String eventType;

    @JsonProperty("channel")
    private String channel;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("locale")
    private String locale;

    @JsonProperty("enabled")
    @Builder.Default
    private Boolean enabled = true;

    @JsonProperty("value")
    private JsonNode value;

    @JsonProperty("revision")
    private Integer revision;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;
}
