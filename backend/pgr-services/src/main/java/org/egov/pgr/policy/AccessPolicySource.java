package org.egov.pgr.policy;

import java.util.List;

/**
 * Source of access-control actions visible to a caller's exact role set.
 *
 * <p>The role list is canonical, immutable, and is the same list used by the registry's cache
 * key. Policy selection must be a pure function of exactly these arguments. The registry's caller
 * is responsible for authentication and tenant binding before lookup. An empty list means that the
 * authenticated caller has no visible matching action. Implementations must never return
 * {@code null}.
 */
@FunctionalInterface
public interface AccessPolicySource {

    List<PolicyAction> findActions(String tenantId, String method, String url,
                                   List<String> roleCodes) throws Exception;
}
