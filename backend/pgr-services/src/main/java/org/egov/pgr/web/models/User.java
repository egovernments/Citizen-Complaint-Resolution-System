package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User {

    @JsonProperty("id")
    private Long id;

    @JsonProperty("userName")
    private String userName;

    @JsonProperty("name")
    private String name;

    @JsonProperty("type")
    private String type;

    @JsonProperty("mobileNumber")
    private String mobileNumber;

    @JsonProperty("countryCode")
    private String countryCode;

    @JsonProperty("emailId")
    private String emailId;

    @JsonProperty("roles")
    private List<Role> roles;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("uuid")
    private String uuid;

    @JsonProperty("active")
    private Boolean active;
}
