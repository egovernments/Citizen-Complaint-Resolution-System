package org.egov.pgr.accesscontrol;

import lombok.extern.slf4j.Slf4j;

import java.util.Map;

/**
 * Applies a {@link FieldObligation}'s {@link ObligationType} to a value — purely mechanical PEP
 * behavior, never a policy decision. Which field gets which strategy is entirely
 * egov-accesscontrol's call, carried on the wire per obligation; this only knows HOW to perform the
 * two closed strategies the contract defines.
 */
@Slf4j
public final class MaskingStrategy {

    private MaskingStrategy() {
    }

    /**
     * Applies the strategy named on {@code obligation}. A missing {@code type} fails closed to
     * REDACT rather than leaving the field visible — an obligation PGR can't fully parse must never
     * result in exposure.
     */
    public static Object apply(Object value, FieldObligation obligation) {
        if (value == null)
            return null;

        ObligationType type = obligation == null ? null : obligation.getType();
        if (type == null) {
            log.error("MaskingStrategy: missing 'type' on a field obligation — failing closed to REDACT");
            return redact();
        }
        Map<String, Object> params = obligation.getParams() == null ? Map.of() : obligation.getParams();
        switch (type) {
            case REDACT:
                return redact();
            case MASK_SHOW_LAST_N:
                return maskShowLastN(value, params);
            default:
                log.error("MaskingStrategy: unrecognized obligation type '{}' — failing closed to REDACT", type);
                return redact();
        }
    }

    private static Object redact() {
        return null;
    }

    private static Object maskShowLastN(Object value, Map<String, Object> params) {
        String text = String.valueOf(value);
        Object nParam = params.get("n");
        int n = nParam instanceof Number ? ((Number) nParam).intValue() : 0;
        Object maskCharParam = params.get("maskChar");
        String maskChar = maskCharParam != null && !maskCharParam.toString().isEmpty()
                ? maskCharParam.toString() : "X";

        int keep = Math.max(0, Math.min(n, text.length()));
        int maskLen = text.length() - keep;
        return maskChar.repeat(Math.max(maskLen, 0)) + text.substring(text.length() - keep);
    }
}
