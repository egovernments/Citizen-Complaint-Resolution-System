package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.pgr.policy.PgrSearchScope;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * #29: pins the one-calendar-per-request contract in {@link AnalyticsService#doQuery} — a batch of
 * N queries resolves the tenant zone and captures request time EXACTLY ONCE and threads that same
 * {@link BusinessCalendar} into every entry's {@link AnalyticsPlanner#plan}, and the response's
 * top-level {@code asOf} reports fact freshness independently of the request-time calendar —
 * never a per-entry re-resolution that could straddle two clock readings. Also pins the
 * {@code composeKpi.js}-mirroring elapsed-time math {@link AnalyticsService#computeCompose} uses.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AnalyticsServiceCalendarTest {

    private final ObjectMapper om = new ObjectMapper();

    @Mock private AnalyticsPlanner planner;
    @Mock private JdbcTemplate jdbc;
    @Mock private KpiCatalogService kpiCatalogService;
    @Mock private AnalyticsRowScopeResolver scopeResolver;

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private RequestInfo requestInfoWithRole(String role) {
        User u = User.builder().uuid("u1").roles(List.of(Role.builder().code(role).build())).build();
        return RequestInfo.builder().userInfo(u).build();
    }

    // ---- batch: one resolved zone + one request clock reading, shared by every entry ----

    @Test
    public void batchEntriesShareExactlyOneCalendarAndOneAsOfResolution() {
        AnalyticsService service = new AnalyticsService(planner, null, jdbc, kpiCatalogService,
                scopeResolver, null, new AnalyticsMetrics(), null);

        long fixedAsOf = 1_700_000_000_000L;   // deliberately stale fact refresh timestamp
        long fixedNow = 1_718_442_000_000L;    // request wall clock
        ReflectionTestUtils.setField(service, "requestClock", (LongSupplier) () -> fixedNow);
        when(jdbc.queryForObject(eq("SELECT max(facts_built_at) FROM complaint_facts"), eq(Long.class)))
                .thenReturn(fixedAsOf);
        when(kpiCatalogService.resolveTimeZone("ke")).thenReturn(ZoneId.of("Asia/Kolkata"));
        when(scopeResolver.resolve(any(), eq("ke"), anyInt()))
                .thenReturn(new PgrSearchScope("ke", true, null, null, null));
        when(planner.plan(any(), any(), any()))
                .thenReturn(new AnalyticsPlanner.Planned("SELECT 1", List.of(), List.of("total"), "facts"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        JsonNode body = json("{\"queries\":{"
                + "\"a\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]},"
                + "\"b\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]},"
                + "\"c\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}"
                + "}}");

        Map<String, Object> out = service.query(body, null, AnalyticsCapabilityFixtures.full(), "ke", 1);

        // resolveTimeZone and the asOf query each fire exactly once per request, not once per entry.
        verify(kpiCatalogService, times(1)).resolveTimeZone("ke");
        verify(jdbc, times(1)).queryForObject(eq("SELECT max(facts_built_at) FROM complaint_facts"), eq(Long.class));

        ArgumentCaptor<BusinessCalendar> cal = ArgumentCaptor.forClass(BusinessCalendar.class);
        verify(planner, times(3)).plan(any(), any(), cal.capture());
        List<BusinessCalendar> seen = cal.getAllValues();
        assertSame(seen.get(0), seen.get(1), "every batch entry must plan against the SAME calendar instance");
        assertSame(seen.get(1), seen.get(2), "every batch entry must plan against the SAME calendar instance");
        assertEquals(fixedNow, seen.get(0).nowMs);
        assertEquals(ZoneId.of("Asia/Kolkata"), seen.get(0).zoneId);

        // asOf remains fact freshness; calendar/businessDate comes from current request time.
        assertEquals(fixedAsOf, out.get("asOf"));
        @SuppressWarnings("unchecked")
        Map<String, Object> calendarInfo = (Map<String, Object>) out.get("calendar");
        assertEquals("Asia/Kolkata", calendarInfo.get("timeZone"));
        assertEquals(Instant.ofEpochMilli(fixedNow).atZone(ZoneId.of("Asia/Kolkata")).toLocalDate().toString(),
                calendarInfo.get("businessDate"));

        @SuppressWarnings("unchecked")
        Map<String, Object> results = (Map<String, Object>) out.get("results");
        assertEquals(3, results.size());
        assertFalse((Boolean) out.get("partial"));
    }

    @Test
    public void emptyFactsKeepNullableAsOfWithoutBreakingRequestCalendar() {
        AnalyticsService service = new AnalyticsService(planner, null, jdbc, kpiCatalogService,
                scopeResolver, null, new AnalyticsMetrics(), null);
        long fixedNow = 1_718_442_000_000L;
        ReflectionTestUtils.setField(service, "requestClock", (LongSupplier) () -> fixedNow);

        when(jdbc.queryForObject(eq("SELECT max(facts_built_at) FROM complaint_facts"), eq(Long.class)))
                .thenReturn((Long) null);
        when(kpiCatalogService.resolveTimeZone("ke")).thenReturn(ZoneId.of("Asia/Kolkata"));
        when(scopeResolver.resolve(any(), eq("ke"), anyInt()))
                .thenReturn(new PgrSearchScope("ke", true, null, null, null));
        when(planner.plan(any(), any(), any()))
                .thenReturn(new AnalyticsPlanner.Planned("SELECT 1", List.of(), List.of("total"), "facts"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        JsonNode body = json("{\"query\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}}");
        Map<String, Object> out = service.query(body, null, AnalyticsCapabilityFixtures.full(), "ke", 1);

        assertTrue(out.containsKey("asOf"));
        assertNull(out.get("asOf"));
        ArgumentCaptor<BusinessCalendar> calendar = ArgumentCaptor.forClass(BusinessCalendar.class);
        verify(planner).plan(any(), any(), calendar.capture());
        assertEquals(fixedNow, calendar.getValue().nowMs);
    }

    @Test
    public void singleQueryArmAlsoResolvesTheCalendarExactlyOnce() {
        AnalyticsService service = new AnalyticsService(planner, null, jdbc, kpiCatalogService,
                scopeResolver, null, new AnalyticsMetrics(), null);

        when(jdbc.queryForObject(eq("SELECT max(facts_built_at) FROM complaint_facts"), eq(Long.class)))
                .thenReturn(1_700_000_000_000L);
        when(kpiCatalogService.resolveTimeZone("ke")).thenReturn(ZoneId.of("Africa/Nairobi"));
        when(scopeResolver.resolve(any(), eq("ke"), anyInt()))
                .thenReturn(new PgrSearchScope("ke", true, null, null, null));
        when(planner.plan(any(), any(), any()))
                .thenReturn(new AnalyticsPlanner.Planned("SELECT 1", List.of(), List.of("total"), "facts"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        JsonNode body = json("{\"query\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}}");
        service.query(body, null, AnalyticsCapabilityFixtures.full(), "ke", 1);

        verify(kpiCatalogService, times(1)).resolveTimeZone("ke");
        verify(jdbc, times(1)).queryForObject(eq("SELECT max(facts_built_at) FROM complaint_facts"), eq(Long.class));
    }

    // ---- compose elapsed math (composeKpi.js parity) ----

    private BusinessCalendar calAt(ZoneId zone, int y, int mo, int d, int h) {
        return BusinessCalendar.of(zone, ZonedDateTime.of(y, mo, d, h, 0, 0, 0, zone).toInstant().toEpochMilli());
    }

    @Test
    public void dailyAvgFromWeeklyDividesByElapsedDaysSinceSundayWeekStart() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        // 2024-06-19 is a Wednesday; the FE-semantic Sunday week start is 2024-06-16.
        // elapsed = floor((Wed 15:00 - Sun 00:00) / 1 day) = 3 (Sun->Mon->Tue->Wed is 3 full days, + 15h).
        BusinessCalendar cal = calAt(ZoneId.of("Africa/Nairobi"), 2024, 6, 19, 15);
        assertEquals(3L, service.elapsedDaysSinceStartOfWeek(cal));

        JsonNode compose = json("{\"type\":\"dailyAvgFromWeekly\",\"elapsedFromAsOf\":true}");
        Double v = service.computeCompose("dailyAvgFromWeekly", compose,
                List.of(Map.of("total", 90.0)), cal);
        assertEquals(30.0, v, 1e-9);
    }

    @Test
    public void dailyAvgFromWeeklyWithoutElapsedFlagIsNull() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        BusinessCalendar cal = calAt(ZoneId.of("Africa/Nairobi"), 2024, 6, 19, 15);
        JsonNode compose = json("{\"type\":\"dailyAvgFromWeekly\"}");
        assertNull(service.computeCompose("dailyAvgFromWeekly", compose, List.of(Map.of("total", 70.0)), cal));
    }

    @Test
    public void hourlyAvgFromDailyDividesByElapsedHoursSinceMidnight() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        BusinessCalendar cal = calAt(ZoneId.of("Asia/Kolkata"), 2024, 6, 15, 15);   // 15:00 local
        assertEquals(15L, service.elapsedHoursSinceStartOfDay(cal));

        JsonNode compose = json("{\"type\":\"hourlyAvgFromDaily\",\"elapsedFromAsOf\":true}");
        Double v = service.computeCompose("hourlyAvgFromDaily", compose, List.of(Map.of("total", 30.0)), cal);
        assertEquals(2.0, v, 1e-9);
    }

    @Test
    public void elapsedTimesAreClampedToAtLeastOne() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        // Just after midnight: both elapsed-day and elapsed-hour must floor to >= 1, never 0
        // (a 0 divisor would blow up the *_Avg ratio).
        BusinessCalendar justAfterMidnight = BusinessCalendar.of(ZoneId.of("Africa/Nairobi"),
                ZonedDateTime.of(2024, 6, 16, 0, 0, 1, 0, ZoneId.of("Africa/Nairobi")).toInstant().toEpochMilli());
        assertEquals(1L, service.elapsedDaysSinceStartOfWeek(justAfterMidnight));
        assertEquals(1L, service.elapsedHoursSinceStartOfDay(justAfterMidnight));
    }

    @Test
    public void openRateComplementUsesPctThenFallsBackToTotal() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        BusinessCalendar cal = calAt(ZoneId.of("Africa/Nairobi"), 2024, 6, 15, 12);
        JsonNode compose = json("{\"type\":\"openRateComplement\"}");
        assertEquals(75.0, service.computeCompose("openRateComplement", compose, List.of(Map.of("pct", 0.25)), cal), 1e-9);
        assertEquals(60.0, service.computeCompose("openRateComplement", compose, List.of(Map.of("total", 0.4)), cal), 1e-9);
    }

    @Test
    public void netBacklogDailyIsInflowMinusOutflow() {
        AnalyticsService service = new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics(), null);
        BusinessCalendar cal = calAt(ZoneId.of("Africa/Nairobi"), 2024, 6, 15, 12);
        JsonNode compose = json("{\"type\":\"netBacklogDaily\"}");
        Double v = service.computeCompose("netBacklogDaily", compose,
                List.of(Map.of("total", 100.0), Map.of("total", 40.0)), cal);
        assertEquals(60.0, v, 1e-9);
    }
}
