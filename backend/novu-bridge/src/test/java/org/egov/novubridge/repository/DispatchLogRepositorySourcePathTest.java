package org.egov.novubridge.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

/**
 * {@code nb_dispatch_log.source_path} — which inbound kind produced each row — and the
 * channel-less row shape that only the thin path writes.
 *
 * <p>Two properties, and the first one is the load-bearing one:
 *
 * <ol>
 *   <li><b>A row with no path set is written {@code PRERENDERED}, not NULL.</b> The pre-rendered
 *       pipeline predates the column and was deliberately not edited to say what it has always
 *       been — so the default has to live in the repository. It cannot live only in the column's
 *       SQL default either: an explicit NULL bind beats a column default and would fail the NOT
 *       NULL. If this ever regressed, every v1 row would either crash the insert or arrive with
 *       an unreadable path, and "which path is this deployment on" would stop being answerable.</li>
 *   <li><b>A channel-less row is a real, keyable row.</b> {@code channel = NONE},
 *       {@code recipient_value = none}, {@code transaction_id = <seed>:NONE} — which is what
 *       keeps the unique key {@code (transaction_id, channel, recipient_value)} intact for a
 *       decision taken before any channel existed.</li>
 * </ol>
 *
 * <p>Implementation note, as in {@code DispatchLogRepositoryUpsertKeyTest}: the SQL and its bind
 * parameters are read straight off the recorded {@link JdbcTemplate#update(String, Object...)}
 * invocation, matcher-free, so this is immune to Mockito's varargs quirks.
 */
class DispatchLogRepositorySourcePathTest {

    private JdbcTemplate jdbcTemplate;
    private DispatchLogRepository repository;

    @BeforeEach
    void setUp() {
        jdbcTemplate = mock(JdbcTemplate.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDispatchLogEnabled(true);
        repository = new DispatchLogRepository(jdbcTemplate, new ObjectMapper(), config);
    }

    private static DispatchLogEntry.DispatchLogEntryBuilder prerenderedRow() {
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
                .createdTime(1_000L)
                .lastModifiedTime(1_000L);
    }

    private List<Object> binds() {
        Invocation inv = mockingDetails(jdbcTemplate).getInvocations().stream()
                .filter(i -> "update".equals(i.getMethod().getName()))
                .findFirst()
                .orElse(null);
        assertNotNull(inv, "jdbcTemplate.update was not invoked");
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

    private String sql() {
        return (String) binds().get(0);
    }

    /** {@code source_path} is the last column in the INSERT, so it is the last bind parameter. */
    private Object boundSourcePath() {
        List<Object> binds = binds();
        return binds.get(binds.size() - 1);
    }

    // ---- the default -------------------------------------------------------

    @Test
    @DisplayName("a row that names no path is written PRERENDERED — the whole v1 path relies on this")
    void aPathlessRowIsWrittenPrerendered() {
        repository.upsert(prerenderedRow().build());

        assertEquals("PRERENDERED", boundSourcePath(),
                "an entry with no sourcePath must bind PRERENDERED, never NULL: the pre-rendered "
                        + "pipeline sets no path and its rows must still say what they are, and an "
                        + "explicit NULL bind would beat the column default and fail the NOT NULL");
    }

    @Test
    @DisplayName("a blank path is treated as absent, not written through")
    void aBlankPathFallsBackToPrerendered() {
        repository.upsert(prerenderedRow().sourcePath("   ").build());
        assertEquals("PRERENDERED", boundSourcePath());
    }

    @Test
    @DisplayName("a row that DOES name a path keeps it")
    void anExplicitPathSurvives() {
        repository.upsert(prerenderedRow().sourcePath(DispatchLogEntry.SOURCE_PATH_RESOLVED).build());
        assertEquals("RESOLVED", boundSourcePath());
    }

    @Test
    @DisplayName("source_path is in the INSERT column list and in the conflict-free part of the upsert")
    void sourcePathIsInsertedAndNotOverwrittenOnConflict() {
        repository.upsert(prerenderedRow().build());

        String sql = sql();
        assertTrue(sql.contains("source_path"), "source_path must be written; got:\n" + sql);
        assertTrue(sql.contains("ON CONFLICT (transaction_id, channel, recipient_value) DO UPDATE"),
                "the idempotency key must be untouched by this column; got:\n" + sql);
        // A redelivery of the same message came in on the same path, so there is nothing to
        // update — and a row's origin is not something a later write should be able to rewrite.
        assertFalse(sql.contains("source_path=EXCLUDED.source_path"),
                "a row's inbound path is a fact about how it was created and must not be mutable "
                        + "by a later upsert; got:\n" + sql);
    }

    // ---- channel-less rows -------------------------------------------------

    @Test
    @DisplayName("a channel-less row is a real row: NONE / none / <seed>:NONE, and it keys cleanly")
    void aChannelLessRowIsKeyable() {
        repository.upsert(DispatchLogRows.channelLess("PGR-001:ASSIGN:PENDINGATLME")
                .eventId("evt-thin-1")
                .referenceNumber("PGR-001")
                .module("Complaints")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME")
                .tenantId("ke.bomet")
                .status("SKIPPED")
                .lastErrorCode("NB_NO_ROUTING")
                .lastErrorMessage("no active routing row for this eventName")
                .build());

        List<Object> binds = binds();
        assertTrue(binds.contains("NONE"), "channel must be NONE; binds=" + binds);
        assertTrue(binds.contains("none"), "recipient_value must be none; binds=" + binds);
        assertTrue(binds.contains("PGR-001:ASSIGN:PENDINGATLME:NONE"),
                "transaction_id must append the pseudo-channel so the unique key still holds; binds=" + binds);
        assertTrue(binds.contains("RESOLVED"), "a channel-less row only exists on the thin path; binds=" + binds);
        assertTrue(binds.contains("NB_NO_ROUTING"), "binds=" + binds);
    }

    @Test
    @DisplayName("two channel-less decisions about the same event upsert one row, not two")
    void channelLessRowsDedupeLikeEveryOtherRow() {
        // The key is (transaction_id, channel, recipient_value) and all three are deterministic
        // from the seed, so a Kafka redelivery lands on the same row — the same property the
        // real rows have, for the same reason.
        DispatchLogEntry first = DispatchLogRows.channelLess("PGR-001:ASSIGN:PENDINGATLME")
                .tenantId("ke.bomet").status("SKIPPED").lastErrorCode("NB_NO_ROUTING").build();
        DispatchLogEntry replay = DispatchLogRows.channelLess("PGR-001:ASSIGN:PENDINGATLME")
                .tenantId("ke.bomet").status("SKIPPED").lastErrorCode("NB_NO_ROUTING").build();

        assertEquals(first.getTransactionId(), replay.getTransactionId());
        assertEquals(first.getChannel(), replay.getChannel());
        assertEquals(first.getRecipientValue(), replay.getRecipientValue());
    }

    // ---- the read side -----------------------------------------------------

    @Test
    @DisplayName("source_path is selected and filterable, so an operator can ask the question")
    void sourcePathIsSelectableAndFilterable() {
        repository.list("ke.bomet", null, false, null, null, null, "RESOLVED", false, 50, 0);

        Invocation query = mockingDetails(jdbcTemplate).getInvocations().stream()
                .filter(i -> "query".equals(i.getMethod().getName()))
                .findFirst()
                .orElse(null);
        assertNotNull(query, "jdbcTemplate.query was not invoked");
        String sql = String.valueOf(query.getArguments()[0]);
        assertTrue(sql.contains("source_path"), "the projection must carry source_path; got:\n" + sql);
        assertTrue(sql.contains("AND source_path = ?"),
                "the filter must be a bind parameter, never concatenated; got:\n" + sql);
    }

    @Test
    @DisplayName("no sourcePath filter means no predicate — the default listing shows both paths")
    void anAbsentFilterAddsNoPredicate() {
        repository.list("ke.bomet", null, false, null, null, null, null, false, 50, 0);

        Invocation query = mockingDetails(jdbcTemplate).getInvocations().stream()
                .filter(i -> "query".equals(i.getMethod().getName()))
                .findFirst()
                .orElse(null);
        assertNotNull(query);
        assertFalse(String.valueOf(query.getArguments()[0]).contains("AND source_path = ?"));
    }
}
