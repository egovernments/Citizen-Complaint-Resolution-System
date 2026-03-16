package org.egov.temporalworkflowengine.engine.activities;

import java.util.Map;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Component
@Order(Integer.MAX_VALUE)
public class NoOpProcessStepHandler implements ProcessStepHandler {

    @Override
    public boolean supports(String module) {
        return true;
    }

    @Override
    public ProcessSnapshot execute(String stepName, Map<String, Object> parameters, ProcessSnapshot snapshot) {
        return snapshot;
    }
}
