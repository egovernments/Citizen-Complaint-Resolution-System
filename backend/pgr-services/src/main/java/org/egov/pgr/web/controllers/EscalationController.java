package org.egov.pgr.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.pgr.service.EscalationScheduler;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.EscalationTriggerRequest;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

import javax.validation.Valid;

/**
 * Admin/test endpoint that lets a SUPERUSER kick the escalation scheduler
 * synchronously, without waiting for the next cron tick. Designed for:
 * <ul>
 *   <li>Integration tests that want to assert "complaint X got escalated"
 *       immediately after seeding state.</li>
 *   <li>The configurator UI ("Run escalation now") button.</li>
 * </ul>
 *
 * <p>Returns the same {@link EscalationTriggerResponse} the scheduler logs
 * and emits as OTEL span attributes, so the caller can verify scanned /
 * escalated / skipped counts and the per-skip-reason breakdown.</p>
 */
@Controller
@RequestMapping("/escalation")
@Slf4j
public class EscalationController {

    private final EscalationScheduler escalationScheduler;
    private final ResponseInfoFactory responseInfoFactory;

    @Autowired
    public EscalationController(EscalationScheduler escalationScheduler,
                                ResponseInfoFactory responseInfoFactory) {
        this.escalationScheduler = escalationScheduler;
        this.responseInfoFactory = responseInfoFactory;
    }

    @PostMapping("/_trigger")
    public ResponseEntity<EscalationTriggerResponse> trigger(@Valid @RequestBody EscalationTriggerRequest request) {

        RequestInfo requestInfo = request.getRequestInfo();
        if (requestInfo == null || requestInfo.getUserInfo() == null) {
            throw new CustomException("UNAUTHORIZED", "RequestInfo.userInfo is required");
        }

        boolean isSuperUser = requestInfo.getUserInfo().getRoles() != null
                && requestInfo.getUserInfo().getRoles().stream()
                .anyMatch(r -> r != null && "SUPERUSER".equalsIgnoreCase(r.getCode()));

        if (!isSuperUser) {
            throw new CustomException("UNAUTHORIZED",
                    "Only users with the SUPERUSER role may trigger escalation scans");
        }

        if (request.getTenantId() == null || request.getTenantId().trim().isEmpty()) {
            throw new CustomException("INVALID_REQUEST", "tenantId is mandatory");
        }

        // Tag the caller with AUTO_ESCALATE so the manual-ESCALATE comment
        // check in ServiceRequestValidator stays out of the way for the
        // scheduler-driven transitions this endpoint will fan out. We make a
        // mutable copy because the auth filter may have given us an immutable
        // List for roles.
        java.util.List<org.egov.common.contract.request.Role> existingRoles =
                requestInfo.getUserInfo().getRoles();
        java.util.List<org.egov.common.contract.request.Role> mutableRoles =
                existingRoles == null
                        ? new java.util.ArrayList<>()
                        : new java.util.ArrayList<>(existingRoles);
        boolean alreadyTagged = mutableRoles.stream()
                .anyMatch(r -> r != null && "AUTO_ESCALATE".equalsIgnoreCase(r.getCode()));
        if (!alreadyTagged) {
            mutableRoles.add(
                    org.egov.common.contract.request.Role.builder()
                            .code("AUTO_ESCALATE")
                            .name("Auto Escalate")
                            .tenantId(request.getTenantId())
                            .build()
            );
            requestInfo.getUserInfo().setRoles(mutableRoles);
        }

        log.info("Manual escalation trigger: tenantId={}, scope={}",
                request.getTenantId(),
                request.getServiceRequestIds() == null ? "all" : request.getServiceRequestIds());

        EscalationTriggerResponse response = escalationScheduler.scanAndEscalateOnce(
                request.getTenantId(),
                request.getServiceRequestIds(),
                requestInfo
        );

        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(requestInfo, true);
        response.setResponseInfo(responseInfo);

        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
