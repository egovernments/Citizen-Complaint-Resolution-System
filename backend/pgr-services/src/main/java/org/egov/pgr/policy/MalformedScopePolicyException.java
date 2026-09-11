package org.egov.pgr.policy;

/**
 * Thrown when an action's {@code resource.<resourceType>.scope} block IS present (an operator
 * authored one) but is not a well-formed {@link ScopePolicy} — e.g. {@code axes} missing/empty, or
 * an axis with no known resource/user field mapping. Distinct from "no {@code scope} key at all",
 * which is a confirmed absence of configuration and stays backward-compatible (see
 * {@link ScopePolicy#parse}). A present-but-broken policy is an authoring mistake, not an absent
 * one, and must never quietly fall back to the SAME permissive default an absent policy gets —
 * callers fail the request closed instead.
 */
public class MalformedScopePolicyException extends RuntimeException {
    public MalformedScopePolicyException(String message) {
        super(message);
    }
}
