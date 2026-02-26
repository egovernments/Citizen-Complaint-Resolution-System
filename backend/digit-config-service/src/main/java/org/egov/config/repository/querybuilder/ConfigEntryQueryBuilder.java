package org.egov.config.repository.querybuilder;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

@Component
public class ConfigEntryQueryBuilder {

    private static final String BASE_SELECT = "SELECT id, config_code, module, channel, " +
            "tenant_id, enabled, \"value\", revision, " +
            "created_by, created_time, last_modified_by, last_modified_time " +
            "FROM config_entry";

    private static final String COUNT_SELECT = "SELECT COUNT(*) FROM config_entry";

    public String buildSearchQuery(org.egov.config.web.model.ConfigEntrySearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        buildWhereClause(criteria, sql, params);

        sql.append(" ORDER BY last_modified_time DESC");
        sql.append(" LIMIT ? OFFSET ?");
        params.add(criteria.getLimit());
        params.add(criteria.getOffset());

        return sql.toString();
    }

    public String buildCountQuery(org.egov.config.web.model.ConfigEntrySearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(COUNT_SELECT);
        buildWhereClause(criteria, sql, params);
        return sql.toString();
    }

    public String buildResolveQuery(String configCode, String module, String eventName,
                                     String channel, List<String> tenantChain,
                                     List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        sql.append(" WHERE config_code = ? AND enabled = true");
        params.add(configCode);

        if (module != null) {
            sql.append(" AND module = ?");
            params.add(module);
        }

        if (eventName != null) {
            sql.append(" AND CAST(\"value\" AS JSON)->>'eventName' = ?");
            params.add(eventName);
        }

        if (channel != null) {
            sql.append(" AND channel = ?");
            params.add(channel);
        }

        // tenant_id IN (?, ?, ...)
        sql.append(" AND tenant_id IN (");
        for (int i = 0; i < tenantChain.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append("?");
            params.add(tenantChain.get(i));
        }
        sql.append(")");

        // ORDER BY priority: tenant specificity
        sql.append(" ORDER BY CASE tenant_id");
        for (int i = 0; i < tenantChain.size(); i++) {
            sql.append(" WHEN ? THEN ").append(i);
            params.add(tenantChain.get(i));
        }
        sql.append(" ELSE ").append(tenantChain.size()).append(" END");

        sql.append(" LIMIT 1");
        return sql.toString();
    }

    private void buildWhereClause(org.egov.config.web.model.ConfigEntrySearchCriteria criteria,
                                  StringBuilder sql, List<Object> params) {
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

        if (criteria.getConfigCode() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" config_code = ?");
            params.add(criteria.getConfigCode());
            hasWhere = true;
        }

        if (criteria.getModule() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" module = ?");
            params.add(criteria.getModule());
            hasWhere = true;
        }

        if (criteria.getEventName() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" CAST(\"value\" AS JSON)->>'eventName' = ?");
            params.add(criteria.getEventName());
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
            hasWhere = true;
        }

        // valueFilter: arbitrary JSON field filtering
        if (criteria.getValueFilter() != null && criteria.getValueFilter().isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = criteria.getValueFilter().fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                sql.append(hasWhere ? " AND" : " WHERE");
                sql.append(" CAST(\"value\" AS JSON)->>'").append(field.getKey().replaceAll("[^a-zA-Z0-9_]", "")).append("' = ?");
                params.add(field.getValue().isTextual() ? field.getValue().asText() : field.getValue().toString());
                hasWhere = true;
            }
        }
    }
}
