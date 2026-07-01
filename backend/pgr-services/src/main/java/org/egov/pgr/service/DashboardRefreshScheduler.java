package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps the analytics grains that back the CCRS dashboard fresh.
 *
 * <p>The catalog-driven dashboard reads three V2 grains:
 * <ul>
 *   <li>{@code complaint_events} — one row per workflow transition (materialized view)</li>
 *   <li>{@code complaint_facts}  — one row per complaint, current state (materialized view,
 *       built FROM complaint_events)</li>
 *   <li>{@code complaint_open_state_daily} — append-only daily backlog snapshot (a table, one row
 *       per still-open complaint per day)</li>
 * </ul>
 *
 * <p>Materialized views are refreshed in dependency order (events before facts) with
 * {@code CONCURRENTLY} so dashboard reads are never blocked (both grains carry the unique index
 * that CONCURRENTLY requires). After facts is fresh, today's open backlog is captured into
 * {@code complaint_open_state_daily} with an idempotent upsert, so the trend/time-series KPIs
 * accumulate one point per day.
 *
 * <p>The legacy {@code pgr_mv_*} KPI views are still refreshed for back-compat.
 */
@Component
@Slf4j
public class DashboardRefreshScheduler {

    private final JdbcTemplate jdbcTemplate;
    private final PGRConfiguration config;

    // V2 grains the dashboard actually queries. Order matters: complaint_facts is built FROM
    // complaint_events, so events must be refreshed first for facts to see the latest transitions.
    private static final String[] V2_GRAIN_MVS = {
        "complaint_events", "complaint_facts"
    };

    // Legacy KPI materialized views (superseded by the V2 grains; kept refreshed for back-compat).
    private static final String[] LEGACY_MV_NAMES = {
        "pgr_mv_kpi", "pgr_mv_monthly", "pgr_mv_monthly_source", "pgr_mv_dimension"
    };

    // Daily backlog snapshot: one row per still-open complaint per day. Runs AFTER complaint_facts
    // is refreshed. ON CONFLICT keeps the first snapshot captured for each (day, complaint), so
    // re-running within the same day is a no-op — the day's backlog is fixed at its first capture.
    private static final String DAILY_SNAPSHOT_UPSERT =
            "INSERT INTO complaint_open_state_daily "
          + "(snapshot_date, service_request_id, tenant_id, is_open, sla_breached, sla_status_bucket, "
          + " aging_bucket, boundary_path, ward_code, zone_code, service_code, current_assignee_uuid, "
          + " department_code, account_id, created_at, open_age_ms, application_status, source, "
          + " service_group, sla_target_ms) "
          + "SELECT CURRENT_DATE, service_request_id, tenant_id, is_open, sla_breached, sla_status_bucket, "
          + "       aging_bucket, boundary_path, ward_code, zone_code, service_code, current_assignee_uuid, "
          + "       department_code, account_id, created_at, "
          + "       (EXTRACT(EPOCH FROM ((CURRENT_DATE + INTERVAL '1 day')::timestamp "
          + "        AT TIME ZONE 'Africa/Nairobi')) * 1000)::bigint - created_at, "
          + "       application_status, source, service_group, sla_target_ms "
          + "FROM complaint_facts WHERE is_open "
          + "ON CONFLICT (snapshot_date, service_request_id) DO NOTHING";

    @Autowired
    public DashboardRefreshScheduler(JdbcTemplate jdbcTemplate, PGRConfiguration config) {
        this.jdbcTemplate = jdbcTemplate;
        this.config = config;
    }

    @Scheduled(fixedDelayString = "${pgr.dashboard.refresh.interval.ms:300000}")
    public void refreshMaterializedViews() {
        if (!Boolean.TRUE.equals(config.getDashboardRefreshEnabled())) {
            return;
        }

        long start = System.currentTimeMillis();

        // 1. V2 grains, in dependency order (events -> facts). These back every dashboard KPI.
        for (String mv : V2_GRAIN_MVS) {
            refreshConcurrently(mv);
        }

        // 2. Capture today's open backlog once facts is fresh (idempotent per day+complaint).
        try {
            int rows = jdbcTemplate.update(DAILY_SNAPSHOT_UPSERT);
            if (rows > 0) {
                log.info("complaint_open_state_daily: captured {} open complaints for today", rows);
            }
        } catch (Exception e) {
            log.warn("Failed to upsert complaint_open_state_daily snapshot: {}", e.getMessage());
        }

        // 3. Legacy KPI MVs (back-compat).
        for (String mv : LEGACY_MV_NAMES) {
            refreshConcurrently(mv);
        }

        log.info("Dashboard grains + MVs refreshed in {}ms", System.currentTimeMillis() - start);
    }

    private void refreshConcurrently(String mv) {
        try {
            jdbcTemplate.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY " + mv);
        } catch (Exception e) {
            log.warn("Failed to refresh {}: {}", mv, e.getMessage());
        }
    }
}
