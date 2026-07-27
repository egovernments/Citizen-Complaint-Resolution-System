package org.egov.pgr.repository;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Local projection of the HRMS reporting hierarchy (eg_pgr_hrms_projection,
 * VISIBILITY-DESIGN.md §4.3). Written by HrmsProjectionConsumer / the rebuild
 * sweep; read by VisibilityService to resolve a supervisor's reportees with
 * zero live HRMS calls.
 */
@Slf4j
@Repository
public class HrmsProjectionRepository {

    private static final String UPSERT_SQL =
            "INSERT INTO eg_pgr_hrms_projection (uuid, tenantid, reporting_to, department, active, lastmodifiedtime) " +
            "VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT (uuid) DO UPDATE SET tenantid = EXCLUDED.tenantid, reporting_to = EXCLUDED.reporting_to, " +
            "department = EXCLUDED.department, active = EXCLUDED.active, lastmodifiedtime = EXCLUDED.lastmodifiedtime";

    // Downward reportee walk: adjacency list + recursive CTE capped at :depth
    // (design §4.3). Only active employees count. tenantid is matched by
    // state-level prefix so city-tenant complaints resolve against employees
    // registered at the state tenant (bomet pattern: employees live at "ke").
    private static final String REPORTEES_SQL =
            "WITH RECURSIVE tree(uuid, depth) AS ( " +
            "  SELECT uuid, 1 FROM eg_pgr_hrms_projection " +
            "    WHERE reporting_to = ? AND active = TRUE AND (tenantid = ? OR tenantid = split_part(?, '.', 1)) " +
            "  UNION ALL " +
            "  SELECT c.uuid, tree.depth + 1 FROM eg_pgr_hrms_projection c " +
            "    JOIN tree ON c.reporting_to = tree.uuid " +
            "    WHERE c.active = TRUE AND (c.tenantid = ? OR c.tenantid = split_part(?, '.', 1)) AND tree.depth < ? ) " +
            "SELECT uuid FROM tree";

    private final JdbcTemplate jdbcTemplate;

    @Autowired
    public HrmsProjectionRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void upsert(String uuid, String tenantId, String reportingTo, String department, boolean active) {
        jdbcTemplate.update(UPSERT_SQL, uuid, tenantId, reportingTo, department, active, System.currentTimeMillis());
    }

    /**
     * Everyone transitively under the given employee in the reportingTo tree,
     * capped at depth. Empty set when the employee has no (projected) reportees.
     */
    public Set<String> getReporteeUuids(String tenantId, String employeeUuid, int depth) {
        if (employeeUuid == null || depth < 1) {
            return Collections.emptySet();
        }
        List<String> rows = jdbcTemplate.queryForList(REPORTEES_SQL, String.class,
                employeeUuid, tenantId, tenantId, tenantId, tenantId, depth);
        return new HashSet<>(rows);
    }

    /** Used by the rebuild backstop to decide whether a boot-time backfill is needed. */
    public boolean isEmpty() {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM eg_pgr_hrms_projection", Integer.class);
        return count == null || count == 0;
    }
}
