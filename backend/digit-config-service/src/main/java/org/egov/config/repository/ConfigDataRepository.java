package org.egov.config.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.repository.querybuilder.ConfigDataQueryBuilder;
import org.egov.config.repository.rowmapper.ConfigDataRowMapper;
import org.egov.config.web.model.ConfigData;
import org.egov.config.web.model.ConfigDataCriteria;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Repository
@Slf4j
public class ConfigDataRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ConfigDataQueryBuilder queryBuilder;
    private final ConfigDataRowMapper rowMapper;
    private final ObjectMapper objectMapper;
    private final boolean isPostgres;

    public ConfigDataRepository(JdbcTemplate jdbcTemplate, ConfigDataQueryBuilder queryBuilder,
                                 ConfigDataRowMapper rowMapper, ObjectMapper objectMapper,
                                 @Value("${spring.datasource.driver-class-name:org.postgresql.Driver}") String driverClassName) {
        this.jdbcTemplate = jdbcTemplate;
        this.queryBuilder = queryBuilder;
        this.rowMapper = rowMapper;
        this.objectMapper = objectMapper;
        this.isPostgres = driverClassName.contains("postgresql");
    }

    public void save(ConfigData entry) {
        String dataPlaceholder = isPostgres ? "CAST(? AS jsonb)" : "?";
        String sql = "INSERT INTO eg_config_data (id, tenantid, uniqueidentifier, schemacode, data, " +
                "isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime) " +
                "VALUES (?, ?, ?, ?, " + dataPlaceholder + ", ?, ?, ?, ?, ?)";

        jdbcTemplate.update(sql,
                entry.getId(),
                entry.getTenantId(),
                entry.getUniqueIdentifier(),
                entry.getSchemaCode(),
                toJsonString(entry.getData()),
                entry.getIsActive(),
                entry.getAuditDetails().getCreatedBy(),
                entry.getAuditDetails().getLastModifiedBy(),
                entry.getAuditDetails().getCreatedTime(),
                entry.getAuditDetails().getLastModifiedTime()
        );
    }

    public void update(ConfigData entry) {
        String dataPlaceholder = isPostgres ? "CAST(? AS jsonb)" : "?";
        String sql = "UPDATE eg_config_data SET data = " + dataPlaceholder + ", isactive = ?, " +
                "lastmodifiedby = ?, lastmodifiedtime = ? WHERE id = ?";

        jdbcTemplate.update(sql,
                toJsonString(entry.getData()),
                entry.getIsActive(),
                entry.getAuditDetails().getLastModifiedBy(),
                entry.getAuditDetails().getLastModifiedTime(),
                entry.getId()
        );
    }

    public List<ConfigData> search(ConfigDataCriteria criteria) {
        log.info("ConfigDataRepository.search: Building search query for tenantId={}, schemaCode={}", 
                criteria.getTenantId(), criteria.getSchemaCode());
        
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(criteria, params);
        
        log.debug("ConfigDataRepository.search: Executing SQL: {} with params: {}", sql, params);
        List<ConfigData> results = jdbcTemplate.query(sql, params.toArray(), rowMapper);
        
        log.info("ConfigDataRepository.search: Query returned {} results", results.size());
        return results;
    }

    public long count(ConfigDataCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(criteria, params);
        Long count = jdbcTemplate.queryForObject(sql, params.toArray(), Long.class);
        return count != null ? count : 0;
    }

    public ConfigData resolve(String schemaCode, Map<String, Object> filters, List<String> tenantChain) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildResolveQuery(schemaCode, filters, tenantChain, params);
        List<ConfigData> results = jdbcTemplate.query(sql, params.toArray(), rowMapper);
        return results.isEmpty() ? null : results.get(0);
    }

    private String toJsonString(Object data) {
        if (data == null) return "{}";
        try {
            return objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize data to JSON", e);
        }
    }
}
