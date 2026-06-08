package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Service {

    @JsonProperty("id")
    private String id;

    @NotNull
    @JsonProperty("tenantId")
    private String tenantId;

    @NotNull
    @JsonProperty("serviceCode")
    private String serviceCode;

    @JsonProperty("serviceRequestId")
    private String serviceRequestId;

    @JsonProperty("description")
    private String description;

    @JsonProperty("accountId")
    private String accountId;

    @JsonProperty("citizen")
    private User citizen;

    @JsonProperty("source")
    @NotNull
    private String source;

    @JsonProperty("applicationStatus")
    private String applicationStatus;

    @JsonProperty("active")
    private boolean active = true;

    @Max(5)
    @Min(1)
    @JsonProperty("rating")
    private Integer rating;

    @JsonProperty("additionalDetail")
    private Object additionalDetail;

    @Valid
    @NotNull
    @JsonProperty("address")
    private Address address;

    @Valid
    @JsonProperty("documents")
    private List<Document> documents;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;

    @JsonProperty("workflowInstanceId")
    private String workflowInstanceId;

    @JsonProperty("registryId")
    private String registryId;
}
