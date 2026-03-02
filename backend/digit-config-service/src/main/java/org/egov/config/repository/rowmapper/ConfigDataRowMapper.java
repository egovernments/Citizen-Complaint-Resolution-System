package org.egov.config.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.web.model.AuditDetails;
import org.egov.config.web.model.ConfigData;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

@Component
@RequiredArgsConstructor
public class ConfigDataRowMapper implements ResultSetExtractor<List<ConfigData>> {

    private final ObjectMapper objectMapper;

    @Override
    public List<ConfigData> extractData(ResultSet rs) throws SQLException {
        List<ConfigData> list = new ArrayList<>();
        while (rs.next()) {
            JsonNode data = parseJsonData(rs.getObject("data"));

            list.add(ConfigData.builder()
                    .id(rs.getString("id"))
                    .tenantId(rs.getString("tenantid"))
                    .schemaCode(rs.getString("schemacode"))
                    .uniqueIdentifier(rs.getString("uniqueidentifier"))
                    .data(data)
                    .isActive(rs.getBoolean("isactive"))
                    .auditDetails(AuditDetails.builder()
                            .createdBy(rs.getString("createdby"))
                            .createdTime(rs.getLong("createdtime"))
                            .lastModifiedBy(rs.getString("lastmodifiedby"))
                            .lastModifiedTime(rs.getLong("lastmodifiedtime"))
                            .build())
                    .build());
        }
        return list;
    }

    private JsonNode parseJsonData(Object dataObj) throws SQLException {
        try {
            if (dataObj instanceof String) {
                return objectMapper.readTree((String) dataObj);
            }
            // For PostgreSQL PGobject or other types, convert via toString
            if (dataObj != null) {
                return objectMapper.readTree(dataObj.toString());
            }
            return null;
        } catch (Exception e) {
            throw new SQLException("Failed to parse JSON data column", e);
        }
    }
}
