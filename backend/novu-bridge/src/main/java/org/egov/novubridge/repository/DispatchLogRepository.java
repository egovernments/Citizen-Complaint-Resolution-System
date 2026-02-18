package org.egov.novubridge.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
@Slf4j
public class DispatchLogRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper mapper;
    private final NovuBridgeConfiguration config;

    public DispatchLogRepository(JdbcTemplate jdbcTemplate, ObjectMapper mapper, NovuBridgeConfiguration config) {
        this.jdbcTemplate = jdbcTemplate;
        this.mapper = mapper;
        this.config = config;
    }

    public void upsert(DispatchLogEntry entry) {
        if (Boolean.FALSE.equals(config.getDispatchLogEnabled())) {
            return;
        }

        String sql = "INSERT INTO nb_dispatch_log(id, event_id, module, event_name, tenant_id, channel, recipient_value, " +
                "template_key, template_version, status, attempt_count, last_error_code, last_error_message, provider_response_jsonb, " +
                "created_time, last_modified_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?) " +
                "ON CONFLICT (event_id, channel) DO UPDATE SET status=EXCLUDED.status, attempt_count=EXCLUDED.attempt_count, " +
                "last_error_code=EXCLUDED.last_error_code, last_error_message=EXCLUDED.last_error_message, " +
                "provider_response_jsonb=EXCLUDED.provider_response_jsonb, last_modified_time=EXCLUDED.last_modified_time";

        try {
            jdbcTemplate.update(sql,
                    entry.getId() != null ? entry.getId() : UUID.randomUUID(),
                    entry.getEventId(),
                    entry.getModule(),
                    entry.getEventName(),
                    entry.getTenantId(),
                    entry.getChannel(),
                    entry.getRecipientValue(),
                    entry.getTemplateKey(),
                    entry.getTemplateVersion(),
                    entry.getStatus(),
                    entry.getAttemptCount(),
                    entry.getLastErrorCode(),
                    entry.getLastErrorMessage(),
                    mapper.writeValueAsString(entry.getProviderResponse()),
                    entry.getCreatedTime(),
                    entry.getLastModifiedTime());
        } catch (JsonProcessingException e) {
            log.error("Failed serializing provider response for eventId={}", entry.getEventId(), e);
        } catch (Exception e) {
            log.error("Failed to upsert dispatch log for eventId={}", entry.getEventId(), e);
        }
    }
}
