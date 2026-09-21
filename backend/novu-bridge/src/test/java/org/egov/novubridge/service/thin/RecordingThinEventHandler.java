package org.egov.novubridge.service.thin;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.repository.DispatchLogRows;
import org.egov.novubridge.web.models.ThinEvent;

import java.util.List;

/**
 * A minimal {@link ThinEventHandler} for the tests that are about {@code ThinEventPipelineService}
 * and {@code DomainEventConsumer} rather than about resolution: it writes the one channel-less row
 * the seam contract obliges every handler to write, and says which code it wrote.
 *
 * <p>It exists so those tests keep exercising the seam without dragging the whole resolution
 * stage — config repository, four SPIs, dispatch pipeline — into a test whose subject is
 * "does a valid thin event reach its handler and does an invalid one get written down first".
 * The real handler is {@code NotificationResolver}, and it has its own tests and a golden-master
 * parity test.
 */
public final class RecordingThinEventHandler implements ThinEventHandler {

    /** A real terminal code, so nothing here can drift away from the published catalogue. */
    public static final String CODE = ThinEventErrorCodes.NO_ROUTING;

    private final DispatchLogRepository repository;
    private ThinEvent lastEvent;

    public RecordingThinEventHandler(DispatchLogRepository repository) {
        this.repository = repository;
    }

    /** The event the pipeline handed over, or null when it never got that far. */
    public ThinEvent lastEvent() {
        return lastEvent;
    }

    @Override
    public ThinEventResult handle(ThinEvent event) {
        lastEvent = event;
        String message = "no routing rows for " + event.getEventName();
        repository.upsert(DispatchLogRows.channelLess(event.resolvedTransactionSeed())
                .eventId(event.getEventId())
                .referenceNumber(event.getEntityId() != null && !event.getEntityId().isBlank()
                        ? event.getEntityId() : event.getEventId())
                .module(event.getModule())
                .eventName(event.getEventName())
                .tenantId(event.getTenantId())
                .templateKey(event.getEventName())
                .status("SKIPPED")
                .lastErrorCode(CODE)
                .lastErrorMessage(message)
                .build());
        return ThinEventResult.builder().terminalCode(CODE).diagnostics(List.of(message)).build();
    }
}
