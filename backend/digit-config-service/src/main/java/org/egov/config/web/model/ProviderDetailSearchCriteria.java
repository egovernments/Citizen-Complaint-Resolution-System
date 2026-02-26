package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ProviderDetailSearchCriteria {

    @JsonProperty("ids")
    private List<String> ids;

    @JsonProperty("providerName")
    private String providerName;

    @JsonProperty("channel")
    private String channel;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("enabled")
    private Boolean enabled;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;
}
