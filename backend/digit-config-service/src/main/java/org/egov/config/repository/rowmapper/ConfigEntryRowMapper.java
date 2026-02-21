package org.egov.config.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.web.model.AuditDetails;
import org.egov.config.web.model.ConfigEntry;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;

@Component
@RequiredArgsConstructor
public class ConfigEntryRowMapper implements RowMapper<ConfigEntry> {

    private final ObjectMapper objectMapper;

    @Override
    public ConfigEntry mapRow(ResultSet rs, int rowNum) throws SQLException {
        return ConfigEntry.builder()
                .id(rs.getString("id"))
                .configCode(rs.getString("config_code"))
                .module(rs.getString("module"))
                .eventType(rs.getString("event_type"))
                .channel(rs.getString("channel"))
                .tenantId(rs.getString("tenant_id"))
                .locale(rs.getString("locale"))
                .enabled(rs.getBoolean("enabled"))
                .value(parseJson(rs.getString("value")))
                .revision(rs.getInt("revision"))
                .auditDetails(AuditDetails.builder()
                        .createdBy(rs.getString("created_by"))
                        .createdTime(rs.getLong("created_time"))
                        .lastModifiedBy(rs.getString("last_modified_by"))
                        .lastModifiedTime(rs.getLong("last_modified_time"))
                        .build())
                .build();
    }

    private JsonNode parseJson(String json) {
        if (json == null) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse JSON from database", e);
        }
    }
}
