package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.Set;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ConfigDataCriteria {

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("ids")
    private Set<String> ids;

    @JsonProperty("uniqueIdentifiers")
    private Set<String> uniqueIdentifiers;

    @JsonProperty("schemaCode")
    private String schemaCode;

    @JsonProperty("filters")
    private Map<String, String> filters;

    @JsonProperty("isActive")
    private Boolean isActive;

    @JsonProperty("offset")
    private Integer offset;

    @JsonProperty("limit")
    private Integer limit;
}
