package org.egov.pgr.web.controllers;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.service.EscalationScheduler;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.EscalationTriggerRequest;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

/**
 * Controller-level coverage for {@code POST /escalation/_trigger} status
 * mapping. The design doc promises HTTP 409 for SCAN_IN_PROGRESS, but the
 * tracer's default CustomException handling maps every code to 400 — so the
 * controller translates exactly that one code itself.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationControllerTest {

    @Mock private EscalationScheduler escalationScheduler;
    @Mock private ResponseInfoFactory responseInfoFactory;

    @InjectMocks
    private EscalationController controller;

    private static EscalationTriggerRequest superuserRequest() {
        RequestInfo requestInfo = RequestInfo.builder()
                .userInfo(User.builder()
                        .uuid("admin-uuid")
                        .roles(Collections.singletonList(Role.builder().code("SUPERUSER").build()))
                        .build())
                .build();
        return EscalationTriggerRequest.builder()
                .requestInfo(requestInfo)
                .tenantId("ke")
                .build();
    }

    /** SCAN_IN_PROGRESS ⇒ 409 Conflict with a small {code, message} error body. */
    @Test
    void scanInProgress_mapsTo409Conflict() {
        when(escalationScheduler.scanAndEscalateOnce(eq("ke"), isNull(), any(), eq(false)))
                .thenThrow(new CustomException("SCAN_IN_PROGRESS",
                        "An escalation scan is already running — retry shortly"));

        ResponseEntity<?> response = controller.trigger(superuserRequest());

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals("SCAN_IN_PROGRESS", body.get("code"));
        assertEquals("An escalation scan is already running — retry shortly", body.get("message"));
    }

    /** Only SCAN_IN_PROGRESS is translated — every other CustomException keeps the tracer's handling. */
    @Test
    void otherCustomExceptions_propagateUnchanged() {
        when(escalationScheduler.scanAndEscalateOnce(any(), any(), any(), anyBoolean()))
                .thenThrow(new CustomException("SOME_OTHER_ERROR", "boom"));

        CustomException ex = assertThrows(CustomException.class,
                () -> controller.trigger(superuserRequest()));
        assertEquals("SOME_OTHER_ERROR", ex.getCode());
    }

    /** Happy path stays 200 with the scheduler's response body. */
    @Test
    void happyPath_returns200WithTriggerResponse() {
        EscalationTriggerResponse triggerResponse = EscalationTriggerResponse.builder()
                .tenantId("ke")
                .scanned(3)
                .build();
        when(escalationScheduler.scanAndEscalateOnce(eq("ke"), isNull(), any(), eq(false)))
                .thenReturn(triggerResponse);

        ResponseEntity<?> response = controller.trigger(superuserRequest());

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertSame(triggerResponse, response.getBody());
    }
}
