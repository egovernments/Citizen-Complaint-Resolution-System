package org.egov.pgr.accesscontrol;

/**
 * Mirrors egov-accesscontrol's {@code ObligationType} exactly. What a PEP must do to a field it may
 * not show: {@code REDACT} clears it; {@code MASK_SHOW_LAST_N} replaces all but the trailing
 * {@code n} characters with {@code maskChar} (both read from {@link FieldObligation#getParams()}).
 */
public enum ObligationType {
    REDACT,
    MASK_SHOW_LAST_N
}
