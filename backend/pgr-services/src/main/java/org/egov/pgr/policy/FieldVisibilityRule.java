package org.egov.pgr.policy;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Map;

/**
 * A single validated field-visibility rule extracted from an Action's {@code resource} JSON
 * object (see the field-level attribute access design doc): {@code conditionJson} is the raw
 * JsonLogic text to evaluate (true = field visible as-is), {@code onDeny} names the
 * {@link MaskingStrategy} + params to apply when it evaluates false.
 *
 * Always fully populated by construction — {@link AccessPolicyRegistry} guarantees a malformed or
 * missing "condition"/"onDeny" on the raw MDMS data is normalized here to a fail-closed rule
 * (an always-false condition and/or the REDACT strategy), never surfaced as a null/absent rule
 * that a caller might mistake for "no restriction".
 */
@Getter
@AllArgsConstructor
public class FieldVisibilityRule {
    private final String conditionJson;
    private final Map<String, Object> onDeny;
}
