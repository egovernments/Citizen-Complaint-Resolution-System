package org.egov.config.repository;

import lombok.RequiredArgsConstructor;
import org.egov.config.repository.querybuilder.TemplateBindingQueryBuilder;
import org.egov.config.repository.rowmapper.TemplateBindingRowMapper;
import org.egov.config.web.model.TemplateBinding;
import org.egov.config.web.model.TemplateBindingSearchCriteria;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;

@Repository
@RequiredArgsConstructor
public class TemplateBindingRepository {

    private final JdbcTemplate jdbcTemplate;
    private final TemplateBindingQueryBuilder queryBuilder;
    private final TemplateBindingRowMapper rowMapper;
    private final ObjectMapper objectMapper;

    public void save(TemplateBinding entry) {
        String sql = "INSERT INTO template_binding (id, template_id, provider_id, event_name, content_sid, " +
                "locale, param_order, required_vars, tenant_id, enabled, created_by, created_time, last_modified_by, last_modified_time) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        jdbcTemplate.update(sql,
                entry.getId(),
                entry.getTemplateId(),
                entry.getProviderId(),
                entry.getEventName(),
                entry.getContentSid(),
                entry.getLocale(),
                toJsonString(entry.getParamOrder()),
                toJsonString(entry.getRequiredVars()),
                entry.getTenantId(),
                entry.getEnabled(),
                entry.getAuditDetails().getCreatedBy(),
                entry.getAuditDetails().getCreatedTime(),
                entry.getAuditDetails().getLastModifiedBy(),
                entry.getAuditDetails().getLastModifiedTime()
        );
    }

    public void update(TemplateBinding entry) {
        StringBuilder sql = new StringBuilder("UPDATE template_binding SET ");
        List<Object> params = new ArrayList<>();

        sql.append("last_modified_by = ?, last_modified_time = ?");
        params.add(entry.getAuditDetails().getLastModifiedBy());
        params.add(entry.getAuditDetails().getLastModifiedTime());

        if (entry.getEnabled() != null) {
            sql.append(", enabled = ?");
            params.add(entry.getEnabled());
        }
        if (entry.getTemplateId() != null) {
            sql.append(", template_id = ?");
            params.add(entry.getTemplateId());
        }
        if (entry.getProviderId() != null) {
            sql.append(", provider_id = ?");
            params.add(entry.getProviderId());
        }
        if (entry.getContentSid() != null) {
            sql.append(", content_sid = ?");
            params.add(entry.getContentSid());
        }
        if (entry.getLocale() != null) {
            sql.append(", locale = ?");
            params.add(entry.getLocale());
        }
        if (entry.getParamOrder() != null) {
            sql.append(", param_order = ?");
            params.add(toJsonString(entry.getParamOrder()));
        }
        if (entry.getRequiredVars() != null) {
            sql.append(", required_vars = ?");
            params.add(toJsonString(entry.getRequiredVars()));
        }

        sql.append(" WHERE id = ?");
        params.add(entry.getId());

        jdbcTemplate.update(sql.toString(), params.toArray());
    }

    public List<TemplateBinding> search(TemplateBindingSearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(criteria, params);
        return jdbcTemplate.query(sql, params.toArray(), rowMapper);
    }

    public long count(TemplateBindingSearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(criteria, params);
        Long count = jdbcTemplate.queryForObject(sql, params.toArray(), Long.class);
        return count != null ? count : 0;
    }

    public TemplateBinding resolve(String eventName, List<String> tenantChain) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildResolveQuery(eventName, tenantChain, params);
        List<TemplateBinding> results = jdbcTemplate.query(sql, params.toArray(), rowMapper);
        return results.isEmpty() ? null : results.get(0);
    }

    private String toJsonString(List<String> list) {
        if (list == null) return null;
        try {
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize list to JSON", e);
        }
    }
}
