package org.egov.pgr.analytics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * #1110: pins /packs recordCount semantics — the tenant-CORPUS count on complaint_facts
 * with AnalyticsPlanner's tenant LIKE-prefix semantics (state level 'ke%' LIKE, city
 * exact), the 5-minute per-tenant cache (including expiry), and error -> null (never
 * cached, never thrown).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AnalyticsServiceRecordCountTest {

    private static final int STATE_LEN = 1;   // "ke" is state root; "ke.bomet" is a city

    @Mock private JdbcTemplate jdbc;

    private AnalyticsService service;
    private final AtomicLong clock = new AtomicLong(1_000_000L);

    @BeforeEach
    public void setUp() {
        // null config -> the shared DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS (5 minutes)
        service = new AnalyticsService(null, null, jdbc, null, null, null, new AnalyticsMetrics(), null);
        ReflectionTestUtils.setField(service, "recordCountClock", (LongSupplier) clock::get);
    }

    @Test
    public void stateLevelTenantUsesLikePrefix() {
        when(jdbc.queryForObject(contains("LIKE"), eq(Long.class), eq("ke%"))).thenReturn(1234L);

        assertEquals(1234L, service.recordCount("ke", STATE_LEN));

        verify(jdbc).queryForObject(
                eq("SELECT count(*) FROM complaint_facts WHERE tenant_id LIKE ?"),
                eq(Long.class), eq("ke%"));
        verify(jdbc, never()).queryForObject(contains("tenant_id = ?"), eq(Long.class), any());
    }

    @Test
    public void cityTenantUsesExactMatch() {
        when(jdbc.queryForObject(contains("tenant_id = ?"), eq(Long.class), eq("ke.bomet"))).thenReturn(55L);

        assertEquals(55L, service.recordCount("ke.bomet", STATE_LEN));

        verify(jdbc).queryForObject(
                eq("SELECT count(*) FROM complaint_facts WHERE tenant_id = ?"),
                eq(Long.class), eq("ke.bomet"));
        verify(jdbc, never()).queryForObject(contains("LIKE"), eq(Long.class), any());
    }

    @Test
    public void secondCallWithinTtlServesFromCache() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any())).thenReturn(10L);

        assertEquals(10L, service.recordCount("ke", STATE_LEN));
        clock.addAndGet(4 * 60_000L + 59_000L);   // 4m59s later — still inside the 5m TTL
        assertEquals(10L, service.recordCount("ke", STATE_LEN));

        verify(jdbc, times(1)).queryForObject(anyString(), eq(Long.class), any());
    }

    @Test
    public void cacheExpiresAfterFiveMinutes() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any())).thenReturn(10L, 20L);

        assertEquals(10L, service.recordCount("ke", STATE_LEN));
        clock.addAndGet(5 * 60_000L + 1L);        // past the TTL
        assertEquals(20L, service.recordCount("ke", STATE_LEN));

        verify(jdbc, times(2)).queryForObject(anyString(), eq(Long.class), any());
    }

    @Test
    public void ttlIsConfigurableViaTheSharedAnalyticsCacheConfig() {
        // pgr.analytics.config-cache-ttl-ms — ONE property drives every analytics
        // config cache; here a 1s TTL instead of the 5m default.
        org.egov.pgr.config.PGRConfiguration cfg = mock(org.egov.pgr.config.PGRConfiguration.class);
        when(cfg.getAnalyticsConfigCacheTtlMs()).thenReturn(1_000L);
        service = new AnalyticsService(null, null, jdbc, null, null, null, new AnalyticsMetrics(), cfg);
        ReflectionTestUtils.setField(service, "recordCountClock", (LongSupplier) clock::get);
        when(jdbc.queryForObject(anyString(), eq(Long.class), any())).thenReturn(10L, 20L);

        assertEquals(10L, service.recordCount("ke", STATE_LEN));
        clock.addAndGet(999L);                     // inside the configured 1s TTL
        assertEquals(10L, service.recordCount("ke", STATE_LEN));
        clock.addAndGet(2L);                       // past it
        assertEquals(20L, service.recordCount("ke", STATE_LEN));

        verify(jdbc, times(2)).queryForObject(anyString(), eq(Long.class), any());
    }

    @Test
    public void cacheIsKeyedByTenant() {
        when(jdbc.queryForObject(contains("LIKE"), eq(Long.class), eq("ke%"))).thenReturn(100L);
        when(jdbc.queryForObject(contains("tenant_id = ?"), eq(Long.class), eq("ke.bomet"))).thenReturn(7L);

        assertEquals(100L, service.recordCount("ke", STATE_LEN));
        assertEquals(7L, service.recordCount("ke.bomet", STATE_LEN));
        assertEquals(100L, service.recordCount("ke", STATE_LEN));   // still cached

        verify(jdbc, times(2)).queryForObject(anyString(), eq(Long.class), any());
    }

    @Test
    public void errorReturnsNullAndIsNotCached() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any()))
                .thenThrow(new DataAccessResourceFailureException("db down"))
                .thenReturn(33L);

        assertNull(service.recordCount("ke", STATE_LEN));           // failure -> null, no throw
        assertEquals(33L, service.recordCount("ke", STATE_LEN));    // retried, not a cached null

        verify(jdbc, times(2)).queryForObject(anyString(), eq(Long.class), any());
    }

    @Test
    public void nullOrEmptyTenantReturnsNullWithoutQuerying() {
        assertNull(service.recordCount(null, STATE_LEN));
        assertNull(service.recordCount("", STATE_LEN));
        verifyNoInteractions(jdbc);
    }
}
