package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ConfigDataResolveRequest {

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

        @JsonProperty("schemaCode")
        @NotNull
        private String schemaCode;

        @JsonProperty("tenantId")
        @NotNull
        private String tenantId;

        @JsonProperty("criteria")
        private Map<String, String> criteria;
    }
}
