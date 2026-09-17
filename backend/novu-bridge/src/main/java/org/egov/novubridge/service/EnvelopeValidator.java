package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Locale;

/**
 * The inbound contract, stated rather than sniffed. An event is accepted only if it
 * <ol>
 *   <li>carries a known {@code eventType} ({@code novu.bridge.event.types}),</li>
 *   <li>is schema version {@value #SCHEMA_VERSION} (or omits the version),</li>
 *   <li>has the identity fields, and</li>
 *   <li>is a complete pre-rendered message: channel + subscriberId + renderedBody.</li>
 * </ol>
 * Anything else is rejected with a specific code; the pipeline writes the rejection down
 * before the consumer DLQs it.
 */
@Service
public class EnvelopeValidator {

    public static final String SCHEMA_VERSION = "1";
    public static final List<String> DEFAULT_EVENT_TYPES = List.of("COMPLAINTS_WORKFLOW_TRANSITIONED", "OTP");

    private final List<String> acceptedEventTypes;

    /** Accepts the default producer types; used by tests and as a fallback. */
    public EnvelopeValidator() {
        this.acceptedEventTypes = DEFAULT_EVENT_TYPES;
    }

    @Autowired
    public EnvelopeValidator(NovuBridgeConfiguration config) {
        List<String> configured = config.getEventTypes();
        this.acceptedEventTypes = configured == null || configured.isEmpty() ? DEFAULT_EVENT_TYPES : configured;
    }

    public void validate(ComplaintsDomainEvent event) {
        if (event == null) {
            throw new CustomException("NB_INVALID_EVENT", "Event payload is required");
        }
        if (StringUtils.hasText(event.getSchemaVersion()) && !SCHEMA_VERSION.equals(event.getSchemaVersion().trim())) {
            throw new CustomException("NB_UNSUPPORTED_SCHEMA_VERSION",
                    "schemaVersion " + event.getSchemaVersion() + " is not supported (expected " + SCHEMA_VERSION + ")");
        }
        require(event.getEventId(), "eventId");
        require(event.getEventType(), "eventType");
        require(event.getEventName(), "eventName");
        require(event.getTenantId(), "tenantId");
        if (!isAccepted(event.getEventType())) {
            throw new CustomException("NB_UNSUPPORTED_EVENT_TYPE",
                    "eventType " + event.getEventType() + " is not one of " + acceptedEventTypes);
        }
        require(event.getChannel(), "channel");
        require(event.getSubscriberId(), "subscriberId");
        require(event.getRenderedBody(), "renderedBody");
    }

    public boolean isAccepted(String eventType) {
        if (!StringUtils.hasText(eventType)) return false;
        String wanted = eventType.trim().toUpperCase(Locale.ROOT);
        return acceptedEventTypes.stream().anyMatch(t -> t.trim().equalsIgnoreCase(wanted));
    }

    private static void require(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new CustomException("NB_INVALID_EVENT", field + " is required");
        }
    }
}
