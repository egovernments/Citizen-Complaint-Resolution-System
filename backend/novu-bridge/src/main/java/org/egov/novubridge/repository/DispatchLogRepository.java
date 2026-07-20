package org.egov.novubridge.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

        // Idempotency key is (transaction_id, channel, recipient_value) — PGR emits
        // one event per recipient x channel with a stable transactionId, so Kafka
        // redelivery upserts the same row instead of duplicating a send.
        String sql = "INSERT INTO nb_dispatch_log(id, event_id, transaction_id, reference_number, module, event_name, tenant_id, channel, recipient_value, " +
                "template_key, template_version, status, attempt_count, last_error_code, last_error_message, provider_response_jsonb, " +
                "created_time, last_modified_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?) " +
                "ON CONFLICT (transaction_id, channel, recipient_value) DO UPDATE SET status=EXCLUDED.status, attempt_count=EXCLUDED.attempt_count, " +
                "last_error_code=EXCLUDED.last_error_code, last_error_message=EXCLUDED.last_error_message, " +
                "provider_response_jsonb=EXCLUDED.provider_response_jsonb, last_modified_time=EXCLUDED.last_modified_time";

        try {
            jdbcTemplate.update(sql,
                    entry.getId() != null ? entry.getId() : UUID.randomUUID(),
                    entry.getEventId(),
                    entry.getTransactionId(),
                    entry.getReferenceNumber(),
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

    /**
     * List dispatch log rows for a tenant with optional, parameterized filters,
     * ordered newest-first. tenantId is mandatory (the caller enforces it); every
     * other predicate is appended only when supplied and always via bind
     * parameters — no value is concatenated into the SQL, so this is injection-safe.
     *
     * <p>Observability: every event consumed from the domain topic lands here with
     * an explicit terminal status — SENT, SKIPPED (preference denied / no provider /
     * unsupported channel) or FAILED. Channels without an enabled provider (e.g.
     * WHATSAPP before a legitimate provider is onboarded) appear as
     * SKIPPED/NB_NO_PROVIDER rather than being invisible.
     *
     * @param referenceNumber when {@code referenceNumberPrefix} is true, matches
     *                        rows whose reference_number starts with this value;
     *                        otherwise an exact match.
     */
    public List<DispatchLogEntry> list(String tenantId, String referenceNumber, boolean referenceNumberPrefix,
                                       String transactionId, String channel, String status,
                                       int limit, int offset) {
        StringBuilder sql = new StringBuilder(
                "SELECT id, event_id, transaction_id, reference_number, module, event_name, tenant_id, channel, " +
                        "recipient_value, template_key, template_version, status, attempt_count, last_error_code, " +
                        "last_error_message, provider_response_jsonb, created_time, last_modified_time " +
                        "FROM nb_dispatch_log WHERE tenant_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        appendFilters(sql, args, referenceNumber, referenceNumberPrefix, transactionId, channel, status);
        sql.append(" ORDER BY created_time DESC, last_modified_time DESC LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbcTemplate.query(sql.toString(), rowMapper(), args.toArray());
    }

    /**
     * COUNT of dispatch log rows matching the same tenant + filters as
     * {@link #list}, so a caller can page without re-scanning. Parameterized;
     * see {@link #list} for the observability-boundary caveat.
     */
    public long count(String tenantId, String referenceNumber, boolean referenceNumberPrefix,
                      String transactionId, String channel, String status) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM nb_dispatch_log WHERE tenant_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        appendFilters(sql, args, referenceNumber, referenceNumberPrefix, transactionId, channel, status);
        Long total = jdbcTemplate.queryForObject(sql.toString(), Long.class, args.toArray());
        return total != null ? total : 0L;
    }

    private void appendFilters(StringBuilder sql, List<Object> args, String referenceNumber,
                               boolean referenceNumberPrefix, String transactionId, String channel, String status) {
        if (StringUtils.hasText(referenceNumber)) {
            if (referenceNumberPrefix) {
                sql.append(" AND reference_number LIKE ?");
                args.add(referenceNumber + "%");
            } else {
                sql.append(" AND reference_number = ?");
                args.add(referenceNumber);
            }
        }
        if (StringUtils.hasText(transactionId)) {
            sql.append(" AND transaction_id = ?");
            args.add(transactionId);
        }
        if (StringUtils.hasText(channel)) {
            sql.append(" AND channel = ?");
            args.add(channel);
        }
        if (StringUtils.hasText(status)) {
            sql.append(" AND status = ?");
            args.add(status);
        }
    }

    private RowMapper<DispatchLogEntry> rowMapper() {
        return (rs, rowNum) -> {
            Map<String, Object> providerResponse = null;
            String raw = rs.getString("provider_response_jsonb");
            if (StringUtils.hasText(raw)) {
                try {
                    providerResponse = mapper.readValue(raw, new TypeReference<Map<String, Object>>() {});
                } catch (Exception e) {
                    log.warn("Failed to parse provider_response_jsonb for txn={}: {}",
                            rs.getString("transaction_id"), e.getMessage());
                }
            }
            String idStr = rs.getString("id");
            return DispatchLogEntry.builder()
                    .id(idStr != null ? UUID.fromString(idStr) : null)
                    .eventId(rs.getString("event_id"))
                    .transactionId(rs.getString("transaction_id"))
                    .referenceNumber(rs.getString("reference_number"))
                    .module(rs.getString("module"))
                    .eventName(rs.getString("event_name"))
                    .tenantId(rs.getString("tenant_id"))
                    .channel(rs.getString("channel"))
                    .recipientValue(rs.getString("recipient_value"))
                    .templateKey(rs.getString("template_key"))
                    .templateVersion(rs.getString("template_version"))
                    .status(rs.getString("status"))
                    .attemptCount((Integer) rs.getObject("attempt_count"))
                    .lastErrorCode(rs.getString("last_error_code"))
                    .lastErrorMessage(rs.getString("last_error_message"))
                    .providerResponse(providerResponse)
                    .createdTime((Long) rs.getObject("created_time"))
                    .lastModifiedTime((Long) rs.getObject("last_modified_time"))
                    .build();
        };
    }
}
