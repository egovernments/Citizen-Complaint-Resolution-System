package org.egov.temporalworkflowengine.controller;

import lombok.RequiredArgsConstructor;
import org.egov.temporalworkflowengine.client.WorkflowEngineClient;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.egov.temporalworkflowengine.engine.model.ProcessResponse;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/workflow-engine/v1/process")
@RequiredArgsConstructor
public class WorkflowEngineController {

    private final WorkflowEngineClient workflowEngineClient;

    @PostMapping("/start")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ProcessResponse start(@RequestBody ProcessRequest request) {
        return workflowEngineClient.start(request);
    }

    @PostMapping("/signal")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ProcessResponse signal(@RequestBody ProcessRequest request) {
        return workflowEngineClient.signal(request);
    }

    @GetMapping("/{workflowId}")
    public ProcessSnapshot snapshot(@PathVariable String workflowId) {
        return workflowEngineClient.snapshot(workflowId);
    }
}
