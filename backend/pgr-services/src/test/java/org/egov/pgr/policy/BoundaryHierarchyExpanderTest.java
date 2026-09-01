package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies {@link BoundaryHierarchyExpander} flattens boundary-service's nested
 * {@code boundary-relationships/_search} response into a flat descendant set, caches successful
 * resolutions, and falls back to the single unexpanded code — never a thrown exception — on any
 * lookup failure, since that fallback is strictly more restrictive than a successful expansion
 * (see the class Javadoc for why this differs from {@link AccessPolicyRegistry}'s fail-closed
 * outage handling).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BoundaryHierarchyExpanderTest {

    @Mock
    private RestTemplate restTemplate;

    private BoundaryHierarchyExpander expander;

    @BeforeEach
    void setup() {
        PGRConfiguration config = new PGRConfiguration();
        config.setBoundaryHost("http://localhost:8081/");
        config.setBoundaryRelationshipSearchEndpoint("/boundary-service/boundary-relationships/_search");
        expander = new BoundaryHierarchyExpander(config, restTemplate, new ObjectMapper());
    }

    private static Map<String, Object> nestedBoundaryResponse() {
        Map<String, Object> ward1 = Map.of("code", "BOMET_BOMET_CENTRAL_CHESOEN", "children", List.of());
        Map<String, Object> ward2 = Map.of("code", "BOMET_BOMET_CENTRAL_MUTARAKWA", "children", List.of());
        Map<String, Object> subCounty = Map.of("code", "BOMET_BOMET_CENTRAL", "children", List.of(ward1, ward2));
        Map<String, Object> county = Map.of("code", "BOMET", "children", List.of(subCounty));
        Map<String, Object> tenantBoundary = Map.of("boundary", List.of(county));
        return Map.of("TenantBoundary", List.of(tenantBoundary));
    }

    @Test
    void flattensTheNestedChildrenIntoAFlatDescendantSet() {
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class))).thenReturn(nestedBoundaryResponse());

        Set<String> codes = expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");

        assertEquals(Set.of("BOMET", "BOMET_BOMET_CENTRAL", "BOMET_BOMET_CENTRAL_CHESOEN", "BOMET_BOMET_CENTRAL_MUTARAKWA"), codes);
    }

    @Test
    void cachesASuccessfulResolutionAndDoesNotRefetch() {
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class))).thenReturn(nestedBoundaryResponse());

        expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");
        expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");

        verify(restTemplate, times(1)).postForObject(anyString(), any(), eq(Map.class));
    }

    @Test
    void fallsBackToTheSingleUnexpandedCodeWhenTheLookupThrows() {
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class))).thenThrow(new RuntimeException("boundary-service unavailable"));

        Set<String> codes = expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");

        assertEquals(Set.of("BOMET"), codes);
    }

    @Test
    void aFailedLookupIsNotCached() {
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class)))
                .thenThrow(new RuntimeException("boundary-service unavailable"))
                .thenReturn(nestedBoundaryResponse());

        Set<String> first = expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");
        Set<String> second = expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", "BOMET");

        assertEquals(Set.of("BOMET"), first);
        assertTrue(second.contains("BOMET_BOMET_CENTRAL_CHESOEN"), "a later successful lookup should not be shadowed by the earlier failure");
    }

    @Test
    void emptyOrNullInputsResolveToAnEmptySetWithoutCallingTheService() {
        assertEquals(Set.of(), expander.descendantsOf(new RequestInfo(), null, "ADMIN", "BOMET"));
        assertEquals(Set.of(), expander.descendantsOf(new RequestInfo(), "ke", null, "BOMET"));
        assertEquals(Set.of(), expander.descendantsOf(new RequestInfo(), "ke", "ADMIN", ""));

        verify(restTemplate, times(0)).postForObject(anyString(), any(), eq(Map.class));
    }
}
