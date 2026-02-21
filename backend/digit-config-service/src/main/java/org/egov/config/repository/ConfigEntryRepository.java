package org.egov.config.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.repository.querybuilder.ConfigEntryQueryBuilder;
import org.egov.config.repository.rowmapper.ConfigEntryRowMapper;
import org.egov.config.web.model.ConfigEntry;
import org.egov.config.web.model.ConfigEntrySearchCriteria;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

@Repository
@RequiredArgsConstructor
public class ConfigEntryRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ConfigEntryQueryBuilder queryBuilder;
    private final ConfigEntryRowMapper rowMapper;
    private final ObjectMapper objectMapper;

    public void save(ConfigEntry entry) {
        String sql = "INSERT INTO config_entry (id, config_code, module, event_type, channel, tenant_id, locale, enabled, " +
                "\"value\", revision, created_by, created_time, last_modified_by, last_modified_time) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        jdbcTemplate.update(sql,
                entry.getId(),
                entry.getConfigCode(),
                entry.getModule(),
                entry.getEventType(),
                entry.getChannel(),
                entry.getTenantId(),
                entry.getLocale(),
                entry.getEnabled(),
                toJson(entry.getValue()),
                entry.getRevision(),
                entry.getAuditDetails().getCreatedBy(),
                entry.getAuditDetails().getCreatedTime(),
                entry.getAuditDetails().getLastModifiedBy(),
                entry.getAuditDetails().getLastModifiedTime()
        );
    }

    public void update(ConfigEntry entry) {
        StringBuilder sql = new StringBuilder("UPDATE config_entry SET ");
        List<Object> params = new ArrayList<>();

        sql.append("revision = ?, last_modified_by = ?, last_modified_time = ?");
        params.add(entry.getRevision());
        params.add(entry.getAuditDetails().getLastModifiedBy());
        params.add(entry.getAuditDetails().getLastModifiedTime());

        if (entry.getEnabled() != null) {
            sql.append(", enabled = ?");
            params.add(entry.getEnabled());
        }
        if (entry.getEventType() != null) {
            sql.append(", event_type = ?");
            params.add(entry.getEventType());
        }
        if (entry.getChannel() != null) {
            sql.append(", channel = ?");
            params.add(entry.getChannel());
        }
        if (entry.getValue() != null) {
            sql.append(", \"value\" = ?");
            params.add(toJson(entry.getValue()));
        }

        sql.append(" WHERE id = ?");
        params.add(entry.getId());

        jdbcTemplate.update(sql.toString(), params.toArray());
    }

    public List<ConfigEntry> search(ConfigEntrySearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(criteria, params);
        return jdbcTemplate.query(sql, params.toArray(), rowMapper);
    }

    public long count(ConfigEntrySearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(criteria, params);
        Long count = jdbcTemplate.queryForObject(sql, params.toArray(), Long.class);
        return count != null ? count : 0;
    }

    public ConfigEntry resolve(String configCode, String module,
                               List<String> tenantChain, List<String> localeChain) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildResolveQuery(configCode, module, tenantChain, localeChain, params);
        List<ConfigEntry> results = jdbcTemplate.query(sql, params.toArray(), rowMapper);
        return results.isEmpty() ? null : results.get(0);
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize to JSON", e);
        }
    }
}
