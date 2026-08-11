package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PolicyActionTest {

    @Test
    @SuppressWarnings("unchecked")
    void policyDocumentsAreDeeplyCopiedAndImmutable() {
        List<Object> operands = new ArrayList<>(List.of(1, 1));
        Map<String, Object> condition = new LinkedHashMap<>();
        condition.put("==", operands);
        Map<String, Object> document = new LinkedHashMap<>();
        document.put("condition", condition);

        PolicyAction action = new PolicyAction("post", "/resource/_search", document);
        operands.set(0, 2);
        condition.put("extra", true);
        document.put("resource", Map.of());

        assertEquals("POST", action.method());
        assertEquals(Map.of("condition", Map.of("==", List.of(1, 1))), action.document());

        Map<String, Object> returnedCondition = (Map<String, Object>) action.document().get("condition");
        List<Object> returnedOperands = (List<Object>) returnedCondition.get("==");
        assertThrows(UnsupportedOperationException.class, () -> action.document().put("x", true));
        assertThrows(UnsupportedOperationException.class, () -> returnedCondition.put("x", true));
        assertThrows(UnsupportedOperationException.class, () -> returnedOperands.set(0, 2));
    }

    @Test
    void invalidIdentityAndNonJsonValuesAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction(" POST", "/resource/_search", Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction("POST", " /resource/_search", Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction("POST", "/resource/_search", Map.of("bad", new Object())));
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction("POST", "/resource/_search", Map.of("bad", Map.of(1, "x"))));
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction("POST", "/resource/_search", Map.of("bad", new AtomicInteger(1))));
        assertThrows(IllegalArgumentException.class,
                () -> new PolicyAction("POST", "/resource/_search", Map.of("bad", Double.NaN)));
    }
}
