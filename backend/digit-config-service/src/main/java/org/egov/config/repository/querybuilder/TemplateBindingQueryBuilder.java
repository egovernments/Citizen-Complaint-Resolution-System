package org.egov.config.repository.querybuilder;

import org.egov.config.web.model.TemplateBindingSearchCriteria;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class TemplateBindingQueryBuilder {

    private static final String JOINED_SELECT =
            "SELECT tb.id AS tb_id, tb.template_id AS tb_template_id, tb.provider_id AS tb_provider_id, " +
            "tb.event_name AS tb_event_name, tb.content_sid AS tb_content_sid, tb.locale AS tb_locale, " +
            "tb.param_order AS tb_param_order, tb.required_vars AS tb_required_vars, " +
            "tb.tenant_id AS tb_tenant_id, tb.enabled AS tb_enabled, " +
            "tb.created_by AS tb_created_by, tb.created_time AS tb_created_time, " +
            "tb.last_modified_by AS tb_last_modified_by, tb.last_modified_time AS tb_last_modified_time, " +
            "pd.id AS pd_id, pd.provider_name AS pd_provider_name, pd.channel AS pd_channel, " +
            "pd.tenant_id AS pd_tenant_id, pd.enabled AS pd_enabled, pd.\"value\" AS pd_value, " +
            "pd.created_by AS pd_created_by, pd.created_time AS pd_created_time, " +
            "pd.last_modified_by AS pd_last_modified_by, pd.last_modified_time AS pd_last_modified_time " +
            "FROM template_binding tb " +
            "LEFT JOIN provider_detail pd ON tb.provider_id = pd.id";

    private static final String COUNT_SELECT = "SELECT COUNT(*) FROM template_binding tb";

    public String buildSearchQuery(TemplateBindingSearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(JOINED_SELECT);
        buildWhereClause(criteria, sql, params);
        sql.append(" ORDER BY tb.last_modified_time DESC");
        sql.append(" LIMIT ? OFFSET ?");
        params.add(criteria.getLimit());
        params.add(criteria.getOffset());
        return sql.toString();
    }

    public String buildCountQuery(TemplateBindingSearchCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(COUNT_SELECT);
        buildWhereClause(criteria, sql, params);
        return sql.toString();
    }

    public String buildResolveQuery(String eventName, List<String> tenantChain, List<Object> params) {
        StringBuilder sql = new StringBuilder(JOINED_SELECT);
        sql.append(" WHERE tb.event_name = ? AND tb.enabled = true");
        params.add(eventName);

        sql.append(" AND tb.tenant_id IN (");
        for (int i = 0; i < tenantChain.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append("?");
            params.add(tenantChain.get(i));
        }
        sql.append(")");

        // ORDER BY tenant specificity
        sql.append(" ORDER BY CASE tb.tenant_id");
        for (int i = 0; i < tenantChain.size(); i++) {
            sql.append(" WHEN ? THEN ").append(i);
            params.add(tenantChain.get(i));
        }
        sql.append(" ELSE ").append(tenantChain.size()).append(" END");

        sql.append(" LIMIT 1");
        return sql.toString();
    }

    private void buildWhereClause(TemplateBindingSearchCriteria criteria, StringBuilder sql, List<Object> params) {
        boolean hasWhere = false;

        if (criteria.getIds() != null && !criteria.getIds().isEmpty()) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.id IN (");
            for (int i = 0; i < criteria.getIds().size(); i++) {
                if (i > 0) sql.append(", ");
                sql.append("?");
                params.add(criteria.getIds().get(i));
            }
            sql.append(")");
            hasWhere = true;
        }

        if (criteria.getEventName() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.event_name = ?");
            params.add(criteria.getEventName());
            hasWhere = true;
        }

        if (criteria.getTenantId() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.tenant_id = ?");
            params.add(criteria.getTenantId());
            hasWhere = true;
        }

        if (criteria.getTemplateId() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.template_id = ?");
            params.add(criteria.getTemplateId());
            hasWhere = true;
        }

        if (criteria.getProviderId() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.provider_id = ?");
            params.add(criteria.getProviderId());
            hasWhere = true;
        }

        if (criteria.getLocale() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.locale = ?");
            params.add(criteria.getLocale());
            hasWhere = true;
        }

        if (criteria.getEnabled() != null) {
            sql.append(hasWhere ? " AND" : " WHERE");
            sql.append(" tb.enabled = ?");
            params.add(criteria.getEnabled());
        }
    }
}
