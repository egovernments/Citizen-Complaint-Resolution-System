package org.egov.novubridge.service.thin;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.repository.DispatchLogRows;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;

/**
 * The thin-event counterpart of {@code DispatchPipelineService}: validate, write the rejection
 * down if it fails, otherwise hand the event to the {@link ThinEventHandler}.
 *
 * <p>Deliberately a separate class rather than a branch inside the pre-rendered pipeline. That
 * pipeline is a public interface's implementation — CORE-SMS and any external producer depend on
 * it byte for byte — and the surest way to keep it unchanged is not to open it. Nothing here
 * touches it, and the two paths meet only downstream, where the resolution stage hands it
 * finished envelopes exactly as a producer would.
 *
 * <p><b>A rejection is persisted before it is thrown</b>, the same rule the envelope path has
 * kept since rejections stopped disappearing into the DLQ. The row is channel-less — a thin event
 * refused at validation never reached a channel, and inventing {@code UNKNOWN} for one would put
 * a value in the column that means nothing. The consumer still DLQs the event afterwards, so the
 * payload survives and the operator sees the refusal on the Logs screen.
 */
@Service
@Slf4j
public class ThinEventPipelineService {

    private final ThinEventValidator validator;
    private final ThinEventHandler handler;
    private final DispatchLogRepository dispatchLogRepository;

    public ThinEventPipelineService(ThinEventValidator validator,
                                    ThinEventHandler handler,
                                    DispatchLogRepository dispatchLogRepository) {
        this.validator = validator;
        this.handler = handler;
        this.dispatchLogRepository = dispatchLogRepository;
    }

    public ThinEventResult process(ThinEvent event) {
        log.info("Processing thin domain event: eventId={}, eventName={}, module={}, tenant={}",
                event == null ? null : event.getEventId(),
                event == null ? null : event.getEventName(),
                event == null ? null : event.getModule(),
                event == null ? null : event.getTenantId());

        try {
            validator.validate(event);
        } catch (CustomException ce) {
            persistRejected(event, ce.getCode(), ce.getMessage());
            throw ce;
        }

        return handler.handle(event);
    }

    /**
     * A {@code REJECTED} channel-less row for an event that failed validation. Every NOT NULL
     * column gets an honest fallback so even a malformed event is written down; nothing is
     * invented beyond the literal {@code unknown} markers, which is the same bargain
     * {@code DispatchPipelineService.persistRejected} makes.
     */
    private void persistRejected(ThinEvent event, String errorCode, String errorMessage) {
        String eventId = firstNonBlank(event == null ? null : event.getEventId(), "unknown");
        String seed = event == null ? null : event.resolvedTransactionSeed();
        dispatchLogRepository.upsert(DispatchLogRows.channelLess(firstNonBlank(seed, eventId))
                .eventId(eventId)
                .referenceNumber(firstNonBlank(event == null ? null : event.getEntityId(), eventId))
                .module(firstNonBlank(event == null ? null : event.getModule(), "unknown"))
                .eventName(firstNonBlank(event == null ? null : event.getEventName(), "unknown"))
                .tenantId(firstNonBlank(event == null ? null : event.getTenantId(), "unknown"))
                .status("REJECTED")
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .build());
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }
}
