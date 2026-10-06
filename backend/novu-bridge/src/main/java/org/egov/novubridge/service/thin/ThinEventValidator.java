package org.egov.novubridge.service.thin;

import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Accepts a thin event only if it declares {@code kind = THIN}, is schema version
 * {@value EnvelopeValidator#SCHEMA_VERSION} (or omits it), has the identity fields, and carries an
 * {@code eventType} on the {@code novu.bridge.event.types} allowlist. No I/O: catalogue and
 * audience checks belong to the resolution stage. The allowlist is shared with
 * {@link EnvelopeValidator} so the two kinds never disagree about accepted producers.
 */
@Service
public class ThinEventValidator {

    private final EnvelopeValidator envelopeValidator;

    public ThinEventValidator(EnvelopeValidator envelopeValidator) {
        this.envelopeValidator = envelopeValidator;
    }

    public void validate(ThinEvent event) {
        if (event == null) {
            throw new CustomException(ThinEventErrorCodes.INVALID_THIN_EVENT, "Event payload is required");
        }
        if (!ThinEvent.KIND.equals(event.getKind())) {
            throw new CustomException(ThinEventErrorCodes.INVALID_THIN_EVENT,
                    "kind must be " + ThinEvent.KIND + " (got " + event.getKind() + ")");
        }
        if (StringUtils.hasText(event.getSchemaVersion())
                && !EnvelopeValidator.SCHEMA_VERSION.equals(event.getSchemaVersion().trim())) {
            throw new CustomException("NB_UNSUPPORTED_SCHEMA_VERSION",
                    "schemaVersion " + event.getSchemaVersion() + " is not supported (expected "
                            + EnvelopeValidator.SCHEMA_VERSION + ")");
        }
        require(event.getEventId(), "eventId");
        require(event.getEventType(), "eventType");
        require(event.getModule(), "module");
        require(event.getEventName(), "eventName");
        require(event.getTenantId(), "tenantId");
        if (!envelopeValidator.isAccepted(event.getEventType())) {
            throw new CustomException("NB_UNSUPPORTED_EVENT_TYPE",
                    "eventType " + event.getEventType() + " is not on novu.bridge.event.types");
        }
    }

    private static void require(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new CustomException(ThinEventErrorCodes.INVALID_THIN_EVENT, field + " is required");
        }
    }
}
