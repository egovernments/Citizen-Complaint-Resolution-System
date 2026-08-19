package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.RequestInfo;

import java.util.List;

/**
 * Outbound body for {@code POST /access/v1/policy/resources/_evaluate} — mirrors
 * egov-accesscontrol's {@code ResourceEvaluationRequest} exactly: ONE action plus the page of rows
 * being returned, evaluated in bulk so a page costs one call rather than one per row.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResourceEvaluationRequest {
    @JsonProperty("RequestInfo")
    private RequestInfo requestInfo;
    private String tenantId;
    private ActionQuery action;
    private List<ResourceInput> resources;
}
