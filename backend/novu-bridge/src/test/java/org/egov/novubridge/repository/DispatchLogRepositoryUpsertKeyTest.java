package org.egov.novubridge.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

/**
 * NB-3 (item 3): pins the {@code nb_dispatch_log} upsert idempotency key to the
 * extended {@code (transaction_id, channel, recipient_value)} conflict target
 * introduced by migration {@code V20260701000000__extend_dispatch_unique_key.sql}.
 * A regression to the old {@code (event_id, channel)} key (or dropping the
 * recipient_value column from the conflict target) would let two recipients on
 * the same channel overwrite each other's dispatch row.
 *
 * <p>Also verifies the {@code dispatchLogEnabled=false} guard short-circuits before
 * any SQL is issued.
 *
 * <p>Implementation note: the SQL string + bind parameters are read straight off
 * the recorded {@link JdbcTemplate#update(String, Object...)} invocation via
 * {@code mockingDetails(...).getInvocations()} — matcher-free, so it is immune to
 * Mockito's varargs matcher-cardinality quirks.
 */
class DispatchLogRepositoryUpsertKeyTest {

    private JdbcTemplate jdbcTemplate;
    private NovuBridgeConfiguration config;
    private DispatchLogRepository repository;

    @BeforeEach
    void setUp() {
        jdbcTemplate = mock(JdbcTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setDispatchLogEnabled(true);
        repository = new DispatchLogRepository(jdbcTemplate, new ObjectMapper(), config);
    }

    private DispatchLogEntry entry() {
        return DispatchLogEntry.builder()
                .eventId("evt-1")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .referenceNumber("PGR-001")
                .module("Complaints")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN")
                .tenantId("ke.bomet")
                .channel("SMS")
                .recipientValue("ke.bomet:uuid-123")
                .status("SENT")
                .attemptCount(1)
                .providerResponse(Map.of("acknowledged", true))
                .createdTime(1_000L)
                .lastModifiedTime(1_000L)
                .build();
    }

    /** Return the recorded {@code update(...)} invocation, or null if none happened. */
    private Invocation updateInvocation() {
        return mockingDetails(jdbcTemplate).getInvocations().stream()
                .filter(i -> "update".equals(i.getMethod().getName()))
                .findFirst()
                .orElse(null);
    }

    /** Flatten the update() invocation args to [sql, bind0, bind1, ...] regardless of varargs shape. */
    private List<Object> flatArgs(Invocation inv) {
        List<Object> flat = new ArrayList<>();
        for (Object a : inv.getArguments()) {
            if (a instanceof Object[]) {
                for (Object e : (Object[]) a) {
                    flat.add(e);
                }
            } else {
                flat.add(a);
            }
        }
        return flat;
    }

    @Test
    void upsertSql_usesExtendedConflictKey_andBindsRecipientValue() {
        repository.upsert(entry());

        Invocation inv = updateInvocation();
        assertNotNull(inv, "jdbcTemplate.update was not invoked");

        List<Object> flat = flatArgs(inv);
        String sql = (String) flat.get(0);
        assertTrue(sql.contains("ON CONFLICT (transaction_id, channel, recipient_value) DO UPDATE"),
                "upsert must key on the extended (transaction_id, channel, recipient_value) target; got:\n" + sql);
        assertTrue(sql.contains("INSERT INTO nb_dispatch_log"), "must be an INSERT ... ON CONFLICT upsert");

        List<Object> binds = flat.subList(1, flat.size());
        assertTrue(binds.contains("ke.bomet:uuid-123"),
                "recipient_value bind parameter must carry the entry's recipientValue; binds=" + binds);
        assertTrue(binds.contains("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS"),
                "transaction_id bind parameter must carry the entry's transactionId; binds=" + binds);
        assertTrue(binds.contains("SMS"), "channel bind parameter must carry the entry's channel; binds=" + binds);
    }

    @Test
    void upsertDisabled_issuesNoSql() {
        config.setDispatchLogEnabled(false);
        repository.upsert(entry());
        assertEquals(null, updateInvocation(), "no SQL must be issued when dispatch logging is disabled");
    }
}
