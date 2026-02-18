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
public class RequestInfo {

    @JsonProperty("apiId")
    private String apiId;

    @JsonProperty("ver")
    private String ver;

    @JsonProperty("ts")
    private Long ts;

    @JsonProperty("action")
    private String action;

    @JsonProperty("did")
    private String did;

    @JsonProperty("key")
    private String key;

    @JsonProperty("msgId")
    private String msgId;

    @JsonProperty("authToken")
    private String authToken;

    @JsonProperty("userInfo")
    private UserInfo userInfo;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class UserInfo {

        @JsonProperty("uuid")
        private String uuid;

        @JsonProperty("id")
        private Long id;

        @JsonProperty("userName")
        private String userName;

        @JsonProperty("tenantId")
        private String tenantId;
    }
}
