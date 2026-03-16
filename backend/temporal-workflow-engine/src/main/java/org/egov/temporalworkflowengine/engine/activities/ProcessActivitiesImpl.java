package org.egov.temporalworkflowengine.engine.activities;

import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ProcessActivitiesImpl implements ProcessActivities {

    private final List<ProcessStepHandler> stepHandlers;

    @Override
    public ProcessSnapshot executeStep(String stepName, Map<String, Object> parameters, ProcessSnapshot snapshot) {
        return stepHandlers.stream()
                .filter(handler -> handler.supports(snapshot.getModule()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No step handler registered for module " + snapshot.getModule()))
                .execute(stepName, parameters, snapshot);
    }
}
