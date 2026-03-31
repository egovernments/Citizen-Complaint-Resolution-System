package org.egov.novubridge.web.controllers;

import jakarta.validation.Valid;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.models.DispatchDryRunRequest;
import org.egov.novubridge.web.models.DispatchDryRunResponse;
import org.egov.novubridge.web.models.TestTriggerRequest;
import org.egov.novubridge.web.models.TestTriggerResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/novu-adapter/v1/dispatch")
public class DispatchController {

    private final DispatchPipelineService dispatchPipelineService;
    private final ResponseInfoFactory responseInfoFactory;

    public DispatchController(DispatchPipelineService dispatchPipelineService,
                              ResponseInfoFactory responseInfoFactory) {
        this.dispatchPipelineService = dispatchPipelineService;
        this.responseInfoFactory = responseInfoFactory;
    }

    @PostMapping("/_validate")
    public ResponseEntity<DispatchDryRunResponse> validate(@Valid @RequestBody DispatchDryRunRequest request) {
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        DispatchDryRunResponse response = DispatchDryRunResponse.builder()
                .responseInfo(responseInfo)
                .result(dispatchPipelineService.process(request.getEvent(), false))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @PostMapping("/_dry-run")
    public ResponseEntity<DispatchDryRunResponse> dryRun(@Valid @RequestBody DispatchDryRunRequest request) {
        boolean send = request.getSend() != null && request.getSend();
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        DispatchDryRunResponse response = DispatchDryRunResponse.builder()
                .responseInfo(responseInfo)
                .result(dispatchPipelineService.process(request.getEvent(), send))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @PostMapping("/_test-trigger")
    public ResponseEntity<TestTriggerResponse> testTrigger(@Valid @RequestBody TestTriggerRequest request) {
        NovuClient.NovuResponse novuResponse = dispatchPipelineService.testTrigger(
                request.getTemplateKey(),
                request.getSubscriberId(),
                request.getPhone(),
                request.getPayload(),
                request.getTransactionId(),
                request.getContentSid(),
                request.getContentVariables());

        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        TestTriggerResponse response = TestTriggerResponse.builder()
                .responseInfo(responseInfo)
                .status("ACCEPTED")
                .novuStatusCode(novuResponse.getStatusCode())
                .novuResponse(novuResponse.getResponse())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
