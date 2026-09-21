package org.egov.novubridge.service.thin;

import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * The thin-event contract, stated rather than sniffed. An event is accepted only if it
 * <ol>
 *   <li>declares {@code kind = "THIN"},</li>
 *   <li>is schema version {@value EnvelopeValidator#SCHEMA_VERSION} (or omits the version),</li>
 *   <li>has the identity fields — eventId, eventType, module, eventName, tenantId — and</li>
 *   <li>carries an {@code eventType} on the deployment allowlist {@code novu.bridge.event.types}.</li>
 * </ol>
 *
 * <p><b>The allowlist applies here too, and that is the point.</b> There is no flag that turns the
 * thin path on. A deployment's path is decided by which producer image it runs, and a thin event
 * whose type nobody allowed is {@code REJECTED / NB_UNSUPPORTED_EVENT_TYPE} — a ledger row AND a
 * DLQ message, per message. The failure mode of a mis-provisioned deployment is a screen full of
 * red rows, never silence. That is the property a dropped compose overlay once cost us.
 *
 * <p>Note what is NOT checked: {@code eventName} against the event catalogue, the audiences, the
 * placeholder vocabulary. Those need config this class does not read, and they belong to the
 * resolution stage, which reports them as {@code NB_EVENT_NOT_IN_CATALOGUE} and friends. This
 * validator answers one question — is this a well-formed thin event from a producer we accept —
 * and answers it without any I/O.
 *
 * <p>The allowlist and the version rule are shared with {@link EnvelopeValidator} rather than
 * re-implemented, so the two kinds can never disagree about which producers a deployment accepts.
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
