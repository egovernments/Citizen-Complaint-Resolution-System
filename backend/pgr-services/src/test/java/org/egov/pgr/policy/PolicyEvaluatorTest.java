package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PolicyEvaluatorTest {

    private final PolicyEvaluator evaluator = new PolicyEvaluator();

    private static final String SEARCH_CONDITION = """
            {
              "or": [
                { "==": [ { "var": "user.attributes.tenantWide" }, true ] },
                { "and": [
                    { "==": [ { "var": "user.type" }, "CITIZEN" ] },
                    { "==": [ { "var": "resource.complaint.accountId" }, { "var": "user.uuid" } ] }
                ]},
                { "and": [
                    { "==": [ { "var": "user.type" }, "EMPLOYEE" ] },
                    { "in": [ { "var": "resource.complaint.department" }, { "var": "user.attributes.departments" } ] }
                ]}
              ]
            }
            """;

    @Test
    void tenantWideBypassAllowsRegardlessOfResource() {
        Map<String, Object> data = Map.of(
                "user", Map.of("uuid", "u1", "type", "EMPLOYEE", "attributes", Map.of("tenantWide", true, "departments", List.of())),
                "resource", Map.of("complaint", Map.of("accountId", "someone-else", "department", "OTHER")));

        assertTrue(evaluator.isAllowed(SEARCH_CONDITION, data));
    }

    @Test
    void citizenOwningTheComplaintIsAllowed() {
        Map<String, Object> data = Map.of(
                "user", Map.of("uuid", "citizen-1", "type", "CITIZEN", "attributes", Map.of("tenantWide", false, "departments", List.of())),
                "resource", Map.of("complaint", Map.of("accountId", "citizen-1", "department", "NA")));

        assertTrue(evaluator.isAllowed(SEARCH_CONDITION, data));
    }

    @Test
    void citizenNotOwningTheComplaintIsDenied() {
        Map<String, Object> data = Map.of(
                "user", Map.of("uuid", "citizen-1", "type", "CITIZEN", "attributes", Map.of("tenantWide", false, "departments", List.of())),
                "resource", Map.of("complaint", Map.of("accountId", "citizen-2", "department", "NA")));

        assertFalse(evaluator.isAllowed(SEARCH_CONDITION, data));
    }

    @Test
    void employeeInMatchingDepartmentIsAllowed() {
        Map<String, Object> data = Map.of(
                "user", Map.of("uuid", "emp-1", "type", "EMPLOYEE", "attributes", Map.of("tenantWide", false, "departments", List.of("SANITATION"))),
                "resource", Map.of("complaint", Map.of("accountId", "citizen-2", "department", "SANITATION")));

        assertTrue(evaluator.isAllowed(SEARCH_CONDITION, data));
    }

    @Test
    void employeeInDifferentDepartmentIsDenied() {
        Map<String, Object> data = Map.of(
                "user", Map.of("uuid", "emp-1", "type", "EMPLOYEE", "attributes", Map.of("tenantWide", false, "departments", List.of("SANITATION"))),
                "resource", Map.of("complaint", Map.of("accountId", "citizen-2", "department", "ROADS")));

        assertFalse(evaluator.isAllowed(SEARCH_CONDITION, data));
    }

    @Test
    void malformedConditionFailsClosed() {
        Map<String, Object> data = Map.of("user", Map.of("uuid", "u1"));

        assertFalse(evaluator.isAllowed("{not-valid-json", data));
    }

    @Test
    void nullConditionFailsClosed() {
        assertFalse(evaluator.isAllowed(null, Map.of()));
    }
}
