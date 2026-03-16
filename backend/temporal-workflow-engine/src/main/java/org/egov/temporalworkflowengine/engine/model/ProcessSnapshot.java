package org.egov.temporalworkflowengine.engine.model;

import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class ProcessSnapshot {

    private String workflowId;
    private String module;
    private String workflow;
    private String tenantId;
    private String businessId;
    private String state;
    private String assignee;
    private boolean waitingForSignal;
    private boolean escalated;
    private List<String> availableActions;
    private Map<String, Object> payload;
    private Map<String, Object> signalPayload;
    private Map<String, Object> metadata;
    private String lastAction;
}
