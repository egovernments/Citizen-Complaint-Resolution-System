package org.egov.userpreference.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.repository.querybuilder.PreferenceQueryBuilder;
import org.egov.userpreference.repository.rowmapper.PreferenceRowMapper;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

/** Data access for {@code user_preference}. */
@Repository
@Slf4j
public class PreferenceRepository {

    private final JdbcTemplate jdbcTemplate;
    private final PreferenceQueryBuilder queryBuilder;
    private final PreferenceRowMapper rowMapper;
    private final ObjectMapper objectMapper;

    public PreferenceRepository(JdbcTemplate jdbcTemplate,
                                PreferenceQueryBuilder queryBuilder,
                                PreferenceRowMapper rowMapper,
                                ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.queryBuilder = queryBuilder;
        this.rowMapper = rowMapper;
        this.objectMapper = objectMapper;
    }

    /** The row a preference upserts onto, or null when there is none yet. */
    public Preference findByKey(String userId, String tenantId, String preferenceCode) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildFindByKeyQuery(userId, tenantId, preferenceCode, params);
        log.debug("findByKey: {} params={}", sql, params);
        List<Preference> results = jdbcTemplate.query(sql, rowMapper, params.toArray());
        return results.isEmpty() ? null : results.get(0);
    }

    public Preference findById(String id) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildFindByIdQuery(id, params);
        List<Preference> results = jdbcTemplate.query(sql, rowMapper, params.toArray());
        return results.isEmpty() ? null : results.get(0);
    }

    /** Inserts the enriched preference and returns it unchanged. */
    public Preference create(Preference preference) {
        jdbcTemplate.update(queryBuilder.buildInsertQuery(),
                preference.getId(),
                preference.getUserId(),
                preference.getTenantId(),
                preference.getPreferenceCode(),
                toJsonString(preference.getPayload()),
                preference.getAuditDetails().getCreatedBy(),
                preference.getAuditDetails().getCreatedTime(),
                preference.getAuditDetails().getLastModifiedBy(),
                preference.getAuditDetails().getLastModifiedTime());
        return preference;
    }

    /**
     * Applies the payload change, then re-reads the row so the response
     * carries what is actually stored rather than what was sent.
     */
    public Preference update(Preference preference) {
        jdbcTemplate.update(queryBuilder.buildUpdateQuery(),
                toJsonString(preference.getPayload()),
                preference.getAuditDetails().getLastModifiedBy(),
                preference.getAuditDetails().getLastModifiedTime(),
                preference.getId());
        return findById(preference.getId());
    }

    public List<Preference> search(PreferenceCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(criteria, params);
        log.debug("search: {} params={}", sql, params);
        return jdbcTemplate.query(sql, rowMapper, params.toArray());
    }

    public long count(PreferenceCriteria criteria) {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(criteria, params);
        Long count = jdbcTemplate.queryForObject(sql, Long.class, params.toArray());
        return count != null ? count : 0L;
    }

    /** True when the database is reachable; backs the {@code /health} probe. */
    public boolean isReachable() {
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return true;
        } catch (Exception e) {
            log.warn("Database health check failed", e);
            return false;
        }
    }

    /**
     * Serializes the payload for binding. A null payload is written as the
     * column's own default so the NOT NULL constraint still holds; an explicit
     * JSON {@code null} is written as {@code jsonb} null and round-trips as
     * {@code "payload": null}.
     */
    private String toJsonString(Object payload) {
        if (payload == null) {
            return "{}";
        }
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to serialize payload to JSON", e);
        }
    }
}
