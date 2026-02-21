package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ConfigEntrySearchCriteria {

    @JsonProperty("ids")
    private List<String> ids;

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
    private Boolean enabled;

    @JsonProperty("valueFilter")
    private JsonNode valueFilter;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;
}
