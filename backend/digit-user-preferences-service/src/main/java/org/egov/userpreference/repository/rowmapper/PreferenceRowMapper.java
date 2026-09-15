package org.egov.userpreference.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.userpreference.web.model.AuditDetails;
import org.egov.userpreference.web.model.Preference;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;

@Component
@RequiredArgsConstructor
public class PreferenceRowMapper implements RowMapper<Preference> {

    private final ObjectMapper objectMapper;

    @Override
    public Preference mapRow(ResultSet rs, int rowNum) throws SQLException {
        return Preference.builder()
                .id(rs.getString("id"))
                .userId(rs.getString("user_id"))
                .tenantId(rs.getString("tenant_id"))
                .preferenceCode(rs.getString("preference_code"))
                .payload(parsePayload(rs.getObject("payload")))
                .auditDetails(AuditDetails.builder()
                        .createdBy(rs.getString("created_by"))
                        .createdTime(rs.getLong("created_time"))
                        .lastModifiedBy(rs.getString("last_modified_by"))
                        .lastModifiedTime(rs.getLong("last_modified_time"))
                        .build())
                .build();
    }

    /**
     * The driver hands back a {@code String} on H2 and a {@code PGobject} on
     * PostgreSQL, so the column is read as an {@code Object} and its textual
     * form re-parsed. {@code null} is preserved rather than coerced to an
     * empty document.
     */
    private JsonNode parsePayload(Object payload) throws SQLException {
        if (payload == null) {
            return null;
        }
        try {
            return objectMapper.readTree(payload.toString());
        } catch (Exception e) {
            throw new SQLException("Failed to parse payload column as JSON", e);
        }
    }
}
