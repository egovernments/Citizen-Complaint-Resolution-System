package org.egov.config.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.web.model.AuditDetails;
import org.egov.config.web.model.ProviderDetail;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;

@Component
@RequiredArgsConstructor
public class ProviderDetailRowMapper implements RowMapper<ProviderDetail> {

    private final ObjectMapper objectMapper;

    @Override
    public ProviderDetail mapRow(ResultSet rs, int rowNum) throws SQLException {
        return ProviderDetail.builder()
                .id(rs.getString("id"))
                .providerName(rs.getString("provider_name"))
                .channel(rs.getString("channel"))
                .tenantId(rs.getString("tenant_id"))
                .enabled(rs.getBoolean("enabled"))
                .value(parseJson(rs.getString("value")))
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
