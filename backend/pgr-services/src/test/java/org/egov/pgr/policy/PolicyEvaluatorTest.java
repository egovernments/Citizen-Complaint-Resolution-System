package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PolicyEvaluatorTest {

    private final PolicyEvaluator evaluator = new PolicyEvaluator(new ObjectMapper());

    @Test
    void allowsOnlyAnExplicitBooleanTrueVerdict() {
        PolicyAction action = new PolicyAction("POST", "/resource/_search",
                Map.of("condition", Map.of("==", List.of(1, 1))));

        assertTrue(evaluator.isAllowed(action.condition(), Map.of()));
        assertFalse(evaluator.isAllowed(Map.of("==", List.of(1, 2)), Map.of()));
    }

    @Test
    void truthyNonBooleanResultsAreDenied() {
        assertFalse(evaluator.isAllowed(1, Map.of()));
        assertFalse(evaluator.isAllowed("allowed", Map.of()));
        assertFalse(evaluator.isAllowed(List.of(1), Map.of()));
        assertFalse(evaluator.isAllowed(Map.of("value", true), Map.of()));
    }

    @Test
    void evaluatesVariablesAgainstTheProvidedDocument() {
        Object condition = Map.of("in", List.of(
                Map.of("var", "resource.department"), Map.of("var", "user.departments")));
        Map<String, Object> allowed = Map.of(
                "user", Map.of("departments", List.of("ROADS", "WATER")),
                "resource", Map.of("department", "WATER"));
        Map<String, Object> denied = Map.of(
                "user", Map.of("departments", List.of("ROADS")),
                "resource", Map.of("department", "WATER"));

        assertTrue(evaluator.isAllowed(condition, allowed));
        assertFalse(evaluator.isAllowed(condition, denied));
    }

    @Test
    void missingOrMalformedConditionsFailClosed() {
        assertFalse(evaluator.isAllowed(null, Map.of()));
        assertFalse(evaluator.isAllowed(Map.of(), Map.of()));
        assertFalse(evaluator.isAllowed(true, null));
        assertFalse(evaluator.isAllowed(Map.of("var", "missing"), Map.of()));
    }
}
