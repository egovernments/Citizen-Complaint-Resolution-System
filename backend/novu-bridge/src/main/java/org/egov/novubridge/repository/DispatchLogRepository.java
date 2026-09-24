package org.egov.novubridge.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
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

        // Unique key (transaction_id, channel, recipient_value): a redelivery upserts the same row.
        String sql = "INSERT INTO nb_dispatch_log(id, event_id, transaction_id, reference_number, module, event_name, tenant_id, channel, recipient_value, " +
                "template_key, template_version, status, attempt_count, last_error_code, last_error_message, provider_response_jsonb, " +
                "created_time, last_modified_time, is_test, provider_ref, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?, ?, ?, ?) " +
                "ON CONFLICT (transaction_id, channel, recipient_value) DO UPDATE SET status=EXCLUDED.status, attempt_count=EXCLUDED.attempt_count, " +
                "last_error_code=EXCLUDED.last_error_code, last_error_message=EXCLUDED.last_error_message, " +
                "provider_response_jsonb=EXCLUDED.provider_response_jsonb, last_modified_time=EXCLUDED.last_modified_time, " +
                "provider_ref=COALESCE(EXCLUDED.provider_ref, nb_dispatch_log.provider_ref)";

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
                    entry.getLastModifiedTime(),
                    Boolean.TRUE.equals(entry.getIsTest()),
                    entry.getProviderRef(),
                    sourcePathOf(entry));
        } catch (JsonProcessingException e) {
            log.error("Failed serializing provider response for eventId={}", entry.getEventId(), e);
        } catch (Exception e) {
            log.error("Failed to upsert dispatch log for eventId={}", entry.getEventId(), e);
        }
    }

    /** Defaults to PRERENDERED here: an explicit NULL bind beats the column DEFAULT and fails NOT NULL. */
    private static String sourcePathOf(DispatchLogEntry entry) {
        return StringUtils.hasText(entry.getSourcePath())
                ? entry.getSourcePath()
                : DispatchLogEntry.SOURCE_PATH_PRERENDERED;
    }

    /**
     * Status of the row with this unique key, or null when there is none (or the log is off, or
     * the read failed: a replay guard that cannot see must not block delivery).
     */
    public String findStatus(String transactionId, String channel, String recipientValue) {
        if (Boolean.FALSE.equals(config.getDispatchLogEnabled())
                || transactionId == null || channel == null || recipientValue == null) {
            return null;
        }
        try {
            List<String> rows = jdbcTemplate.queryForList(
                    "SELECT status FROM nb_dispatch_log WHERE transaction_id = ? AND channel = ? AND recipient_value = ?",
                    String.class, transactionId, channel, recipientValue);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (Exception e) {
            log.warn("Dispatch log lookup failed for txn={} channel={}: {}", PiiMask.maskEmbedded(transactionId),
                    channel, e.getMessage());
            return null;
        }
    }

    /**
     * Receipt write-back: move a SENT row to DELIVERED / BOUNCED / FAILED, matched by transaction_id
     * or provider_ref. Only SENT rows move, so a late or duplicate report can never regress a row.
     *
     * @return rows updated (0 = nothing matched or already past SENT)
     */
    public int transition(String transactionId, String providerRef, String newStatus, String errorCode,
                          String errorMessage, Map<String, Object> providerResponse) {
        if (!StringUtils.hasText(transactionId) && !StringUtils.hasText(providerRef)) return 0;
        long now = System.currentTimeMillis();
        StringBuilder sql = new StringBuilder(
                "UPDATE nb_dispatch_log SET status = ?, last_error_code = ?, last_error_message = ?, " +
                "provider_response_jsonb = CAST(? AS JSONB), last_modified_time = ?, " +
                "delivered_time = CASE WHEN ? = 'DELIVERED' THEN ? ELSE delivered_time END WHERE status = 'SENT' AND (");
        List<Object> args = new ArrayList<>();
        args.add(newStatus); args.add(errorCode); args.add(errorMessage);
        String receiptJson = null;
        try {
            receiptJson = providerResponse != null ? mapper.writeValueAsString(providerResponse) : null;
        } catch (JsonProcessingException e) {
            log.warn("Receipt payload not serialisable for txn={} ref={}", PiiMask.maskEmbedded(transactionId), providerRef);
        }
        args.add(receiptJson);
        args.add(now); args.add(newStatus); args.add(now);
        List<String> ors = new ArrayList<>();
        if (StringUtils.hasText(transactionId)) { ors.add("transaction_id = ?"); args.add(transactionId); }
        if (StringUtils.hasText(providerRef)) { ors.add("provider_ref = ?"); args.add(providerRef); }
        sql.append(String.join(" OR ", ors)).append(")");
        try {
            return jdbcTemplate.update(sql.toString(), args.toArray());
        } catch (Exception e) {
            log.error("Failed to apply delivery receipt txn={} ref={}", PiiMask.maskEmbedded(transactionId), providerRef, e);
            return 0;
        }
    }

    /** Newest-first page for a tenant. Every filter is a bind parameter; nothing is concatenated into SQL. */
    public List<DispatchLogEntry> list(String tenantId, String referenceNumber, boolean referenceNumberPrefix,
                                       String transactionId, String channel, String status, String sourcePath,
                                       boolean includeTest, int limit, int offset) {
        StringBuilder sql = new StringBuilder(
                "SELECT id, event_id, transaction_id, reference_number, module, event_name, tenant_id, channel, " +
                        "recipient_value, template_key, template_version, status, attempt_count, last_error_code, " +
                        "last_error_message, provider_response_jsonb, created_time, last_modified_time, is_test, provider_ref, delivered_time, " +
                        "source_path " +
                        "FROM nb_dispatch_log WHERE ");
        List<Object> args = new ArrayList<>();
        appendTenantScope(sql, args, tenantId);
        appendFilters(sql, args, referenceNumber, referenceNumberPrefix, transactionId, channel, status, sourcePath, includeTest);
        sql.append(" ORDER BY created_time DESC, last_modified_time DESC LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbcTemplate.query(sql.toString(), rowMapper(), args.toArray());
    }

    /** COUNT over the same tenant scope and filters as {@link #list}. */
    public long count(String tenantId, String referenceNumber, boolean referenceNumberPrefix,
                      String transactionId, String channel, String status, String sourcePath, boolean includeTest) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM nb_dispatch_log WHERE ");
        List<Object> args = new ArrayList<>();
        appendTenantScope(sql, args, tenantId);
        appendFilters(sql, args, referenceNumber, referenceNumberPrefix, transactionId, channel, status, sourcePath, includeTest);
        Long total = jdbcTemplate.queryForObject(sql.toString(), Long.class, args.toArray());
        return total != null ? total : 0L;
    }

    /** A state tenant ("mz") also sees its cities ("mz.maputo"), where complaints are raised; a city sees only itself. */
    private void appendTenantScope(StringBuilder sql, List<Object> args, String tenantId) {
        if (tenantId.contains(".")) {
            sql.append("tenant_id = ?");
            args.add(tenantId);
            return;
        }
        sql.append("(tenant_id = ? OR tenant_id LIKE ? ESCAPE '\\')");
        args.add(tenantId);
        args.add(tenantId.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + ".%");
    }

    private void appendFilters(StringBuilder sql, List<Object> args, String referenceNumber,
                               boolean referenceNumberPrefix, String transactionId, String channel, String status,
                               String sourcePath, boolean includeTest) {
        if (!includeTest) {
            sql.append(" AND is_test = FALSE");
        }
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
        if (StringUtils.hasText(sourcePath)) {
            sql.append(" AND source_path = ?");
            args.add(sourcePath);
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
                            PiiMask.maskEmbedded(rs.getString("transaction_id")), e.getMessage());
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
                    .isTest(rs.getBoolean("is_test"))
                    .providerRef(rs.getString("provider_ref"))
                    .deliveredTime((Long) rs.getObject("delivered_time"))
                    .sourcePath(rs.getString("source_path"))
                    .build();
        };
    }
}
