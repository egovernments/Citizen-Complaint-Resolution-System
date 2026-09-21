package org.egov.novubridge.service.thin;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The seam, exercised as the resolution stage will use it: a hand-written {@link ThinEventHandler}
 * replaces the default, and everything upstream of it — the consumer, the validator, the pipeline
 * — is unchanged.
 *
 * <p>This is the test that says the handoff is real rather than aspirational. It also pins the
 * three parts of the handler contract that are easy to get wrong when the resolution stage lands:
 * the handler sees a <b>validated</b> event, a <b>configuration decision is not an exception</b>,
 * and a <b>genuine failure is</b> and reaches the consumer to be DLQ'd.
 */
class ThinEventHandlerSeamTest {

    /** The kind of handler T3 will write, reduced to the part this test needs. */
    private static final class RecordingHandler implements ThinEventHandler {
        private final List<ThinEvent> seen = new ArrayList<>();
        private final RuntimeException toThrow;

        RecordingHandler(RuntimeException toThrow) {
            this.toThrow = toThrow;
        }

        @Override
        public ThinEventResult handle(ThinEvent event) {
            seen.add(event);
            if (toThrow != null) {
                throw toThrow;
            }
            return ThinEventResult.builder()
                    .terminalCode("NB_NO_ROUTING")
                    .diagnostics(List.of("no routing row for " + event.getEventName()))
                    .build();
        }
    }

    private static ThinEvent valid() {
        return validBuilder().build();
    }

    private static ThinEvent.ThinEventBuilder validBuilder() {
        return ThinEvent.builder()
                .kind("THIN")
                .eventId("evt-thin-1")
                .eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .module("Complaints")
                .eventName("COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION")
                .entityId("PGR-001")
                .tenantId("ke.bomet");
    }

    private static ThinEventPipelineService pipelineWith(ThinEventHandler handler,
                                                         DispatchLogRepository repository) {
        return new ThinEventPipelineService(
                new ThinEventValidator(new EnvelopeValidator()), handler, repository);
    }

    @Test
    @DisplayName("a replacement handler receives the event and its result is returned verbatim")
    void aReplacementHandlerTakesOver() {
        DispatchLogRepository repository = mock(DispatchLogRepository.class);
        RecordingHandler handler = new RecordingHandler(null);

        ThinEventResult result = pipelineWith(handler, repository).process(valid());

        assertEquals(1, handler.seen.size());
        assertEquals("COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION", handler.seen.get(0).getEventName());
        assertEquals("NB_NO_ROUTING", result.getTerminalCode());
        assertEquals(List.of("no routing row for COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION"),
                result.getDiagnostics());
    }

    @Test
    @DisplayName("the handler owns its ledger rows — the pipeline writes none on its behalf")
    void thePipelineWritesNothingForTheHandler() {
        // The caller cannot write them and must not try: only the handler knows which channel and
        // which recipient each outcome belonged to. A pipeline that "helpfully" wrote a row here
        // would double-count every resolved message.
        DispatchLogRepository repository = mock(DispatchLogRepository.class);

        pipelineWith(new RecordingHandler(null), repository).process(valid());

        verifyNoInteractions(repository);
    }

    @Test
    @DisplayName("a handler that throws is not swallowed — the exception reaches the caller to be DLQ'd")
    void aHandlerFailurePropagates() {
        DispatchLogRepository repository = mock(DispatchLogRepository.class);
        CustomException boom = new CustomException("NB_EVENT_NOT_IN_CATALOGUE", "no catalogue row");

        CustomException thrown = assertThrows(CustomException.class,
                () -> pipelineWith(new RecordingHandler(boom), repository).process(valid()));

        assertEquals("NB_EVENT_NOT_IN_CATALOGUE", thrown.getCode());
    }

    @Test
    @DisplayName("the handler is never reached by an invalid event — validation is the pipeline's job, not its")
    void aHandlerNeverSeesAnInvalidEvent() {
        DispatchLogRepository repository = mock(DispatchLogRepository.class);
        RecordingHandler handler = new RecordingHandler(null);

        assertThrows(CustomException.class, () ->
                pipelineWith(handler, repository).process(validBuilder().tenantId(null).build()));

        assertTrue(handler.seen.isEmpty(),
                "an implementation may rely on the required fields being present; that is the "
                        + "contract, and it has to hold");
    }
}
