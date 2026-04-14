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

    @JsonProperty("plainAccessRequest")
    private Object plainAccessRequest;

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

        @JsonProperty("name")
        private String name;

        @JsonProperty("mobileNumber")
        private String mobileNumber;

        @JsonProperty("emailId")
        private String emailId;

        @JsonProperty("locale")
        private String locale;

        @JsonProperty("type")
        private String type;

        @JsonProperty("roles")
        private List<Role> roles;

        @JsonProperty("active")
        private Boolean active;

        @JsonProperty("tenantId")
        private String tenantId;

        @JsonProperty("permanentCity")
        private String permanentCity;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class Role {

        @JsonProperty("name")
        private String name;

        @JsonProperty("code")
        private String code;

        @JsonProperty("tenantId")
        private String tenantId;
    }
}
