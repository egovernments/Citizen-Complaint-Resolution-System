package org.egov.pgr.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins the notification-master cache semantics (B7): the routing/template caches carry a short TTL
 * so configurator edits become visible without a restart, empty MDMS results are never cached
 * (transient miss is retried on the next event), and a stale non-empty entry is served during an
 * MDMS outage rather than dropping notifications.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class MDMSUtilsNotificationCacheTest {

    private static final String TENANT = "ke.bomet";

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private ObjectMapper objectMapper;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private MDMSUtils mdmsUtils;

    @BeforeEach
    void setUp() {
        // MDMSUtils takes config/repo/mapper via constructor and multiStateInstanceUtil via field
        // injection; wire the field explicitly since we build the instance by hand.
        mdmsUtils = new MDMSUtils(config, serviceRequestRepository, objectMapper);
        ReflectionTestUtils.setField(mdmsUtils, "multiStateInstanceUtil", multiStateInstanceUtil);
        // Identity state-tenant so the cache key is the tenant itself.
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenAnswer(inv -> inv.getArgument(0));
        when(config.getMdmsHost()).thenReturn("http://mdms/");
        when(config.getMdmsEndPoint()).thenReturn("mdms/v1/_search");
    }

    /** {"MdmsRes":{"RAINMAKER-PGR":{"NotificationRouting":[rows]}}} — the shape fetchResult returns. */
    private Map<String, Object> response(List<Object> rows) {
        return responseFor("NotificationRouting", rows);
    }

    /** {"MdmsRes":{"RAINMAKER-PGR":{"NotificationTemplate":[rows]}}} — template-master response shape. */
    private Map<String, Object> templateResponse(List<Object> rows) {
        return responseFor("NotificationTemplate", rows);
    }

    private Map<String, Object> responseFor(String master, List<Object> rows) {
        Map<String, Object> module = new LinkedHashMap<>();
        module.put(master, rows);
        Map<String, Object> mdmsRes = new LinkedHashMap<>();
        mdmsRes.put("RAINMAKER-PGR", module);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("MdmsRes", mdmsRes);
        return root;
    }

    /** A single routing row carrying an identifiable marker so callers can tell A from B. */
    private List<Object> rows(String marker) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("marker", marker);
        List<Object> list = new ArrayList<>();
        list.add(row);
        return list;
    }

    private static String marker(List<Object> result) {
        assertEquals(1, result.size());
        return (String) ((Map<?, ?>) result.get(0)).get("marker");
    }

    @Test
    void nonEmptyResult_isCached_withinTtl() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(rows("A")));

        assertEquals("A", marker(mdmsUtils.getNotificationRouting(TENANT)));
        assertEquals("A", marker(mdmsUtils.getNotificationRouting(TENANT)));

        // Second call served from the fresh cache — MDMS hit exactly once.
        verify(serviceRequestRepository, times(1)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void emptyResult_isNotCached_retriesNextCall() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(new ArrayList<>()));

        assertTrue(mdmsUtils.getNotificationRouting(TENANT).isEmpty());
        assertTrue(mdmsUtils.getNotificationRouting(TENANT).isEmpty());

        // Empty is never cached — every call re-hits MDMS (transient-miss retry).
        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void ttlExpiry_refetches_andServesNewRows() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(rows("A")))
                .thenReturn(response(rows("B")));

        assertEquals("A", marker(mdmsUtils.getNotificationRouting(TENANT)));
        Thread.sleep(80);
        // Past the TTL: the stale entry is not served fresh; MDMS is re-queried and B is returned.
        assertEquals("B", marker(mdmsUtils.getNotificationRouting(TENANT)));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void fetchFailureAfterTtl_servesStaleRows() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(rows("A")))
                .thenThrow(new RuntimeException("MDMS down"));

        assertEquals("A", marker(mdmsUtils.getNotificationRouting(TENANT)));
        Thread.sleep(80);
        // TTL expired and MDMS is failing: serve the last-known non-empty entry (stale), never throw.
        assertEquals("A", marker(mdmsUtils.getNotificationRouting(TENANT)));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    // ---- Same cache contract mirrored for the NotificationTemplate master (separate cache map) ----

    @Test
    void templates_nonEmptyResult_isCached_withinTtl() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(templateResponse(rows("A")));

        assertEquals("A", marker(mdmsUtils.getNotificationTemplates(TENANT)));
        assertEquals("A", marker(mdmsUtils.getNotificationTemplates(TENANT)));

        verify(serviceRequestRepository, times(1)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void templates_emptyResult_isNotCached_retriesNextCall() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(templateResponse(new ArrayList<>()));

        assertTrue(mdmsUtils.getNotificationTemplates(TENANT).isEmpty());
        assertTrue(mdmsUtils.getNotificationTemplates(TENANT).isEmpty());

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void templates_ttlExpiry_refetches_andServesNewRows() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(templateResponse(rows("A")))
                .thenReturn(templateResponse(rows("B")));

        assertEquals("A", marker(mdmsUtils.getNotificationTemplates(TENANT)));
        Thread.sleep(80);
        assertEquals("B", marker(mdmsUtils.getNotificationTemplates(TENANT)));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    @Test
    void templates_fetchFailureAfterTtl_servesStaleRows() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(templateResponse(rows("A")))
                .thenThrow(new RuntimeException("MDMS down"));

        assertEquals("A", marker(mdmsUtils.getNotificationTemplates(TENANT)));
        Thread.sleep(80);
        // TTL expired and MDMS is failing: serve the last-known non-empty entry (stale), never throw.
        assertEquals("A", marker(mdmsUtils.getNotificationTemplates(TENANT)));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }
}
