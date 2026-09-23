package org.egov.pgr.validator;

import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * CCRS #2132 — an ASSIGN with no assignee orphans the complaint.
 *
 * <p>ASSIGN is the only transition that hands a complaint to a named owner, and
 * PENDINGATLME has no queue behind it. Without an assignee the complaint leaves the
 * unassigned queue where a GRO would see it, and automatic escalation skips it forever
 * because there is no assignee whose reportingTo could be resolved.
 *
 * <p>`PG-PGR-2026-09-23-284904` on bomet is the reported case: APPLY, then ASSIGN with no
 * assignee row, then nothing — rank 1 of PENDINGATLME and scanned on every pass, but never
 * escalated. 160 more were found in the same state during the PENDINGATSUPERVISOR
 * migration. Validation is server-side because the UI is not the only writer.</p>
 */
public class AssignRequiresAssigneeTest {

    @Test
    void assignWithoutAnAssigneeIsRejected() {
        CustomException thrown = assertThrows(CustomException.class,
                () -> validate(request("ASSIGN", null)));
        assertEquals("ASSIGNEE_REQUIRED", thrown.getCode());
    }

    @Test
    void assignWithAnEmptyAssigneeListIsRejected() {
        assertThrows(CustomException.class,
                () -> validate(request("ASSIGN", Collections.emptyList())));
    }

    @Test
    void assignWhoseOnlyAssigneeIsBlankIsRejected() {
        assertThrows(CustomException.class,
                () -> validate(request("ASSIGN", Arrays.asList("  ", null))));
    }

    @Test
    void assignWithAnAssigneeIsAccepted() {
        assertDoesNotThrow(() -> validate(
                request("ASSIGN", Collections.singletonList("53d85ed2-445c-42cb-8b2b-c84861a1143c"))));
    }

    @Test
    void otherActionsAreUnaffected() {
        // ESCALATE deliberately omits assignes — the server resolves reportingTo. REASSIGN
        // returns the complaint to a queue a GRO owns, so it needs no assignee either.
        assertDoesNotThrow(() -> validate(request("ESCALATE", null)));
        assertDoesNotThrow(() -> validate(request("REASSIGN", null)));
        assertDoesNotThrow(() -> validate(request("RESOLVE", null)));
        assertDoesNotThrow(() -> validate(request(null, null)));
    }

    /** Invokes the private validator directly: the rule is independent of MDMS and the DB. */
    private void validate(ServiceRequest request) throws Exception {
        Method method = ServiceRequestValidator.class
                .getDeclaredMethod("validateAssignee", ServiceRequest.class);
        method.setAccessible(true);
        try {
            method.invoke(newValidator(), request);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw e;
        }
    }

    private ServiceRequestValidator newValidator() throws Exception {
        java.lang.reflect.Constructor<ServiceRequestValidator> constructor =
                (java.lang.reflect.Constructor<ServiceRequestValidator>)
                        ServiceRequestValidator.class.getDeclaredConstructors()[0];
        constructor.setAccessible(true);
        Object[] args = new Object[constructor.getParameterCount()];
        return constructor.newInstance(args);
    }

    private static ServiceRequest request(String action, List<String> assignes) {
        return ServiceRequest.builder()
                .service(Service.builder().serviceRequestId("PG-PGR-2026-09-23-284904").build())
                .workflow(action == null ? null
                        : Workflow.builder().action(action).assignes(assignes).build())
                .build();
    }
}
