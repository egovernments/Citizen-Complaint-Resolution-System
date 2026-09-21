package org.egov.novubridge.service.thin;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * What a thin event becomes on its way through this build: a row, always, whatever happens.
 *
 * <p>"Every outcome is visible as a row" is the property the whole ledger exists for, and the
 * thin path widens it — it now has to cover decisions taken BEFORE there is a channel or a
 * recipient, which on the old path were a log line inside the producing module and a message
 * nobody knew had been dropped. So these tests read the row, not the return value.
 */
class ThinEventPipelineServiceTest {

    private DispatchLogRepository repository;
    private ThinEventPipelineService pipeline;

    @BeforeEach
    void setUp() {
        repository = mock(DispatchLogRepository.class);
        pipeline = new ThinEventPipelineService(
                new ThinEventValidator(new EnvelopeValidator()),
                new RecordingThinEventHandler(repository),
                repository);
    }

    private static ThinEvent.ThinEventBuilder valid() {
        return ThinEvent.builder()
                .kind("THIN")
                .eventId("evt-thin-1")
                .eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .module("Complaints")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME")
                .entityType("COMPLAINT")
                .entityId("PGR-001")
                .tenantId("ke.bomet")
                .transactionSeed("PGR-001:ASSIGN:PENDINGATLME");
    }

    private DispatchLogEntry theRow() {
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(repository).upsert(captor.capture());
        return captor.getValue();
    }

    // ---- the accepted-but-unresolvable outcome -----------------------------

    @Test
    @DisplayName("a valid thin event reaches the handler, which records the outcome — never dropped, never thrown")
    void aValidThinEventReachesTheHandler() {
        ThinEventResult result = pipeline.process(valid().build());

        DispatchLogEntry row = theRow();
        assertEquals("SKIPPED", row.getStatus(),
                "nothing is wrong with the message; the handler decided there was nothing to send");
        assertEquals(RecordingThinEventHandler.CODE, row.getLastErrorCode());
        assertEquals(RecordingThinEventHandler.CODE, result.getTerminalCode());
        assertTrue(result.getDispatches().isEmpty());
        assertNotNull(row.getLastErrorMessage(), "the row must say why, not only that");
    }

    @Test
    @DisplayName("a handler's channel-less row is shaped so the ledger's unique key still holds")
    void theChannelLessRowKeepsTheLedgerKey() {
        pipeline.process(valid().build());

        DispatchLogEntry row = theRow();
        assertEquals("NONE", row.getChannel(), "there was never a channel — inventing one would lie");
        assertEquals("none", row.getRecipientValue());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:NONE", row.getTransactionId(),
                "appending the pseudo-channel is what keeps (transaction_id, channel, recipient_value) "
                        + "unique, so a redelivery upserts this row instead of duplicating it");
        assertEquals("RESOLVED", row.getSourcePath(),
                "a row born of a thin event must not claim to be pre-rendered");
    }

    @Test
    @DisplayName("the row carries the event's own identity, so an operator can find it")
    void theChannelLessRowCarriesTheEventIdentity() {
        pipeline.process(valid().build());

        DispatchLogEntry row = theRow();
        assertEquals("evt-thin-1", row.getEventId());
        assertEquals("PGR-001", row.getReferenceNumber(), "entityId is how you find one case's rows");
        assertEquals("Complaints", row.getModule());
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME", row.getEventName());
        assertEquals("ke.bomet", row.getTenantId());
        assertEquals(1, row.getAttemptCount());
        assertEquals(Boolean.FALSE, row.getIsTest());
    }

    // ---- idempotency seed derivation ---------------------------------------

    @Test
    @DisplayName("no transactionSeed: the box derives entityId:eventName, and failing that the eventId")
    void theSeedIsDerivedWhenAbsent() {
        assertEquals("PGR-001:COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
                valid().transactionSeed(null).build().resolvedTransactionSeed());
        assertEquals("evt-thin-1",
                valid().transactionSeed(null).entityId(null).build().resolvedTransactionSeed());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME", valid().build().resolvedTransactionSeed());
    }

    @Test
    @DisplayName("with no entityId the row's reference falls back to the eventId — never to nothing")
    void referenceFallsBackToTheEventId() {
        pipeline.process(valid().entityId(null).build());
        assertEquals("evt-thin-1", theRow().getReferenceNumber());
    }

    // ---- rejections --------------------------------------------------------

    @Test
    @DisplayName("a missing required field: REJECTED row FIRST, then the throw the consumer DLQs")
    void aMissingFieldIsWrittenDownBeforeItIsThrown() {
        CustomException thrown = assertThrows(CustomException.class,
                () -> pipeline.process(valid().module(null).build()));

        assertEquals("NB_INVALID_THIN_EVENT", thrown.getCode());
        DispatchLogEntry row = theRow();
        assertEquals("REJECTED", row.getStatus());
        assertEquals("NB_INVALID_THIN_EVENT", row.getLastErrorCode());
        assertEquals("NONE", row.getChannel());
        assertEquals("unknown", row.getModule(), "a NOT NULL column gets an honest marker, not an invention");
        assertTrue(row.getLastErrorMessage().contains("module"), "the message must name the field");
    }

    @Test
    @DisplayName("an eventType off the allowlist is REJECTED and thrown — the failure is loud by design")
    void anUnallowedEventTypeIsRejectedLoudly() {
        // There is no flag that turns the thin path on, so the one thing that must never happen
        // is a quiet refusal: a mis-provisioned deployment has to look like a screen full of red
        // rows, not like silence. #1969 is what silence costs.
        CustomException thrown = assertThrows(CustomException.class,
                () -> pipeline.process(valid().eventType("SOMEBODY_ELSES_EVENT").build()));

        assertEquals("NB_UNSUPPORTED_EVENT_TYPE", thrown.getCode());
        DispatchLogEntry row = theRow();
        assertEquals("REJECTED", row.getStatus());
        assertEquals("NB_UNSUPPORTED_EVENT_TYPE", row.getLastErrorCode());
        assertEquals("evt-thin-1", row.getEventId());
        assertEquals("RESOLVED", row.getSourcePath());
    }

    @Test
    @DisplayName("an allowlist the deployment DID configure accepts the event")
    void aConfiguredAllowlistAcceptsIt() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setEventTypes(List.of("XYZ_LICENCE_EVENT"));
        ThinEventPipelineService configured = new ThinEventPipelineService(
                new ThinEventValidator(new EnvelopeValidator(config)),
                new RecordingThinEventHandler(repository),
                repository);

        configured.process(valid().eventType("xyz_licence_event").module("XYZ").build());

        assertEquals("SKIPPED", theRow().getStatus(), "the allowlist match is case-insensitive, as on the envelope path");
    }

    @Test
    @DisplayName("schemaVersion 2 is REJECTED with the code error-codes.md names")
    void anUnsupportedSchemaVersionIsRejected() {
        CustomException thrown = assertThrows(CustomException.class,
                () -> pipeline.process(valid().schemaVersion("2").build()));

        assertEquals("NB_UNSUPPORTED_SCHEMA_VERSION", thrown.getCode());
        assertEquals("REJECTED", theRow().getStatus());
    }

    @Test
    @DisplayName("a null payload is refused, and the refusal is still written down")
    void aNullPayloadIsRefusedAndRecorded() {
        CustomException thrown = assertThrows(CustomException.class, () -> pipeline.process(null));

        assertEquals("NB_INVALID_THIN_EVENT", thrown.getCode());
        DispatchLogEntry row = theRow();
        assertEquals("REJECTED", row.getStatus());
        assertEquals("unknown", row.getEventId());
        assertEquals("unknown:NONE", row.getTransactionId());
    }
}
