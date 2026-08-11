package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PolicyResolutionTest {

    @Test
    void onlyResolvedResultsContainAnAction() {
        PolicyAction action = new PolicyAction("POST", "/resource/_search", Map.of());
        PolicyResolution resolved = PolicyResolution.resolved(action);

        assertTrue(resolved.isResolved());
        assertEquals(action, resolved.action().orElseThrow());

        for (PolicyResolution denied : new PolicyResolution[] {
                PolicyResolution.notAuthorized(), PolicyResolution.sourceUnavailable(),
                PolicyResolution.invalidRequest(), PolicyResolution.invalidPolicy() }) {
            assertFalse(denied.isResolved());
            assertFalse(denied.action().isPresent());
        }
    }

    @Test
    void resolvedRequiresAnAction() {
        assertThrows(NullPointerException.class, () -> PolicyResolution.resolved(null));
    }
}
