package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Single source of truth for normalizing a caller's role codes — trim + uppercase, matching the
 * platform-wide convention every MDMS-authored role code already uses ({@code ScopePolicy#parse}'s
 * {@code roleScopes} keys, {@code ACCESSCONTROL-ROLEACTIONS.rolecode} rows). Previously duplicated
 * with drifting normalization across {@code AccessPolicyRegistry}'s cache-key computation,
 * {@code PolicyDrivenScopeResolver}'s engine input, and {@code MDMSUtils}' outbound
 * accesscontrol request body (which had NO normalization at all — sent whatever raw
 * casing/whitespace {@code RequestInfo} carried straight over the wire). A cache key computed
 * from a normalized role set could disagree with what an un-normalized version actually sent,
 * letting a cached result for one caller's role spelling be served to a different caller whose
 * real (un-normalized) roles wouldn't have matched it (#1441 review).
 */
public final class RoleCodes {

    private RoleCodes() {
    }

    public static Set<String> normalize(RequestInfo requestInfo) {
        if (requestInfo == null || requestInfo.getUserInfo() == null)
            return Set.of();
        return normalize(requestInfo.getUserInfo());
    }

    public static Set<String> normalize(User user) {
        return user == null ? Set.of() : normalize(user.getRoles());
    }

    public static Set<String> normalize(List<Role> roles) {
        if (roles == null)
            return Set.of();
        Set<String> codes = new LinkedHashSet<>();
        for (Role r : roles) {
            if (r == null || r.getCode() == null)
                continue;
            String code = r.getCode().trim().toUpperCase();
            if (!code.isEmpty())
                codes.add(code);
        }
        return codes;
    }
}
