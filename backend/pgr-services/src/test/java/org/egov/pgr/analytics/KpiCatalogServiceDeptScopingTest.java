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
 * #1280: pins {@code dss.DashboardConfig.departmentScoping} semantics as read by
 * {@link KpiCatalogService#isDepartmentScopingDisabled}:
 * only an explicit "disabled" (case-insensitive, trimmed) disables department scoping;
 * missing module/record/field, malformed values, and MDMS errors ALL resolve to enforced
 * (fail-safe = today's behavior); resolved at the tenant's state root; cached in-memory
 * for 5 minutes per state root (including expiry — a config flip applies within 5 minutes).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class KpiCatalogServiceDeptScopingTest {

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repo;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private KpiCatalogService service;
    private final AtomicLong clock = new AtomicLong(1_000_000L);

    @BeforeEach
    public void setUp() {
        when(config.getMdmsHost()).thenReturn("http://mdms-v2:8080");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v1/_search");
        // "ke" and "ke.bomet" both resolve to state root "ke"
        when(multiStateInstanceUtil.getStateLevelTenant(anyString()))
                .thenAnswer(inv -> inv.getArgument(0, String.class).split("\\.")[0]);
        service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
        ReflectionTestUtils.setField(service, "configClock", (LongSupplier) clock::get);
    }

    /** MdmsRes.dss.DashboardConfig = [record] — the shape ServiceRequestRepository returns. */
    private static Map<String, Object> mdmsResult(Map<String, Object>... records) {
        Map<String, Object> res = new HashMap<>();
        res.put("MdmsRes", Map.of("dss", Map.of("DashboardConfig", List.of(records))));
        return res;
    }

    private static Map<String, Object> record(Object departmentScoping) {
        Map<String, Object> r = new HashMap<>();
        r.put("departmentScoping", departmentScoping);
        return r;
    }

    // ---- fail-safe default: everything that is not an explicit "disabled" means enforced ----

    @Test
    public void noDssModuleMeansEnforced() {
        // MdmsRes without the dss module at all -> JsonPath miss -> enforced
        when(repo.fetchResult(any(), any())).thenReturn(Map.of("MdmsRes", Map.of()));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void noRecordMeansEnforced() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult());
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void missingFieldMeansEnforced() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(new HashMap<>()));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void malformedValuesMeanEnforced() {
        for (Object malformed : new Object[]{"off", "none", "true", 42, Boolean.TRUE, null, ""}) {
            service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
            ReflectionTestUtils.setField(service, "configClock", (LongSupplier) clock::get);
            when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record(malformed)));
            assertFalse(service.isDepartmentScopingDisabled("ke.bomet"),
                    "value '" + malformed + "' must fail-safe to enforced");
        }
    }

    @Test
    public void explicitEnforcedMeansEnforced() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("enforced")));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void mdmsErrorMeansEnforcedAndNeverThrows() {
        when(repo.fetchResult(any(), any())).thenThrow(new RuntimeException("mdms down"));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void nullOrEmptyTenantMeansEnforcedWithoutFetching() {
        assertFalse(service.isDepartmentScopingDisabled(null));
        assertFalse(service.isDepartmentScopingDisabled(""));
        verifyNoInteractions(repo);
    }

    // ---- the one shape that disables ----

    @Test
    public void explicitDisabledDisables() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("disabled")));
        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    @Test
    public void disabledIsCaseInsensitiveAndTrimmed() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("  DISABLED ")));
        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
    }

    // ---- 5-minute per-state-root cache, mirroring the recordCount idiom ----

    @Test
    public void secondCallWithinTtlServesFromCache() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("disabled")));

        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
        clock.addAndGet(4 * 60_000L + 59_000L);   // 4m59s later — still inside the 5m TTL
        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void cacheExpiresAfterFiveMinutesAndPicksUpFlip() {
        when(repo.fetchResult(any(), any()))
                .thenReturn(mdmsResult(record("disabled")))
                .thenReturn(mdmsResult(record("enforced")));

        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));
        clock.addAndGet(5 * 60_000L + 1L);        // past the TTL
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));   // flip applied

        verify(repo, times(2)).fetchResult(any(), any());
    }

    @Test
    public void cacheIsSharedAcrossTenantsOfOneStateRoot() {
        // resolved (and fetched) at the state root, so "ke" and "ke.bomet" share one entry
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("disabled")));

        assertTrue(service.isDepartmentScopingDisabled("ke"));
        assertTrue(service.isDepartmentScopingDisabled("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void enforcedOutcomeIsCachedToo() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record("enforced")));

        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));
        assertFalse(service.isDepartmentScopingDisabled("ke.bomet"));

        verify(repo, times(1)).fetchResult(any(), any());
    }
}
