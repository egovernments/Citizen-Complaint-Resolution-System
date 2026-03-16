package org.egov.temporalworkflowengine.engine.activities;

import java.util.Map;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;

public interface ProcessStepHandler {

    boolean supports(String module);

    ProcessSnapshot execute(String stepName, Map<String, Object> parameters, ProcessSnapshot snapshot);
}
