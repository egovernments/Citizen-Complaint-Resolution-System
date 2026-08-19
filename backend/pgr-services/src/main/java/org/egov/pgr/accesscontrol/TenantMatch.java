package org.egov.pgr.accesscontrol;

/**
 * Mirrors egov-accesscontrol's {@code TenantMatch} exactly. How a PEP must compare a row's tenant
 * against {@link TenantScope#getValue()}: {@code EXACT} is equality; {@code SUBTREE} matches the
 * tenant itself and every descendant beneath it. Server-chosen, never taken from the request.
 */
public enum TenantMatch {
    EXACT,
    SUBTREE
}
