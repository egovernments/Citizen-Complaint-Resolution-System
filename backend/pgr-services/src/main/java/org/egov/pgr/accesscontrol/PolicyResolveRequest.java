package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.RequestInfo;

import java.util.List;

/** Outbound body for {@code POST /access/v1/policy/_resolve} — mirrors egov-accesscontrol's {@code PolicyResolveRequest} exactly. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PolicyResolveRequest {
    @JsonProperty("RequestInfo")
    private RequestInfo requestInfo;
    private String tenantId;
    private List<ActionQuery> actions;
}
