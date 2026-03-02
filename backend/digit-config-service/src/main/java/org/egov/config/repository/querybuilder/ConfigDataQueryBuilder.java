package org.egov.config.repository.querybuilder;

import org.egov.config.utils.QueryUtil;
import org.egov.config.web.model.ConfigDataCriteria;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.List;
import java.util.Map;

@Component
public class ConfigDataQueryBuilder {

    private static final String BASE_SELECT =
            "SELECT id, tenantid, uniqueidentifier, schemacode, data, isactive, " +
            "createdby, lastmodifiedby, createdtime, lastmodifiedtime FROM eg_config_data";

    private static final String COUNT_SELECT = "SELECT COUNT(*) FROM eg_config_data";

    private final boolean isPostgres;

    public ConfigDataQueryBuilder(
            @Value("${spring.datasource.driver-class-name:org.postgresql.Driver}") String driverClassName) {
        this.isPostgres = driverClassName.contains("postgresql");
    }

    public String buildSearchQuery(ConfigDataCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        buildWhereClause(criteria, sql, params);
        sql.append(" ORDER BY lastmodifiedtime DESC");
        sql.append(" LIMIT ? OFFSET ?");
        params.add(criteria.getLimit());
        params.add(criteria.getOffset());
        return sql.toString();
    }

    public String buildCountQuery(ConfigDataCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(COUNT_SELECT);
        buildWhereClause(criteria, sql, params);
        return sql.toString();
    }

    public String buildResolveQuery(String schemaCode, Map<String, String> filters,
                                     List<String> tenantChain, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        sql.append(" WHERE schemacode = ? AND isactive = true");
        params.add(schemaCode);

        appendJsonbFilter(filters, sql, params);

        sql.append(" AND tenantid IN (");
        for (int i = 0; i < tenantChain.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append("?");
            params.add(tenantChain.get(i));
        }
        sql.append(")");

        sql.append(" ORDER BY CASE tenantid");
        for (int i = 0; i < tenantChain.size(); i++) {
            sql.append(" WHEN ? THEN ").append(i);
            params.add(tenantChain.get(i));
        }
        sql.append(" ELSE ").append(tenantChain.size()).append(" END");

        sql.append(" LIMIT 1");
        return sql.toString();
    }

    private void buildWhereClause(ConfigDataCriteria criteria, StringBuilder sql, List<Object> params) {
        if (criteria.getTenantId() != null) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" tenantid = ?");
            params.add(criteria.getTenantId());
        }

        if (!CollectionUtils.isEmpty(criteria.getIds())) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" id IN (").append(QueryUtil.createQuery(criteria.getIds().size())).append(")");
            QueryUtil.addToPreparedStatement(params, criteria.getIds());
        }

        if (!CollectionUtils.isEmpty(criteria.getUniqueIdentifiers())) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" uniqueidentifier IN (").append(QueryUtil.createQuery(criteria.getUniqueIdentifiers().size())).append(")");
            QueryUtil.addToPreparedStatement(params, criteria.getUniqueIdentifiers());
        }

        if (criteria.getSchemaCode() != null) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" schemacode = ?");
            params.add(criteria.getSchemaCode());
        }

        if (!CollectionUtils.isEmpty(criteria.getFilters())) {
            appendJsonbFilter(criteria.getFilters(), sql, params);
        }

        if (criteria.getIsActive() != null) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" isactive = ?");
            params.add(criteria.getIsActive());
        }
    }

    private void appendJsonbFilter(Map<String, String> filters, StringBuilder sql, List<Object> params) {
        if (CollectionUtils.isEmpty(filters)) return;

        if (isPostgres) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" data @> CAST(? AS jsonb)");
            params.add(QueryUtil.preparePartialJsonStringFromFilterMap(filters));
        } else {
            // H2 fallback: use LIKE on each filter key-value pair
            for (Map.Entry<String, String> entry : filters.entrySet()) {
                QueryUtil.addClauseIfRequired(sql, params);
                sql.append(" data LIKE ?");
                params.add("%" + entry.getKey() + "\"%:%" + entry.getValue() + "%");
            }
        }
    }
}
