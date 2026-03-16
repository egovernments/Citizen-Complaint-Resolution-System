package org.egov.temporalworkflowengine.engine.activities;

import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityMethod;
import java.util.Map;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;

@ActivityInterface
public interface ProcessActivities {

    @ActivityMethod
    ProcessSnapshot executeStep(String stepName, Map<String, Object> parameters, ProcessSnapshot snapshot);
}
