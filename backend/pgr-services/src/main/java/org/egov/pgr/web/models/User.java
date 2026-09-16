package org.egov.pgr.web.models;

import org.egov.pgr.annotation.SafeHtml;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.Role;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User {

    private Long id;
    @SafeHtml
    private String userName;
    @SafeHtml
    private String name;
    @SafeHtml
    private String type;
    @SafeHtml
    private String mobileNumber;
    @SafeHtml
    private String countryCode;
    @SafeHtml
    private String emailId;
    @SafeHtml
    private String correspondenceAddress;
    private List<Role> roles;
    @SafeHtml
    private String tenantId;
    @SafeHtml
    private String uuid;
    private Boolean active;
}
