package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ConfigResolveRequest {

    @JsonProperty("RequestInfo")
    @NotNull
    @Valid
    private RequestInfo requestInfo;

    @JsonProperty("resolveRequest")
    @NotNull
    @Valid
    private ResolveParams resolveRequest;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class ResolveParams {

        @JsonProperty("configCode")
        @NotNull
        private String configCode;

        @JsonProperty("module")
        private String module;

        @JsonProperty("tenantId")
        @NotNull
        private String tenantId;

        @JsonProperty("locale")
        private String locale;

        @JsonProperty("selectors")
        private JsonNode selectors;

        @JsonProperty("decryptSensitive")
        private Boolean decryptSensitive;
    }
}
