package org.egov.config.repository.querybuilder;

import org.egov.config.web.model.ProviderDetailSearchCriteria;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ProviderDetailQueryBuilder {

    private static final String BASE_SELECT = "SELECT id, provider_name, channel, tenant_id, enabled, " +
            "\"value\", created_by, created_time, last_modified_by, last_modified_time " +
            "FROM provider_detail";

    private static final String COUNT_SELECT = "SELECT COUNT(*) FROM provider_detail";

    public String buildSearchQuery(ProviderDetailSearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        buildWhereClause(criteria, sql, params);
        sql.append(" ORDER BY last_modified_time DESC");
        sql.append(" LIMIT ? OFFSET ?");
        params.add(criteria.getLimit());
        params.add(criteria.getOffset());
        return sql.toString();
    }

    public String buildCountQuery(ProviderDetailSearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(COUNT_SELECT);
        buildWhereClause(criteria, sql, params);
        return sql.toString();
    }

    private void buildWhereClause(ProviderDetailSearchCriteria criteria, StringBuilder sql, List<Object> params) {
        boolean hasWhere = false;

        if (criteria.getIds() != null && !criteria.getIds().isEmpty()) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" id IN (");
            for (int i = 0; i < criteria.getIds().size(); i++) {
                if (i > 0) sql.append(", ");
                sql.append("?");
                params.add(criteria.getIds().get(i));
            }
            sql.append(")");
            hasWhere = true;
        }

        if (criteria.getProviderName() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" provider_name = ?");
            params.add(criteria.getProviderName());
            hasWhere = true;
        }

        if (criteria.getChannel() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" channel = ?");
            params.add(criteria.getChannel());
            hasWhere = true;
        }

        if (criteria.getTenantId() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tenant_id = ?");
            params.add(criteria.getTenantId());
            hasWhere = true;
        }

        if (criteria.getEnabled() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" enabled = ?");
            params.add(criteria.getEnabled());
        }
    }
}
