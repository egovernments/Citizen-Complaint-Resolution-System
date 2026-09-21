package org.egov.userpreference.service.validator;

import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.utils.ErrorCodes;
import org.egov.userpreference.utils.StringUtil;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Keeps a citizen to their own preference record.
 *
 * <p>Both endpoints key on the {@code userId} in the request body, never on
 * the authenticated principal: the token uuid is used only for the audit
 * columns. Without a check here any citizen who can reach the route can read
 * or overwrite another citizen's notification consent, and {@code _search}
 * accepts {@code tenantId} alone, which hands over the uuids to aim at. That
 * is BOLA (CWE-639), and it is the shape the Go service shipped with.
 *
 * <p>The rule deliberately keys off the caller's roles rather than simply
 * demanding a match, because three legitimate callers are not citizens acting
 * on themselves:
 *
 * <ul>
 *   <li>novu-bridge posts an <em>empty</em> {@code requestInfo} when it checks
 *       consent before a dispatch and when it lists a tenant's preferences for
 *       the configurator. No principal means a service-to-service call, which
 *       is allowed through: the gateway is the authN boundary and populates
 *       {@code userInfo} for anything arriving with a citizen token.</li>
 *   <li>Employees and admins legitimately read across a tenant.</li>
 *   <li>The citizen profile screen already sends its own uuid on both calls
 *       ({@code UserProfile.js}), so it is unaffected.</li>
 * </ul>
 *
 * <p>Enforcement can be switched off with
 * {@code user.preference.security.enforce-ownership=false} for a deployment
 * that needs the old behaviour while it adjusts a caller.
 */
@Component
@Slf4j
public class OwnershipValidator {

    @Value("${user.preference.security.enforce-ownership}")
    private boolean enforceOwnership;

    /** Roles that may act on a preference belonging to someone else. */
    @Value("${user.preference.security.privileged-roles}")
    private List<String> privilegedRoles;

    /** An upsert may only write the caller's own record. */
    public void validateUpsert(Preference preference, RequestInfo requestInfo) {
        String principal = principalUuid(requestInfo);
        if (principal == null || isPrivileged(requestInfo)) {
            return;
        }
        if (!principal.equals(StringUtil.trimToEmpty(preference.getUserId()))) {
            log.warn("Rejecting an upsert for another user: principal={}, body userId={}",
                    principal, preference.getUserId());
            throw CustomException.forbidden(ErrorCodes.NOT_AUTHORIZED,
                    "userId must match the authenticated user", requestInfo);
        }
    }

    /**
     * A search must be narrowed to the caller's own record. A tenant-only
     * search is what turns this from "read one record" into "enumerate every
     * citizen's consent in the tenant", so an absent {@code userId} is
     * rejected rather than silently scoped.
     */
    public void validateSearch(PreferenceCriteria criteria, RequestInfo requestInfo) {
        String principal = principalUuid(requestInfo);
        if (principal == null || isPrivileged(requestInfo)) {
            return;
        }
        if (!principal.equals(StringUtil.trimToEmpty(criteria.getUserId()))) {
            log.warn("Rejecting a search for another user: principal={}, criteria userId={}",
                    principal, criteria.getUserId());
            throw CustomException.forbidden(ErrorCodes.NOT_AUTHORIZED,
                    "criteria.userId must match the authenticated user", requestInfo);
        }
    }

    /** The authenticated uuid, or null when the call carries no principal. */
    private String principalUuid(RequestInfo requestInfo) {
        if (!enforceOwnership || requestInfo == null || requestInfo.getUserInfo() == null) {
            return null;
        }
        String uuid = requestInfo.getUserInfo().getUuid();
        return StringUtil.isEmpty(uuid) ? null : uuid;
    }

    private boolean isPrivileged(RequestInfo requestInfo) {
        List<RequestInfo.Role> roles = requestInfo.getUserInfo().getRoles();
        if (roles == null || roles.isEmpty()) {
            return false;
        }
        Set<String> allowed = privilegedRoles.stream()
                .map(role -> role.trim().toUpperCase())
                .filter(role -> !role.isEmpty())
                .collect(Collectors.toSet());
        return roles.stream()
                .map(RequestInfo.Role::getCode)
                .filter(StringUtil::isNotEmpty)
                .anyMatch(code -> allowed.contains(code.toUpperCase()));
    }
}
