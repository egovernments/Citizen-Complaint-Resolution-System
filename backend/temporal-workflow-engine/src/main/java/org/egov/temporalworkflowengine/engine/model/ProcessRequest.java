package org.egov.temporalworkflowengine.engine.model;

import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class ProcessRequest {

    private String workflowId;
    private String tenantId;
    private String module;
    private String workflow;
    private String action;
    private String businessId;
    private String correlationId;
    private Map<String, Object> actor;
    private Map<String, Object> payload;
}
