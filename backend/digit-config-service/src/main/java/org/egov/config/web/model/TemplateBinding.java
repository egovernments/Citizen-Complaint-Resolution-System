package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class TemplateBinding {

    @JsonProperty("id")
    private String id;

    @JsonProperty("templateId")
    private String templateId;

    @JsonProperty("providerId")
    private String providerId;

    @JsonProperty("eventName")
    private String eventName;

    @JsonProperty("contentSid")
    private String contentSid;

    @JsonProperty("locale")
    private String locale;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("paramOrder")
    private java.util.List<String> paramOrder;

    @JsonProperty("requiredVars")
    private java.util.List<String> requiredVars;

    @JsonProperty("enabled")
    @Builder.Default
    private Boolean enabled = true;

    @JsonProperty("providerDetail")
    private ProviderDetail providerDetail;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;
}
