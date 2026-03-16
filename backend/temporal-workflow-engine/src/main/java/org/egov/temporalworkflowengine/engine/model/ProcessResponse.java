package org.egov.temporalworkflowengine.engine.model;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcessResponse {

    private String workflowId;
    private String runId;
    private String businessId;
    private String state;
    private String assignee;
    private boolean escalated;
    private List<String> availableActions;
    private String message;
}
