package org.egov.config.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.config.web.model.AuditDetails;
import org.egov.config.web.model.ProviderDetail;
import org.egov.config.web.model.TemplateBinding;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Component
@RequiredArgsConstructor
public class TemplateBindingRowMapper implements RowMapper<TemplateBinding> {

    private final ObjectMapper objectMapper;

    @Override
    public TemplateBinding mapRow(ResultSet rs, int rowNum) throws SQLException {
        TemplateBinding.TemplateBindingBuilder builder = TemplateBinding.builder()
                .id(rs.getString("tb_id"))
                .templateId(rs.getString("tb_template_id"))
                .providerId(rs.getString("tb_provider_id"))
                .eventName(rs.getString("tb_event_name"))
                .contentSid(rs.getString("tb_content_sid"))
                .locale(rs.getString("tb_locale"))
                .tenantId(rs.getString("tb_tenant_id"))
                .enabled(rs.getBoolean("tb_enabled"))
                .paramOrder(parseJsonList(rs.getString("tb_param_order")))
                .requiredVars(parseJsonList(rs.getString("tb_required_vars")))
                .auditDetails(AuditDetails.builder()
                        .createdBy(rs.getString("tb_created_by"))
                        .createdTime(rs.getLong("tb_created_time"))
                        .lastModifiedBy(rs.getString("tb_last_modified_by"))
                        .lastModifiedTime(rs.getLong("tb_last_modified_time"))
                        .build());

        // If joined with provider_detail
        String pdId = rs.getString("pd_id");
        if (pdId != null) {
            builder.providerDetail(ProviderDetail.builder()
                    .id(pdId)
                    .providerName(rs.getString("pd_provider_name"))
                    .channel(rs.getString("pd_channel"))
                    .tenantId(rs.getString("pd_tenant_id"))
                    .enabled(rs.getBoolean("pd_enabled"))
                    .value(parseJson(rs.getString("pd_value")))
                    .auditDetails(AuditDetails.builder()
                            .createdBy(rs.getString("pd_created_by"))
                            .createdTime(rs.getLong("pd_created_time"))
                            .lastModifiedBy(rs.getString("pd_last_modified_by"))
                            .lastModifiedTime(rs.getLong("pd_last_modified_time"))
                            .build())
                    .build());
        }

        return builder.build();
    }

    private JsonNode parseJson(String json) {
        if (json == null) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse JSON from database", e);
        }
    }

    @SuppressWarnings("unchecked")
    private List<String> parseJsonList(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readValue(json, List.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse JSON list from database", e);
        }
    }
}
