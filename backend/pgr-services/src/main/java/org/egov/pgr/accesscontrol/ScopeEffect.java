package org.egov.pgr.accesscontrol;

/**
 * Mirrors egov-accesscontrol's {@code ScopeEffect} exactly. What a PEP must do with a
 * {@link ResolvedScope}: {@code FILTER} — apply its tenant/citizen/axis restrictions as a SQL
 * filter. {@code DENY} — the scope matches nothing at all; return no rows without querying.
 */
public enum ScopeEffect {
    FILTER,
    DENY
}
