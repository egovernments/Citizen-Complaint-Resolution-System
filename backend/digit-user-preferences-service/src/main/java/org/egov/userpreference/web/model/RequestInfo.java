package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request metadata block (DIGIT standard).
 *
 * <p>Callers disagree on the casing of the wrapper key — novu-bridge's
 * {@code PreferenceServiceClient} sends {@code requestInfo} while the seed
 * scripts and the platform docs send {@code RequestInfo}. The Go service
 * accepted both because {@code encoding/json} matches keys
 * case-insensitively; see {@link PreferenceRequest} for how that is preserved.
 */
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

    @JsonProperty("requesterId")
    private String requesterId;

    @JsonProperty("authToken")
    private String authToken;

    @JsonProperty("userInfo")
    private UserInfo userInfo;

    @JsonProperty("correlationId")
    private String correlationId;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class UserInfo {

        @JsonProperty("tenantId")
        private String tenantId;

        /** Numeric in most DIGIT services but sometimes quoted; see {@link FlexibleStringDeserializer}. */
        @JsonProperty("id")
        @JsonDeserialize(using = FlexibleStringDeserializer.class)
        private String id;

        @JsonProperty("userName")
        private String userName;

        @JsonProperty("name")
        private String name;

        @JsonProperty("type")
        private String type;

        @JsonProperty("mobileNumber")
        private String mobileNumber;

        @JsonProperty("emailId")
        private String emailId;

        @JsonProperty("roles")
        private List<Role> roles;

        @JsonProperty("uuid")
        private String uuid;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class Role {

        @JsonProperty("id")
        private Long id;

        @JsonProperty("name")
        private String name;

        @JsonProperty("code")
        private String code;

        @JsonProperty("tenantId")
        private String tenantId;
    }
}
