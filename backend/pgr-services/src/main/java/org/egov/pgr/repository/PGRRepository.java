package org.egov.pgr.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.repository.rowmapper.DashboardQueryBuilder;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.util.PGRUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Provides aggregated/dynamic data queries backed by PostgreSQL.
 * Core complaint CRUD is handled via RegistryService; this is retained
 * only for dashboard and dynamic-data endpoints that hit the DB directly.
 */
@Repository
@Slf4j
@RequiredArgsConstructor
public class PGRRepository {

    private final DashboardQueryBuilder queryBuilder;
    private final JdbcTemplate jdbcTemplate;
    private final PGRUtils utils;

    public Map<String, Integer> fetchDynamicData(String tenantId) {
        List<Object> resolvedParams = new ArrayList<>();
        String resolvedQuery = queryBuilder.getResolvedComplaints(tenantId, resolvedParams);
        resolvedQuery = utils.replaceSchemaPlaceholder(resolvedQuery, tenantId);
        int complaintsResolved = jdbcTemplate.queryForObject(resolvedQuery, Integer.class, resolvedParams.toArray());

        List<Object> avgParams = new ArrayList<>();
        String avgQuery = queryBuilder.getAverageResolutionTime(tenantId, avgParams);
        avgQuery = utils.replaceSchemaPlaceholder(avgQuery, tenantId);
        Integer avgResolutionTime = jdbcTemplate.queryForObject(avgQuery, Integer.class, avgParams.toArray());
        if (avgResolutionTime == null) avgResolutionTime = 0;

        Map<String, Integer> data = new HashMap<>();
        data.put(PGRConstants.COMPLAINTS_RESOLVED, complaintsResolved);
        data.put(PGRConstants.AVERAGE_RESOLUTION_TIME, avgResolutionTime);
        return data;
    }
}
