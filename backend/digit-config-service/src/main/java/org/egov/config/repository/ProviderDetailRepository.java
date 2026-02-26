package org.egov.config.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.repository.querybuilder.ProviderDetailQueryBuilder;
import org.egov.config.repository.rowmapper.ProviderDetailRowMapper;
import org.egov.config.web.model.ProviderDetail;
import org.egov.config.web.model.ProviderDetailSearchCriteria;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

@Repository
@RequiredArgsConstructor
public class ProviderDetailRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ProviderDetailQueryBuilder queryBuilder;
    private final ProviderDetailRowMapper rowMapper;
    private final ObjectMapper objectMapper;

    public void save(ProviderDetail entry) {
        String sql = "INSERT INTO provider_detail (id, provider_name, channel, tenant_id, enabled, " +
                "\"value\", created_by, created_time, last_modified_by, last_modified_time) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        jdbcTemplate.update(sql,
                entry.getId(),
                entry.getProviderName(),
                entry.getChannel(),
                entry.getTenantId(),
                entry.getEnabled(),
                toJson(entry.getValue()),
                entry.getAuditDetails().getCreatedBy(),
                entry.getAuditDetails().getCreatedTime(),
                entry.getAuditDetails().getLastModifiedBy(),
                entry.getAuditDetails().getLastModifiedTime()
        );
    }

    public void update(ProviderDetail entry) {
        StringBuilder sql = new StringBuilder("UPDATE provider_detail SET ");
        List<Object> params = new ArrayList<>();

        sql.append("last_modified_by = ?, last_modified_time = ?");
        params.add(entry.getAuditDetails().getLastModifiedBy());
        params.add(entry.getAuditDetails().getLastModifiedTime());

        if (entry.getEnabled() != null) {
            sql.append(", enabled = ?");
            params.add(entry.getEnabled());
        }
        if (entry.getChannel() != null) {
            sql.append(", channel = ?");
            params.add(entry.getChannel());
        }
        if (entry.getProviderName() != null) {
            sql.append(", provider_name = ?");
            params.add(entry.getProviderName());
        }
        if (entry.getValue() != null) {
            sql.append(", \"value\" = ?");
            params.add(toJson(entry.getValue()));
        }

        sql.append(" WHERE id = ?");
        params.add(entry.getId());

        jdbcTemplate.update(sql.toString(), params.toArray());
    }

    public List<ProviderDetail> search(ProviderDetailSearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(criteria, params);
        return jdbcTemplate.query(sql, params.toArray(), rowMapper);
    }

    public long count(ProviderDetailSearchCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(criteria, params);
        Long count = jdbcTemplate.queryForObject(sql, params.toArray(), Long.class);
        return count != null ? count : 0;
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
