package org.egov.novubridge.service.thin;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.repository.DispatchLogRows;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;

import static org.springframework.util.StringUtils.hasText;

/**
 * Validate a thin event, then hand it to the {@link ThinEventHandler}. Kept apart from the
 * pre-rendered pipeline so that public path is never opened. A rejection is persisted as a
 * channel-less REJECTED row before it is rethrown for the consumer to DLQ.
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

    public void process(ThinEvent event) {
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
        handler.handle(event);
    }

    /** Every NOT NULL column gets an honest fallback so even a malformed event is written down. */
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

    private static String firstNonBlank(String value, String fallback) {
        return hasText(value) ? value.trim() : fallback;
    }
}
