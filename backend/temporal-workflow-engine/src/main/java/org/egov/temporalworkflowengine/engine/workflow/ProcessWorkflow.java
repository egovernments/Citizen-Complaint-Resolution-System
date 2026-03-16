package org.egov.temporalworkflowengine.engine.workflow;

import io.temporal.workflow.QueryMethod;
import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.egov.temporalworkflowengine.engine.model.ProcessResponse;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;

@WorkflowInterface
public interface ProcessWorkflow {

    @WorkflowMethod
    ProcessResponse startProcess(ProcessRequest request);

    @SignalMethod
    void signalProcess(ProcessRequest request);

    @QueryMethod
    ProcessSnapshot getSnapshot();
}
