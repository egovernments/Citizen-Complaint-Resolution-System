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
public class ConfigResolveResponse {

    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;

    @JsonProperty("resolved")
    private ResolvedEntry resolved;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class ResolvedEntry {

        @JsonProperty("entry")
        private ConfigEntry entry;

        @JsonProperty("resolutionMeta")
        private ResolutionMeta resolutionMeta;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class ResolutionMeta {

        @JsonProperty("matchedTenant")
        private String matchedTenant;

        @JsonProperty("matchedLocale")
        private String matchedLocale;
    }
}
