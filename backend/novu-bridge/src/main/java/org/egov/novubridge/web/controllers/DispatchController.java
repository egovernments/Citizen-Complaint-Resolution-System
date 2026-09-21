package org.egov.novubridge.web.controllers;

import jakarta.validation.Valid;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.ResolutionOutcome;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.models.DispatchDryRunRequest;
import org.egov.novubridge.web.models.DispatchDryRunResponse;
import org.egov.novubridge.web.models.ThinEventResolveRequest;
import org.egov.novubridge.web.models.ThinEventResolveResponse;
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
    private final NotificationResolver notificationResolver;
    private final ResponseInfoFactory responseInfoFactory;

    public DispatchController(DispatchPipelineService dispatchPipelineService,
                              NotificationResolver notificationResolver,
                              ResponseInfoFactory responseInfoFactory) {
        this.dispatchPipelineService = dispatchPipelineService;
        this.notificationResolver = notificationResolver;
        this.responseInfoFactory = responseInfoFactory;
    }

    @PostMapping("/_validate")
    public ResponseEntity<DispatchDryRunResponse> validate(@Valid @RequestBody DispatchDryRunRequest request) {
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        DispatchDryRunResponse response = DispatchDryRunResponse.builder()
                .responseInfo(responseInfo)
                .result(dispatchPipelineService.process(request.getEvent(), false, request.getRequestInfo()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @PostMapping("/_dry-run")
    public ResponseEntity<DispatchDryRunResponse> dryRun(@Valid @RequestBody DispatchDryRunRequest request) {
        boolean send = request.getSend() != null && request.getSend();
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        DispatchDryRunResponse response = DispatchDryRunResponse.builder()
                .responseInfo(responseInfo)
                .result(dispatchPipelineService.process(request.getEvent(), send, request.getRequestInfo()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    /**
     * Resolve a thin domain event and return the envelopes it WOULD produce, without sending
     * anything and without writing a ledger row.
     *
     * <p>This is the answer to the question an operator actually asks — "why did this event send
     * nothing?" — asked <b>before</b> the event happens rather than forensically afterwards. It
     * runs the real resolver against the tenant's real config: the same routing rows, the same
     * templates, the same role pools, the same locale preferences. The only thing it does not do
     * is dispatch, which is what makes it safe to point at a production tenant.
     *
     * <p>Admin-only ({@code ProxyAuthFilter.ADMIN_ONLY_PATHS}). It expands role pools and returns
     * rendered bodies with their contact blocks filled in — that is recipient PII for every holder
     * of a role, which is a narrower thing than the Logs screen's read tier should hand out.
     */
    @PostMapping("/_resolve")
    public ResponseEntity<ThinEventResolveResponse> resolve(@Valid @RequestBody ThinEventResolveRequest request) {
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        ResolutionOutcome outcome = notificationResolver.resolve(request.getEvent(), false);
        ThinEventResolveResponse response = ThinEventResolveResponse.builder()
                .responseInfo(responseInfo)
                .envelopes(outcome.getEnvelopes())
                .terminalCode(outcome.getTerminalCode())
                .diagnostics(outcome.getDiagnostics())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
