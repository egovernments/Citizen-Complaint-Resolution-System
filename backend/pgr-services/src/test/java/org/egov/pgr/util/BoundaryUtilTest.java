package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins BoundaryUtil's subtree-expansion contract: a jurisdiction code mapped above leaf level
 * must expand to its full descendant set (not just immediate children), repeat expansions of the
 * same code are served from cache within the TTL, and an expansion failure never narrows below
 * the raw code — it falls back to a stale cache if one exists, or the bare code otherwise.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BoundaryUtilTest {

    private static final String TENANT = "mz.maputo";
    private static final String HIERARCHY = "MAPUTO_ADMIN";

    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private PGRConfiguration config;

    private BoundaryUtil boundaryUtil;

    @BeforeEach
    void setUp() {
        boundaryUtil = new BoundaryUtil(serviceRequestRepository, config);
        when(config.getBoundaryHost()).thenReturn("http://boundary-service/");
        when(config.getBoundaryRelationshipSearchEndpoint()).thenReturn("/boundary-service/boundary-relationships/_search");
    }

    /** {"TenantBoundary":[{"boundary":[<roots>]}]} — the shape fetchResult returns. */
    private Map<String, Object> response(List<Object> roots) {
        Map<String, Object> tenantBoundary = new LinkedHashMap<>();
        tenantBoundary.put("boundary", roots);
        List<Object> list = new ArrayList<>();
        list.add(tenantBoundary);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("TenantBoundary", list);
        return root;
    }

    private Map<String, Object> node(String code, List<Object> children) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("code", code);
        node.put("boundaryType", "WARD");
        if (children != null)
            node.put("children", children);
        return node;
    }

    private List<Object> listOf(Object... items) {
        List<Object> list = new ArrayList<>();
        for (Object item : items) list.add(item);
        return list;
    }

    @Test
    void expandsAboveLeafJurisdiction_toFullDescendantSubtree() {
        when(config.getJurisdictionSubtreeCacheTtlMs()).thenReturn(300000L);
        // KAMPFUMO -> [WARD1, WARD2] — a two-level subtree, not just the root.
        Map<String, Object> tree = node("KAMPFUMO", listOf(node("WARD1", null), node("WARD2", null)));
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(listOf(tree)));

        Set<String> expanded = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());

        assertEquals(Set.of("KAMPFUMO", "WARD1", "WARD2"), expanded);
    }

    @Test
    void leafJurisdiction_expandsToJustItself() {
        when(config.getJurisdictionSubtreeCacheTtlMs()).thenReturn(300000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(listOf(node("WARD1", null))));

        Set<String> expanded = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "WARD1", new RequestInfo());

        assertEquals(Set.of("WARD1"), expanded);
    }

    @Test
    void repeatExpansion_isServedFromCache_withinTtl() {
        when(config.getJurisdictionSubtreeCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(listOf(node("KAMPFUMO", listOf(node("WARD1", null))))));

        boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());
        Set<String> second = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());

        assertEquals(Set.of("KAMPFUMO", "WARD1"), second);
        verify(serviceRequestRepository, times(1)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void expansionFailure_withNoPriorCache_fallsBackToRawCode() {
        when(config.getJurisdictionSubtreeCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenThrow(new RuntimeException("boundary-service down"));

        Set<String> expanded = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());

        assertEquals(Set.of("KAMPFUMO"), expanded);
    }

    @Test
    void expansionFailure_afterPriorSuccess_servesStaleSubtree_ratherThanNarrowing() {
        when(config.getJurisdictionSubtreeCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(listOf(node("KAMPFUMO", listOf(node("WARD1", null))))))
                .thenThrow(new RuntimeException("boundary-service down"));

        Set<String> first = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());
        assertEquals(Set.of("KAMPFUMO", "WARD1"), first);

        try { Thread.sleep(80); } catch (InterruptedException ignored) { }

        // TTL expired and boundary-service is failing: serve the stale (still WARD1-inclusive)
        // subtree rather than collapsing back to just "KAMPFUMO".
        Set<String> second = boundaryUtil.expandToDescendants(TENANT, HIERARCHY, "KAMPFUMO", new RequestInfo());
        assertEquals(Set.of("KAMPFUMO", "WARD1"), second);
    }
}
