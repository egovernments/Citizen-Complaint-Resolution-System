package org.egov.pgr.analytics;

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

import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * #29: pins {@code dss.DashboardConfig.timeZone} resolution as read by
 * {@link KpiCatalogService#resolveTimeZone} — a configured valid IANA zone wins; missing
 * module/record/field, a malformed value, and an MDMS error ALL fall back to
 * {@link KpiCatalogService#DEFAULT_TIME_ZONE} (Africa/Nairobi, migration-compatibility default,
 * never thrown). Also pins the ONE shared {@code dashboardConfig} cache/fetch
 * {@link KpiCatalogService#isDepartmentScopingDisabled} and {@link KpiCatalogService#resolveTimeZone}
 * both read — a request touching both axes issues exactly one MDMS call, and a config flip on
 * either field takes effect together within one TTL window (mirrors
 * {@link KpiCatalogServiceDeptScopingTest}'s cache coverage for the sibling axis).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class KpiCatalogServiceTimeZoneTest {

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repo;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private KpiCatalogService service;
    private final AtomicLong clock = new AtomicLong(1_000_000L);

    @BeforeEach
    public void setUp() {
        when(config.getMdmsHost()).thenReturn("http://mdms-v2:8080");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v1/_search");
        when(config.getAnalyticsConfigCacheTtlMs())
                .thenReturn(PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS);
        when(multiStateInstanceUtil.getStateLevelTenant(anyString()))
                .thenAnswer(inv -> inv.getArgument(0, String.class).split("\\.")[0]);
        service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
        ReflectionTestUtils.setField(service, "configClock", (LongSupplier) clock::get);
    }

    private static Map<String, Object> mdmsResult(Map<String, Object>... records) {
        Map<String, Object> res = new HashMap<>();
        res.put("MdmsRes", Map.of("dss", Map.of("DashboardConfig", List.of(records))));
        return res;
    }

    private static Map<String, Object> record(Object timeZone) {
        Map<String, Object> r = new HashMap<>();
        r.put("timeZone", timeZone);
        return r;
    }

    // ---- happy path ----

    @Test
    public void configuredValidZoneWins() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("Asia/Kolkata")));
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));
    }

    @Test
    public void leadingTrailingWhitespaceIsTrimmed() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("  Africa/Maputo  ")));
        assertEquals(ZoneId.of("Africa/Maputo"), service.resolveTimeZone("ke.bomet"));
    }

    // ---- fail-safe fallback: everything else -> DEFAULT_TIME_ZONE, never throws ----

    @Test
    public void noDssModuleFallsBackToDefault() {
        when(repo.fetchResult(any(), any())).thenReturn(Map.of("MdmsRes", Map.of()));
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));
    }

    @Test
    public void noRecordFallsBackToDefault() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult());
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));
    }

    @Test
    public void missingFieldFallsBackToDefault() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(new HashMap<>()));
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));
    }

    @Test
    public void malformedValuesFallBackToDefault() {
        for (Object malformed : new Object[]{"Not/AZone", "EAT", "", "   ", 42, Boolean.TRUE, null}) {
            service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
            ReflectionTestUtils.setField(service, "configClock", (LongSupplier) clock::get);
            when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record(malformed)));
            assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"),
                    "value '" + malformed + "' must fall back to the default zone");
        }
    }

    @Test
    public void mdmsErrorFallsBackToDefaultAndNeverThrows() {
        when(repo.fetchResult(any(), any())).thenThrow(new RuntimeException("mdms down"));
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));
    }

    @Test
    public void nullOrEmptyTenantFallsBackWithoutFetching() {
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone(null));
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone(""));
        verifyNoInteractions(repo);
    }

    // ---- the shared cache: ONE fetch serves both departmentScoping and timeZone ----

    @Test
    public void oneFetchServesBothConfigAxes() {
        Map<String, Object> combined = new HashMap<>();
        combined.put("departmentScoping", "disabled");
        combined.put("timeZone", "Asia/Kolkata");
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(combined));

        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void oneFetchServesBothConfigAxesRegardlessOfCallOrder() {
        Map<String, Object> combined = new HashMap<>();
        combined.put("departmentScoping", "enforced");
        combined.put("timeZone", "Africa/Maputo");
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(combined));

        assertEquals(ZoneId.of("Africa/Maputo"), service.resolveTimeZone("ke.bomet"));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void secondCallWithinTtlServesFromCache() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("Asia/Kolkata")));

        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));
        clock.addAndGet(4 * 60_000L + 59_000L);   // 4m59s later — still inside the 5m TTL
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void cacheExpiresAfterFiveMinutesAndPicksUpFlip() {
        when(repo.fetchResult(any(), any()))
                .thenReturn(mdmsResult(record("Asia/Kolkata")))
                .thenReturn(mdmsResult(record("Africa/Maputo")));

        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));
        clock.addAndGet(5 * 60_000L + 1L);        // past the TTL
        assertEquals(ZoneId.of("Africa/Maputo"), service.resolveTimeZone("ke.bomet"));   // flip applied

        verify(repo, times(2)).fetchResult(any(), any());
    }

    @Test
    public void cacheIsSharedAcrossTenantsOfOneStateRoot() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("Asia/Kolkata")));

        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke"));
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void noRecordOutcomeIsCachedToo() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult());

        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));
        assertEquals(KpiCatalogService.DEFAULT_TIME_ZONE, service.resolveTimeZone("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    // ---- deterministic multi-record selection (selectDashboardConfigRecord) ----
    // Same rule as the pgr_dashboard_tenant_timezone SQL view and useDashboardConfig.js:
    // id=="default" wins; otherwise preserve the historical first API record.

    private static Map<String, Object> recordWithId(Object id, String timeZone) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", id);
        r.put("timeZone", timeZone);
        return r;
    }

    @Test
    public void selectDashboardConfigRecordReturnsNullForEmptyList() {
        assertNull(KpiCatalogService.selectDashboardConfigRecord(List.of()));
    }

    @Test
    public void selectDashboardConfigRecordPreservesSingleRecordBehavior() {
        Map<String, Object> only = recordWithId("zz", "Asia/Kolkata");
        assertSame(only, KpiCatalogService.selectDashboardConfigRecord(List.of(only)));
    }

    @Test
    public void selectDashboardConfigRecordPrefersDefaultIdRegardlessOfPosition() {
        Map<String, Object> aaa = recordWithId("aaa", "Africa/Maputo");
        Map<String, Object> def = recordWithId("default", "Asia/Kolkata");
        Map<String, Object> zzz = recordWithId("zzz", "UTC");
        assertSame(def, KpiCatalogService.selectDashboardConfigRecord(List.of(aaa, def, zzz)));
        assertSame(def, KpiCatalogService.selectDashboardConfigRecord(List.of(def, aaa, zzz)));
    }

    @Test
    public void selectDashboardConfigRecordPreservesFirstApiRecordWhenNoDefaultExists() {
        Map<String, Object> zzz = recordWithId("zzz", "UTC");
        Map<String, Object> aaa = recordWithId("aaa", "Africa/Maputo");
        Map<String, Object> bbb = recordWithId("bbb", "Asia/Kolkata");
        assertSame(zzz, KpiCatalogService.selectDashboardConfigRecord(List.of(zzz, aaa, bbb)));
    }

    @Test
    public void selectDashboardConfigRecordPreservesFirstRecordEvenWhenItsIdIsBlank() {
        Map<String, Object> blank = recordWithId("   ", "Africa/Maputo");
        Map<String, Object> missing = new HashMap<>();
        missing.put("timeZone", "UTC");
        Map<String, Object> real = recordWithId("abc", "Asia/Kolkata");
        assertSame(blank, KpiCatalogService.selectDashboardConfigRecord(List.of(blank, missing, real)));
    }

    @Test
    public void selectDashboardConfigRecordFallsBackToFirstOccurrenceWhenNoUsableId() {
        Map<String, Object> first = recordWithId(null, "Africa/Maputo");
        Map<String, Object> second = recordWithId("   ", "UTC");
        assertSame(first, KpiCatalogService.selectDashboardConfigRecord(List.of(first, second)));
    }

    @Test
    public void resolveTimeZonePreservesFirstApiRecordWhenNoDefaultAmongDuplicates() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(
                recordWithId("zzz", "UTC"),
                recordWithId("aaa", "Africa/Maputo")));

        assertEquals(ZoneId.of("UTC"), service.resolveTimeZone("ke.bomet"));
    }

    // ---- TTL-bounded fallback warning gate (#29 review fix) ----
    // No established log-capture test pattern in this module (grep found none) — verified via
    // the gate's own return value / cached state (ReflectionTestUtils) instead of brittle log
    // assertions, per the reviewer's instruction.

    @SuppressWarnings("unchecked")
    private Map<String, Long> warnedGenerations() {
        return (Map<String, Long>) ReflectionTestUtils.getField(service, "timeZoneFallbackWarnedGeneration");
    }

    @Test
    public void shouldWarnTimeZoneFallbackGateFiresOnceThenAgainOnlyForANewGeneration() {
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 1000L));
        assertFalse((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 1000L));
        assertFalse((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 1000L));
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 2000L));
        assertFalse((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 2000L));
    }

    @Test
    public void shouldWarnTimeZoneFallbackGateIsPerStateRoot() {
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "ke", 1000L));
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(service, "shouldWarnTimeZoneFallback", "mz", 1000L));
    }

    @Test
    public void resolveTimeZoneMissingConfigWarnsOnceWithinOneTtlWindowThenAgainAfterRefresh() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult());   // no record -> "not found" fallback

        service.resolveTimeZone("ke.bomet");
        service.resolveTimeZone("ke.bomet");
        service.resolveTimeZone("ke.bomet");
        assertEquals(1, warnedGenerations().size(), "only one generation should be recorded as warned so far");
        Long firstWarnedGeneration = warnedGenerations().get("ke");
        assertNotNull(firstWarnedGeneration);

        clock.addAndGet(5 * 60_000L + 1L);   // past the TTL -> next call re-fetches (new generation)
        service.resolveTimeZone("ke.bomet");

        Long secondWarnedGeneration = warnedGenerations().get("ke");
        assertNotEquals(firstWarnedGeneration, secondWarnedGeneration,
                "a config refresh must grant one more warning opportunity (new generation)");

        service.resolveTimeZone("ke.bomet");
        assertEquals(secondWarnedGeneration, warnedGenerations().get("ke"),
                "still within the new TTL window -> no further generation bump");
        verify(repo, times(2)).fetchResult(any(), any());
    }

    @Test
    public void resolveTimeZoneWarningGateDoesNotAffectDepartmentScopingCaching() {
        // Regression guard: the shared dashboardConfig fetch/cache (and isDepartmentScopingDisabled's
        // use of it) must be byte-for-byte unaffected by the resolveTimeZone-only warning gate.
        Map<String, Object> combined = new HashMap<>();
        combined.put("departmentScoping", "disabled");
        combined.put("timeZone", "Asia/Kolkata");
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(combined));

        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));
        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
        assertEquals(ZoneId.of("Asia/Kolkata"), service.resolveTimeZone("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
        assertTrue(warnedGenerations().isEmpty(), "a valid, configured record must never enter the warning gate");
    }
}
