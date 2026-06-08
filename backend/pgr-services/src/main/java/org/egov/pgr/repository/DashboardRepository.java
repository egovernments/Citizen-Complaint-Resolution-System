package org.egov.pgr.repository;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.repository.rowmapper.DashboardQueryBuilder;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.web.models.DashboardResponse;
import org.egov.pgr.web.models.DashboardResponse.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Repository
@Slf4j
public class DashboardRepository {

    private final DashboardQueryBuilder queryBuilder;
    private final JdbcTemplate jdbcTemplate;
    private final PGRUtils utils;

    @Autowired
    public DashboardRepository(DashboardQueryBuilder queryBuilder, JdbcTemplate jdbcTemplate, PGRUtils utils) {
        this.queryBuilder = queryBuilder;
        this.jdbcTemplate = jdbcTemplate;
        this.utils = utils;
    }

    /**
     * Query dashboard data from materialized views (all-time, no date filter).
     */
    public DashboardResponse queryFromMVs(String tenantId) {
        DashboardKpi kpi = queryMvKpi(tenantId);
        List<DashboardMonthly> monthly = queryMvMonthly(tenantId);
        List<DashboardMonthlySource> monthlySource = queryMvMonthlySource(tenantId);
        List<DashboardDimension> dimensions = queryMvDimension(tenantId);
        List<DashboardDepartment> departments = queryDepartments(tenantId, null, null);

        return DashboardResponse.builder()
                .kpi(kpi)
                .monthly(monthly)
                .monthlySource(monthlySource)
                .dimensions(dimensions)
                .departments(departments)
                .refreshedAt(Instant.now().toString())
                .build();
    }

    /**
     * Query dashboard data from raw tables with date filtering.
     */
    public DashboardResponse queryFiltered(String tenantId, Long fromDate, Long toDate) {
        DashboardKpi kpi = queryFilteredKpi(tenantId, fromDate, toDate);
        List<DashboardMonthly> monthly = queryFilteredMonthly(tenantId, fromDate, toDate);
        List<DashboardMonthlySource> monthlySource = queryFilteredMonthlySource(tenantId, fromDate, toDate);
        List<DashboardDimension> dimensions = queryFilteredDimension(tenantId, fromDate, toDate);
        List<DashboardDepartment> departments = queryDepartments(tenantId, fromDate, toDate);

        return DashboardResponse.builder()
                .kpi(kpi)
                .monthly(monthly)
                .monthlySource(monthlySource)
                .dimensions(dimensions)
                .departments(departments)
                .refreshedAt(Instant.now().toString())
                .build();
    }

    // --- MV queries ---

    private DashboardKpi queryMvKpi(String tenantId) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getMvKpiQuery(tenantId, params);
        // MV queries are cross-schema (public), no schema replacement needed
        List<DashboardKpi> results = jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardKpi.builder()
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .completionRate(rs.getBigDecimal("completion_rate"))
                .avgResolutionDays(rs.getBigDecimal("avg_resolution_days"))
                .uniqueCitizens(rs.getInt("unique_citizens"))
                .build()
        );
        if (results.isEmpty()) {
            return DashboardKpi.builder().total(0).closed(0)
                .completionRate(BigDecimal.ZERO).avgResolutionDays(null).uniqueCitizens(0).build();
        }
        // For state-level (LIKE), aggregate across matched tenants
        if (results.size() > 1) {
            return aggregateKpi(results);
        }
        return results.get(0);
    }

    private List<DashboardMonthly> queryMvMonthly(String tenantId) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getMvMonthlyQuery(tenantId, params);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardMonthly.builder()
                .monthLabel(rs.getString("month_label"))
                .monthDate(rs.getString("month_date"))
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .openCount(rs.getInt("open_count"))
                .uniqueCitizens(rs.getInt("unique_citizens"))
                .build()
        );
    }

    private List<DashboardMonthlySource> queryMvMonthlySource(String tenantId) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getMvMonthlySourceQuery(tenantId, params);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardMonthlySource.builder()
                .monthLabel(rs.getString("month_label"))
                .monthDate(rs.getString("month_date"))
                .source(rs.getString("source"))
                .total(rs.getInt("total"))
                .build()
        );
    }

    private List<DashboardDimension> queryMvDimension(String tenantId) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getMvDimensionQuery(tenantId, params);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardDimension.builder()
                .dimension(rs.getString("dimension"))
                .dimValue(rs.getString("dim_value"))
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .openCount(rs.getInt("open_count"))
                .avgResolutionDays(rs.getBigDecimal("avg_resolution_days"))
                .completionRate(rs.getBigDecimal("completion_rate"))
                .build()
        );
    }

    // --- Filtered queries ---

    private DashboardKpi queryFilteredKpi(String tenantId, Long fromDate, Long toDate) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getFilteredKpiQuery(tenantId, fromDate, toDate, params);
        query = replaceSchema(query, tenantId);
        List<DashboardKpi> results = jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardKpi.builder()
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .completionRate(rs.getBigDecimal("completion_rate"))
                .avgResolutionDays(rs.getBigDecimal("avg_resolution_days"))
                .uniqueCitizens(rs.getInt("unique_citizens"))
                .build()
        );
        return results.isEmpty()
            ? DashboardKpi.builder().total(0).closed(0)
                .completionRate(BigDecimal.ZERO).avgResolutionDays(null).uniqueCitizens(0).build()
            : results.get(0);
    }

    private List<DashboardMonthly> queryFilteredMonthly(String tenantId, Long fromDate, Long toDate) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getFilteredMonthlyQuery(tenantId, fromDate, toDate, params);
        query = replaceSchema(query, tenantId);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardMonthly.builder()
                .monthLabel(rs.getString("month_label"))
                .monthDate(rs.getString("month_date"))
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .openCount(rs.getInt("open_count"))
                .uniqueCitizens(rs.getInt("unique_citizens"))
                .build()
        );
    }

    private List<DashboardMonthlySource> queryFilteredMonthlySource(String tenantId, Long fromDate, Long toDate) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getFilteredMonthlySourceQuery(tenantId, fromDate, toDate, params);
        query = replaceSchema(query, tenantId);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardMonthlySource.builder()
                .monthLabel(rs.getString("month_label"))
                .monthDate(rs.getString("month_date"))
                .source(rs.getString("source"))
                .total(rs.getInt("total"))
                .build()
        );
    }

    private List<DashboardDimension> queryFilteredDimension(String tenantId, Long fromDate, Long toDate) {
        List<Object> params = new ArrayList<>();
        String query = queryBuilder.getFilteredDimensionQuery(tenantId, fromDate, toDate, params);
        query = replaceSchema(query, tenantId);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardDimension.builder()
                .dimension(rs.getString("dimension"))
                .dimValue(rs.getString("dim_value"))
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .openCount(rs.getInt("open_count"))
                .avgResolutionDays(rs.getBigDecimal("avg_resolution_days"))
                .completionRate(rs.getBigDecimal("completion_rate"))
                .build()
        );
    }

    // --- Department query (used by both MV and filtered paths) ---

    private List<DashboardDepartment> queryDepartments(String tenantId, Long fromDate, Long toDate) {
        List<Object> params = new ArrayList<>();
        String query;
        if (fromDate != null) {
            query = queryBuilder.getFilteredDepartmentQuery(tenantId, fromDate, toDate, params);
        } else {
            query = queryBuilder.getMvDepartmentQuery(tenantId, params);
        }
        query = replaceSchema(query, tenantId);
        return jdbcTemplate.query(query, params.toArray(), (rs, rowNum) ->
            DashboardDepartment.builder()
                .department(rs.getString("department"))
                .total(rs.getInt("total"))
                .closed(rs.getInt("closed"))
                .openCount(rs.getInt("open_count"))
                .avgResolutionDays(rs.getBigDecimal("avg_resolution_days"))
                .completionRate(rs.getBigDecimal("completion_rate"))
                .build()
        );
    }

    // --- Helpers ---

    private String replaceSchema(String query, String tenantId) {
        return utils.replaceSchemaPlaceholder(query, tenantId);
    }

    private DashboardKpi aggregateKpi(List<DashboardKpi> rows) {
        int total = 0;
        int closed = 0;
        int uniqueCitizens = 0;
        double totalResolutionDays = 0;
        int resolutionCount = 0;

        for (DashboardKpi row : rows) {
            total += row.getTotal();
            closed += row.getClosed();
            uniqueCitizens += row.getUniqueCitizens();
            if (row.getAvgResolutionDays() != null) {
                totalResolutionDays += row.getAvgResolutionDays().doubleValue() * row.getClosed();
                resolutionCount += row.getClosed();
            }
        }

        BigDecimal completionRate = total > 0
            ? BigDecimal.valueOf(100.0 * closed / total).setScale(2, BigDecimal.ROUND_HALF_UP)
            : BigDecimal.ZERO;
        BigDecimal avgResolutionDays = resolutionCount > 0
            ? BigDecimal.valueOf(totalResolutionDays / resolutionCount).setScale(1, BigDecimal.ROUND_HALF_UP)
            : null;

        return DashboardKpi.builder()
            .total(total)
            .closed(closed)
            .completionRate(completionRate)
            .avgResolutionDays(avgResolutionDays)
            .uniqueCitizens(uniqueCitizens)
            .build();
    }
}
