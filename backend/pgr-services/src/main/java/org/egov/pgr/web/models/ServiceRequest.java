package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.util.List;

/**
 * Internal transport object used across the service layer.
 * Auth context (userId, tenantId, roles) is passed separately from the JWT.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ServiceRequest {

    @Valid
    @NotNull
    @JsonProperty("service")
    private Service service;

    @Valid
    @JsonProperty("workflow")
    private Workflow workflow;

    // JWT-derived fields — populated by the controller, not from request body
    private String userId;
    private String tenantId;
    private List<String> roles;
}
