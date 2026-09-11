package org.egov.pgr.service;

import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * #29 timezone addendum: pins that the daily backlog snapshot resolves snapshot_date per
 * complaint's own tenant-local calendar day (via pgr_dashboard_tenant_timezone, falling back to
 * Africa/Nairobi) instead of a single server-wide CURRENT_DATE, and that the refresh ordering
 * (events -> facts -> snapshot -> legacy MVs) is unchanged.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class DashboardRefreshSchedulerTest {

    @Mock private JdbcTemplate jdbc;

    private PGRConfiguration config;
    private DashboardRefreshScheduler scheduler;

    @BeforeEach
    public void setUp() {
        config = new PGRConfiguration();
        config.setDashboardRefreshEnabled(true);
        scheduler = new DashboardRefreshScheduler(jdbc, config);
    }

    @Test
    public void disabledConfigSkipsEveryRefresh() {
        config.setDashboardRefreshEnabled(false);

        scheduler.refreshMaterializedViews();

        verifyNoInteractions(jdbc);
    }

    @Test
    public void dailySnapshotResolvesTenantLocalDateNotServerCurrentDate() {
        scheduler.refreshMaterializedViews();

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).update(sql.capture());
        String upsert = sql.getValue().replaceAll("\\s+", " ");

        assertFalse(upsert.contains("CURRENT_DATE"),
                "snapshot_date must not come from a single server-wide CURRENT_DATE");
        assertTrue(upsert.contains("CURRENT_TIMESTAMP AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')"),
                "snapshot_date must resolve per tenant via the shared timezone view, falling back to Africa/Nairobi");
        assertTrue(upsert.contains("LEFT JOIN LATERAL (SELECT candidate.resolved_zone "
                        + "FROM pgr_dashboard_tenant_timezone candidate"),
                "must join the same SQL timezone view the V2 grain MVs use");
        assertTrue(upsert.contains("cf.tenant_id = candidate.state_root_tenant_id OR "
                        + "left(cf.tenant_id, length(candidate.state_root_tenant_id) + 1) "
                        + "= candidate.state_root_tenant_id || '.'"),
                "must match exact or dot-boundary ancestor roots without assuming one segment");
        assertTrue(upsert.contains("ORDER BY array_length(string_to_array("
                        + "candidate.state_root_tenant_id, '.'), 1) DESC"),
                "the deepest configured root (for example ken.bomet over ken) must win");
        assertTrue(upsert.contains("FROM complaint_facts cf"));
        assertTrue(upsert.contains("WHERE cf.is_open"));
        assertTrue(upsert.contains("ON CONFLICT (snapshot_date, service_request_id) DO NOTHING"),
                "idempotent per (day, complaint) upsert must be preserved");
        assertTrue(upsert.contains("(snapshot_date, service_request_id, tenant_id, is_open, sla_breached, "
                        + "sla_status_bucket, aging_bucket, boundary_path, ward_code, zone_code, service_code, "
                        + "current_assignee_uuid, department_code, account_id)"),
                "insert column list must be unchanged");
    }

    @Test
    public void refreshesEventsThenFactsThenSnapshotThenLegacyMvs() {
        scheduler.refreshMaterializedViews();

        InOrder order = inOrder(jdbc);
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_events"));
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_facts"));
        order.verify(jdbc).update(anyString());
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_kpi"));
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly"));
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly_source"));
        order.verify(jdbc).execute(eq("REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_dimension"));
    }
}
