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
public class ConfigDataResolveResponse {

    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;

    @JsonProperty("configData")
    private ConfigData configData;

    @JsonProperty("resolutionMeta")
    private ResolutionMeta resolutionMeta;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class ResolutionMeta {

        @JsonProperty("matchedTenant")
        private String matchedTenant;
    }
}
