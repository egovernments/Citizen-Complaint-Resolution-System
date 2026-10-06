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
 * Pins the serviceCode->SLA cache semantics behind the inbox's SLA ordering (issue #1238).
 *
 * <p>This map feeds {@code PGRQueryBuilder.addOrderByClause}'s
 * {@code CASE ser.servicecode WHEN ... ELSE businessLevelSla END} expression. When it is empty
 * EVERY complaint type collapses to the uniform business-level SLA, which reduces
 * {@code sla - (now - createdtime)} to a constant minus elapsed — i.e. plain creation order —
 * while the UI keeps displaying the real per-type budget. That is what made the employee inbox's
 * SLA column look correctly ordered WITHIN a complaint type but not across types.
 *
 * <p>The cache previously used a bare {@code computeIfAbsent} with no TTL, so a single transient
 * MDMS miss pinned an empty map for the whole process lifetime, and a configurator slaHours edit
 * never reached the ORDER BY without a pgr-services restart.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class MDMSUtilsSlaCacheTest {

    private static final String TENANT = "ke.bomet";
    private static final long HOUR_MS = 3600_000L;

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private ObjectMapper objectMapper;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private MDMSUtils mdmsUtils;

    @BeforeEach
    void setUp() {
        mdmsUtils = new MDMSUtils(config, serviceRequestRepository, objectMapper);
        ReflectionTestUtils.setField(mdmsUtils, "multiStateInstanceUtil", multiStateInstanceUtil);
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenAnswer(inv -> inv.getArgument(0));
        when(config.getMdmsHost()).thenReturn("http://mdms/");
        when(config.getMdmsEndPoint()).thenReturn("mdms/v1/_search");
    }

    /** {"MdmsRes":{"RAINMAKER-PGR":{"ComplaintHierarchy":[rows]}}} — the shape fetchResult returns. */
    private Map<String, Object> response(List<Object> rows) {
        Map<String, Object> module = new LinkedHashMap<>();
        module.put("ComplaintHierarchy", rows);
        Map<String, Object> mdmsRes = new LinkedHashMap<>();
        mdmsRes.put("RAINMAKER-PGR", module);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("MdmsRes", mdmsRes);
        return root;
    }

    /** One LEAF hierarchy row: a code plus its slaHours budget. */
    private List<Object> leaf(String code, Number slaHours) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("code", code);
        row.put("slaHours", slaHours);
        List<Object> list = new ArrayList<>();
        list.add(row);
        return list;
    }

    @Test
    void slaHours_areConvertedToMillis() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(leaf("NoStreetlight", 24)));

        Map<String, Long> map = mdmsUtils.getServiceCodeToSlaMillis(TENANT);

        // The ORDER BY subtracts this from a millisecond expression, so hours MUST be converted.
        assertEquals(24 * HOUR_MS, map.get("NoStreetlight"));
    }

    @Test
    void nonEmptyResult_isCached_withinTtl() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(leaf("NoStreetlight", 24)));

        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));
        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));

        verify(serviceRequestRepository, times(1)).fetchResult(any(StringBuilder.class), any());
    }

    /**
     * Regression for #1238: an MDMS miss on the FIRST SLA-sorted search must not pin an empty map.
     * Under the old computeIfAbsent the second call was served the cached empty map and the inbox
     * ordering stayed degraded until pgr-services was restarted.
     */
    @Test
    void emptyResult_isNotCached_retriesNextCall() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(new ArrayList<>()));

        assertTrue(mdmsUtils.getServiceCodeToSlaMillis(TENANT).isEmpty());
        assertTrue(mdmsUtils.getServiceCodeToSlaMillis(TENANT).isEmpty());

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    /** An MDMS failure is swallowed into an empty map, which likewise must never be cached. */
    @Test
    void fetchFailure_isNotCached_recoversOnNextCall() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60000L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenThrow(new RuntimeException("MDMS down"))
                .thenReturn(response(leaf("NoStreetlight", 24)));

        assertTrue(mdmsUtils.getServiceCodeToSlaMillis(TENANT).isEmpty());
        // Recovers as soon as MDMS is back, instead of staying empty for the process lifetime.
        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    /** A configurator slaHours edit must reach the ORDER BY without a pgr-services restart. */
    @Test
    void ttlExpiry_refetches_andServesEditedSlaHours() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(leaf("NoStreetlight", 24)))
                .thenReturn(response(leaf("NoStreetlight", 72)));

        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));
        Thread.sleep(80);
        assertEquals(72 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }

    /** During an MDMS outage, keep ordering by the last-known budgets rather than by creation order. */
    @Test
    void fetchFailureAfterTtl_servesStaleSla() throws InterruptedException {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(50L);
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response(leaf("NoStreetlight", 24)))
                .thenThrow(new RuntimeException("MDMS down"));

        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));
        Thread.sleep(80);
        assertEquals(24 * HOUR_MS, mdmsUtils.getServiceCodeToSlaMillis(TENANT).get("NoStreetlight"));

        verify(serviceRequestRepository, times(2)).fetchResult(any(StringBuilder.class), any());
    }
}
