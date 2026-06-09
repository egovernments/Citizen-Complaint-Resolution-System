package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class DashboardQueryBuilder {

    private static final String CLOSED_STATUSES = "'RESOLVED','CLOSEDAFTERRESOLUTION'";

    private PGRConfiguration config;

    @Autowired
    public DashboardQueryBuilder(PGRConfiguration config) {
        this.config = config;
    }

    // --- Materialized view queries (no date filter) ---

    public String getMvKpiQuery(String tenantId, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder("SELECT total, closed, completion_rate, avg_resolution_days, unique_citizens FROM pgr_mv_kpi WHERE ");
        appendTenantFilter(sb, tenantId, preparedStmtList);
        return sb.toString();
    }

    public String getMvMonthlyQuery(String tenantId, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder("SELECT month_label, month_date, total, closed, open_count, unique_citizens FROM pgr_mv_monthly WHERE ");
        appendTenantFilter(sb, tenantId, preparedStmtList);
        sb.append(" ORDER BY month_date");
        return sb.toString();
    }

    public String getMvMonthlySourceQuery(String tenantId, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder("SELECT month_label, month_date, source, total FROM pgr_mv_monthly_source WHERE ");
        appendTenantFilter(sb, tenantId, preparedStmtList);
        sb.append(" ORDER BY month_date, source");
        return sb.toString();
    }

    public String getMvDimensionQuery(String tenantId, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder("SELECT dimension, dim_value, total, closed, open_count, avg_resolution_days, completion_rate FROM pgr_mv_dimension WHERE ");
        appendTenantFilter(sb, tenantId, preparedStmtList);
        sb.append(" ORDER BY dimension, total DESC");
        return sb.toString();
    }

    // --- Filtered queries (date range, against raw tables) ---

    public String getFilteredKpiQuery(String tenantId, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder(
            "SELECT COUNT(*) AS total," +
            " COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) AS closed," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0), 2) AS completion_rate," +
            " ROUND(AVG(CASE WHEN s.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1) AS avg_resolution_days," +
            " COUNT(DISTINCT s.accountid) AS unique_citizens" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        return sb.toString();
    }

    public String getFilteredMonthlyQuery(String tenantId, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder(
            "SELECT TO_CHAR(TO_TIMESTAMP(s.createdtime / 1000), 'Mon-YYYY') AS month_label," +
            " DATE_TRUNC('month', TO_TIMESTAMP(s.createdtime / 1000))::date AS month_date," +
            " COUNT(*) AS total," +
            " COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) AS closed," +
            " COUNT(*) FILTER (WHERE s.applicationstatus NOT IN (" + CLOSED_STATUSES + ")) AS open_count," +
            " COUNT(DISTINCT s.accountid) AS unique_citizens" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY month_label, month_date ORDER BY month_date");
        return sb.toString();
    }

    public String getFilteredMonthlySourceQuery(String tenantId, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder(
            "SELECT TO_CHAR(TO_TIMESTAMP(s.createdtime / 1000), 'Mon-YYYY') AS month_label," +
            " DATE_TRUNC('month', TO_TIMESTAMP(s.createdtime / 1000))::date AS month_date," +
            " COALESCE(s.source, 'unknown') AS source," +
            " COUNT(*) AS total" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY month_label, month_date, source ORDER BY month_date, source");
        return sb.toString();
    }

    public String getFilteredDimensionQuery(String tenantId, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        // Status dimension
        StringBuilder sb = new StringBuilder(
            "SELECT 'status' AS dimension, s.applicationstatus AS dim_value," +
            " COUNT(*) AS total," +
            " COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) AS closed," +
            " COUNT(*) FILTER (WHERE s.applicationstatus NOT IN (" + CLOSED_STATUSES + ")) AS open_count," +
            " ROUND(AVG(CASE WHEN s.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1) AS avg_resolution_days," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0), 2) AS completion_rate" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY s.applicationstatus");

        // Source dimension
        sb.append(" UNION ALL SELECT 'source', COALESCE(s.source, 'unknown')," +
            " COUNT(*), COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + "))," +
            " COUNT(*) FILTER (WHERE s.applicationstatus NOT IN (" + CLOSED_STATUSES + "))," +
            " ROUND(AVG(CASE WHEN s.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1)," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0), 2)" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY s.source");

        // Type dimension
        sb.append(" UNION ALL SELECT 'type', s.servicecode," +
            " COUNT(*), COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + "))," +
            " COUNT(*) FILTER (WHERE s.applicationstatus NOT IN (" + CLOSED_STATUSES + "))," +
            " ROUND(AVG(CASE WHEN s.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1)," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0), 2)" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY s.servicecode");

        // Boundary dimension
        sb.append(" UNION ALL SELECT 'boundary', COALESCE(a.locality, 'Unknown')," +
            " COUNT(*), COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + "))," +
            " COUNT(*) FILTER (WHERE s.applicationstatus NOT IN (" + CLOSED_STATUSES + "))," +
            " ROUND(AVG(CASE WHEN s.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1)," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0), 2)" +
            " FROM {schema}.eg_pgr_service_v2 s LEFT JOIN {schema}.eg_pgr_address_v2 a ON s.id = a.parentid" +
            " WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(" GROUP BY a.locality");

        return sb.toString();
    }

    public String getFilteredDepartmentQuery(String tenantId, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        StringBuilder sb = new StringBuilder(
            "WITH service_dept AS (" +
            " SELECT DISTINCT ON (data->>'serviceCode') data->>'serviceCode' AS service_code, data->>'department' AS dept_code" +
            " FROM eg_mdms_data WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive = true" +
            "), dept_names AS (" +
            " SELECT DISTINCT ON (data->>'code') data->>'code' AS dept_code, data->>'name' AS dept_name" +
            " FROM eg_mdms_data WHERE schemacode = 'common-masters.Department' AND isactive = true" +
            "), filtered AS (" +
            " SELECT s.servicecode, s.applicationstatus, s.createdtime, s.lastmodifiedtime" +
            " FROM {schema}.eg_pgr_service_v2 s WHERE s.active = true AND ");
        appendTenantFilter(sb, "s.tenantid", tenantId, preparedStmtList);
        appendDateFilter(sb, fromDate, toDate, preparedStmtList);
        sb.append(")" +
            " SELECT COALESCE(dn.dept_name, sd.dept_code, 'Unknown') AS department," +
            " COUNT(*)::int AS total," +
            " COUNT(*) FILTER (WHERE f.applicationstatus IN (" + CLOSED_STATUSES + "))::int AS closed," +
            " COUNT(*) FILTER (WHERE f.applicationstatus NOT IN (" + CLOSED_STATUSES + "))::int AS open_count," +
            " ROUND(AVG(CASE WHEN f.applicationstatus IN (" + CLOSED_STATUSES + ") THEN (f.lastmodifiedtime - f.createdtime) / 86400000.0 END)::numeric, 1) AS avg_resolution_days," +
            " ROUND(100.0 * COUNT(*) FILTER (WHERE f.applicationstatus IN (" + CLOSED_STATUSES + ")) / NULLIF(COUNT(*), 0)::numeric, 2) AS completion_rate" +
            " FROM filtered f LEFT JOIN service_dept sd ON sd.service_code = f.servicecode" +
            " LEFT JOIN dept_names dn ON dn.dept_code = sd.dept_code" +
            " GROUP BY COALESCE(dn.dept_name, sd.dept_code, 'Unknown') ORDER BY total DESC");
        return sb.toString();
    }

    // Department query for MV path (all-time, no date filter)
    public String getMvDepartmentQuery(String tenantId, List<Object> preparedStmtList) {
        return getFilteredDepartmentQuery(tenantId, null, null, preparedStmtList);
    }

    // --- Helpers ---

    /**
     * Appends tenant filter for MV queries (no column prefix, MVs use 'tenantid' directly).
     */
    private void appendTenantFilter(StringBuilder sb, String tenantId, List<Object> preparedStmtList) {
        appendTenantFilter(sb, "tenantid", tenantId, preparedStmtList);
    }

    /**
     * Appends tenant filter: state-level uses LIKE, city-level uses =.
     */
    private void appendTenantFilter(StringBuilder sb, String column, String tenantId, List<Object> preparedStmtList) {
        String[] chunks = tenantId.split("\\.");
        if (chunks.length == config.getStateLevelTenantIdLength()) {
            sb.append(column).append(" LIKE ?");
            preparedStmtList.add(tenantId + "%");
        } else {
            sb.append(column).append(" = ?");
            preparedStmtList.add(tenantId);
        }
    }

    private void appendDateFilter(StringBuilder sb, Long fromDate, Long toDate, List<Object> preparedStmtList) {
        if (fromDate != null) {
            sb.append(" AND s.createdtime >= ?");
            preparedStmtList.add(fromDate);
        }
        if (toDate != null) {
            sb.append(" AND s.createdtime <= ?");
            preparedStmtList.add(toDate);
        }
    }
}
