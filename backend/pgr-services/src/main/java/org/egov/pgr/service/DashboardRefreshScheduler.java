package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Slf4j
public class DashboardRefreshScheduler {

    private final JdbcTemplate jdbcTemplate;
    private final PGRConfiguration config;

    private static final String[] MV_NAMES = {
        "pgr_mv_kpi", "pgr_mv_monthly", "pgr_mv_monthly_source", "pgr_mv_dimension"
    };

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
        for (String mv : MV_NAMES) {
            try {
                jdbcTemplate.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY " + mv);
            } catch (Exception e) {
                log.warn("Failed to refresh {}: {}", mv, e.getMessage());
            }
        }
        log.info("Dashboard MVs refreshed in {}ms", System.currentTimeMillis() - start);
    }
}
