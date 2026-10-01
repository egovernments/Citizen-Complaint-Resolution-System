package org.egov.novubridge.web.controllers;

import jakarta.validation.Valid;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.ResolutionOutcome;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.DispatchDryRunRequest;
import org.egov.novubridge.web.models.DispatchDryRunResponse;
import org.egov.novubridge.web.models.ThinEventResolveRequest;
import org.egov.novubridge.web.models.ThinEventResolveResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Map;
import java.util.Set;

/**
 * {@code _dry-run} and {@code _resolve} are on ProxyAuthFilter's admin tier (an admin role held at a
 * state tenant), scoped here to the event's tenant: the admin of its state root may run them, as
 * may an admin of a state that owns the providers (any tenant). {@code _dry-run} with
 * {@code send:true} is a real send, of the caller's wording, through the deployment-wide providers,
 * so like test-send it stays with the owning states. 403 {@code NB_TENANT_NOT_ALLOWED} otherwise.
 */
@Controller
@RequestMapping("/novu-adapter/v1/dispatch")
public class DispatchController {

    private final DispatchPipelineService dispatchPipelineService;
    private final NotificationResolver notificationResolver;
    private final ResponseInfoFactory responseInfoFactory;
    private final NovuBridgeConfiguration config;

    public DispatchController(DispatchPipelineService dispatchPipelineService,
                              NotificationResolver notificationResolver,
                              ResponseInfoFactory responseInfoFactory,
                              NovuBridgeConfiguration config) {
        this.dispatchPipelineService = dispatchPipelineService;
        this.notificationResolver = notificationResolver;
        this.responseInfoFactory = responseInfoFactory;
        this.config = config;
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
        requireTenantAdmin(request.getEvent() == null ? null : request.getEvent().getTenantId(), send);
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        DispatchDryRunResponse response = DispatchDryRunResponse.builder()
                .responseInfo(responseInfo)
                .result(dispatchPipelineService.process(request.getEvent(), send, request.getRequestInfo()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    /**
     * The envelopes a thin event WOULD produce against the tenant's real config: nothing sent, no
     * ledger row. Admin of the event tenant's state only: the answer carries recipient PII for every
     * holder of a role.
     */
    @PostMapping("/_resolve")
    public ResponseEntity<ThinEventResolveResponse> resolve(@Valid @RequestBody ThinEventResolveRequest request) {
        requireTenantAdmin(request.getEvent() == null ? null : request.getEvent().getTenantId(), false);
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

    /**
     * The tenant scope of the admin tier's dispatch endpoints. A null caller means proxy auth is off
     * (local dev), where the filter admits everything.
     */
    private void requireTenantAdmin(String tenantId, boolean sends) {
        ProxyAuthFilter.Caller caller = ProxyAuthFilter.currentCaller();
        if (caller == null) {
            return;
        }
        Set<String> owning = config.providerAdminStateTenants();
        if (caller.administersAnyOf(owning)) {
            return;
        }
        String owners = owning.isEmpty() ? "(none configured)" : String.join(", ", owning);
        if (sends) {
            throw new ProviderController.Refusal(HttpStatus.FORBIDDEN, "NB_TENANT_NOT_ALLOWED",
                    "_dry-run with send:true sends a real message through the deployment's shared providers, so "
                            + "only an admin of " + owners + " may; leave send out to validate without sending");
        }
        if (!caller.administersStateOf(tenantId)) {
            throw new ProviderController.Refusal(HttpStatus.FORBIDDEN, "NB_TENANT_NOT_ALLOWED",
                    "You hold no admin role at the state root of the event's tenantId ("
                            + (tenantId == null ? "none given" : ChannelPolicyClient.stateTenant(tenantId.trim()))
                            + "), nor at a state that owns the providers (" + owners + ")");
        }
    }

    @ExceptionHandler(ProviderController.Refusal.class)
    ResponseEntity<Map<String, Object>> refused(ProviderController.Refusal refusal) {
        return refusal.toResponse();
    }
}
