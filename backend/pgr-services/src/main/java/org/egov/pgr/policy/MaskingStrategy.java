package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;

import java.util.Map;

/**
 * Small built-in set of field-masking transforms, selected by name from an Action.resource
 * attribute rule's {@code onDeny.strategy} (see the field-level attribute access design doc). A
 * new field or role rule is pure MDMS data; a genuinely new masking SHAPE is a one-time addition
 * here, reusable via config forever after.
 */
@Slf4j
public enum MaskingStrategy {

    /** Field -> null. */
    REDACT {
        @Override
        Object mask(Object value, Map<String, Object> params) {
            return null;
        }
    },

    /** Field -> maskChar repeated, keeping the last `n` characters of the original value. */
    MASK_SHOW_LAST_N {
        @Override
        Object mask(Object value, Map<String, Object> params) {
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
    };

    abstract Object mask(Object value, Map<String, Object> params);

    /**
     * Applies the strategy named in onDeny.strategy. An unrecognized or missing strategy name
     * fails closed to REDACT rather than leaving the field visible — a masking config typo must
     * never result in exposure.
     */
    public static Object apply(Object value, Map<String, Object> onDeny) {
        if (value == null)
            return null;

        Object strategyParam = onDeny == null ? null : onDeny.get("strategy");
        // Explicit guard rather than relying on String.valueOf(null) -> "null" -> a caught
        // valueOf() throw: a missing/blank strategy is an expected, common authoring shape
        // (policies that only set a masking rule once a strategy is actually chosen), not an
        // exceptional one — no reason to pay for/rely on a hot-path throw to detect it.
        if (strategyParam == null || String.valueOf(strategyParam).isBlank()) {
            log.error("MaskingStrategy: missing 'strategy' — failing closed to REDACT");
            return REDACT.mask(value, onDeny);
        }
        String name = String.valueOf(strategyParam);
        try {
            return valueOf(name).mask(value, onDeny);
        } catch (Exception e) {
            log.error("MaskingStrategy: unrecognized strategy '{}' — failing closed to REDACT", name);
            return REDACT.mask(value, onDeny);
        }
    }
}
