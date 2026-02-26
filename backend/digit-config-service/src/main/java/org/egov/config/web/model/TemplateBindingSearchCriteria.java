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
public class TemplateBindingSearchCriteria {

    @JsonProperty("ids")
    private List<String> ids;

    @JsonProperty("eventName")
    private String eventName;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("templateId")
    private String templateId;

    @JsonProperty("providerId")
    private String providerId;

    @JsonProperty("locale")
    private String locale;

    @JsonProperty("enabled")
    private Boolean enabled;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;
}
